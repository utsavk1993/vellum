from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from vellum.db.models import Message
from vellum.db.session import get_session
from vellum.services.conversation import get_conversation, update_conversation
from vellum.services.document import list_documents
from vellum.services.llm import chat_with_documents, generate_title

logger = structlog.get_logger()

router = APIRouter(tags=["messages"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    sources_cited: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get(
    "/api/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    """List all messages in a conversation, oldest first."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    return [MessageOut.model_validate(message) for message in result.scalars().all()]


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Send a user message and stream back the assistant's response over SSE."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    user_message = Message(conversation_id=conversation_id, role="user", content=body.content)
    session.add(user_message)
    await session.commit()
    await session.refresh(user_message)

    documents = await list_documents(session, conversation_id)

    history_stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.id != user_message.id)
        .order_by(Message.created_at.asc())
    )
    history_messages = list((await session.execute(history_stmt)).scalars().all())
    conversation_history = [
        {"role": m.role, "content": m.content} for m in history_messages
    ]
    is_first_message = not any(m.role == "user" for m in history_messages)

    async def event_stream() -> AsyncIterator[str]:
        visible_text = ""

        def sse(payload: dict[str, object]) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        try:
            async for chunk in chat_with_documents(
                user_message=body.content,
                conversation_history=conversation_history,
                documents=documents,
            ):
                visible_text += chunk
                yield sse({"type": "content", "content": chunk})
        except Exception:
            logger.exception("Error during LLM streaming", conversation_id=conversation_id)
            error_msg = (
                "I'm sorry, an error occurred while generating a response. Please try again."
            )
            visible_text = error_msg
            yield sse({"type": "content", "content": error_msg})

        # A fresh session: the request-scoped one may already have been closed by the
        # time this generator finishes draining.
        from vellum.db.session import async_session as session_factory

        async with session_factory() as save_session:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=visible_text,
            )
            save_session.add(assistant_message)
            await save_session.commit()
            await save_session.refresh(assistant_message)

            if is_first_message:
                try:
                    title = await generate_title(body.content)
                    await update_conversation(save_session, conversation_id, title)
                except Exception:
                    logger.exception("Failed to generate title", conversation_id=conversation_id)

            yield sse(
                {
                    "type": "message",
                    "message": {
                        "id": assistant_message.id,
                        "conversation_id": assistant_message.conversation_id,
                        "role": assistant_message.role,
                        "content": assistant_message.content,
                        "created_at": assistant_message.created_at.isoformat(),
                    },
                }
            )
            yield sse({"type": "done", "message_id": assistant_message.id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx and friends will buffer an event stream into uselessness otherwise.
            "X-Accel-Buffering": "no",
        },
    )
