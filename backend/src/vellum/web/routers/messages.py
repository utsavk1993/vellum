from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.responses import StreamingResponse

from vellum.db.models import Citation, Message
from vellum.db.session import get_session
from vellum.services.citations import CitationStreamParser, RawCitation, quote_matches
from vellum.services.conversation import get_conversation, update_conversation
from vellum.services.document import get_page_text, list_documents
from vellum.services.llm import CITATION_CORRECTION, chat_with_documents, generate_title

logger = structlog.get_logger()

router = APIRouter(tags=["messages"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class CitationOut(BaseModel):
    id: str
    ordinal: int
    document_id: str
    page_number: int
    quote: str
    verified: bool

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: datetime
    citations: list[CitationOut] = []

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
    """List all messages in a conversation, with their citations."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .options(selectinload(Message.citations))
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    return [MessageOut.model_validate(message) for message in result.scalars().all()]


async def _verify(raw: RawCitation) -> bool:
    """Check a quoted span against the page it claims to come from.

    Opens its own session: the request-scoped one is not guaranteed to still be open
    by the time the streaming generator is draining.
    """
    from vellum.db.session import async_session

    async with async_session() as session:
        page_text = await get_page_text(session, raw.document_id, raw.page_number)
    return quote_matches(raw.quote, page_text) if page_text is not None else False


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Send a user message and stream back the AI response via SSE.

    Citations are resolved inside the stream: as each `<cite>` tag closes, the quote is
    checked against the page it names and a `citation` event is pushed to the client.
    Verification happens here, on the server, against the stored page text — the model
    is never the authority on whether its own citation is real.
    """
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
    conversation_history = [{"role": m.role, "content": m.content} for m in history_messages]
    is_first_message = not any(m.role == "user" for m in history_messages)

    async def event_stream() -> AsyncIterator[str]:
        parser = CitationStreamParser()
        visible_text = ""
        resolved: list[tuple[RawCitation, bool]] = []

        def sse(payload: dict[str, object]) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        async def handle(events: list[tuple[str, object]]) -> AsyncIterator[str]:
            """Turn parser output into SSE, verifying each citation as its tag closes."""
            nonlocal visible_text
            for kind, value in events:
                if kind == "text":
                    text = str(value)
                    visible_text += text
                    yield sse({"type": "content", "content": text})
                else:
                    raw = value  # type: ignore[assignment]
                    assert isinstance(raw, RawCitation)
                    verified = await _verify(raw)
                    resolved.append((raw, verified))
                    yield sse(
                        {
                            "type": "citation",
                            "citation": {
                                "ordinal": raw.ordinal,
                                "document_id": raw.document_id,
                                "page_number": raw.page_number,
                                "quote": raw.quote,
                                "verified": verified,
                            },
                        }
                    )

        async def run(correction: str | None) -> AsyncIterator[str]:
            """Stream one agent run through the citation parser."""
            nonlocal parser, visible_text
            async for chunk in chat_with_documents(
                conversation_id=conversation_id,
                user_message=body.content,
                conversation_history=conversation_history,
                has_documents=bool(documents),
                correction=correction,
            ):
                async for event in handle(parser.feed(chunk)):
                    yield event
            async for event in handle(parser.flush()):
                yield event

        try:
            async for event in run(correction=None):
                yield event

            # Emitting citation tags is probabilistic: the model sometimes answers in
            # conventional legal prose ("cl. 8.1.1") instead, which looks authoritative
            # and links to nothing. Rather than serve that, ask once more with an
            # explicit correction. The client discards what it has on `restart`.
            if documents and visible_text.strip() and not resolved:
                logger.warning(
                    "Answer had no citations; retrying with correction",
                    conversation_id=conversation_id,
                )
                parser = CitationStreamParser()
                visible_text = ""
                yield sse({"type": "restart", "reason": "no_citations"})
                async for event in run(correction=CITATION_CORRECTION):
                    yield event

        except Exception:
            logger.exception("Error during LLM streaming", conversation_id=conversation_id)
            if visible_text.strip():
                # The answer already arrived and only the tail of the run failed. Keep
                # it — discarding a complete, cited answer because bookkeeping after it
                # threw is a far worse outcome than an incomplete note.
                note = "\n\n_The response may be incomplete — an error occurred at the end._"
                visible_text += note
                yield sse({"type": "content", "content": note})
            else:
                error_msg = (
                    "I'm sorry, an error occurred while generating a response. Please try again."
                )
                visible_text = error_msg
                resolved.clear()
                yield sse({"type": "content", "content": error_msg})

        # A fresh session: the request-scoped one may have been closed by the time the
        # generator finishes draining.
        from vellum.db.session import async_session as session_factory

        async with session_factory() as save_session:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=visible_text,
            )
            save_session.add(assistant_message)
            await save_session.flush()

            save_session.add_all(
                Citation(
                    message_id=assistant_message.id,
                    ordinal=raw.ordinal,
                    document_id=raw.document_id,
                    page_number=raw.page_number,
                    quote=raw.quote,
                    verified=verified,
                )
                for raw, verified in resolved
            )
            await save_session.commit()
            await save_session.refresh(assistant_message)

            verified_count = sum(1 for _, ok in resolved if ok)
            logger.info(
                "Assistant message saved",
                conversation_id=conversation_id,
                citations=len(resolved),
                verified=verified_count,
            )

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
                        "citations": [
                            {
                                "id": "",
                                "ordinal": raw.ordinal,
                                "document_id": raw.document_id,
                                "page_number": raw.page_number,
                                "quote": raw.quote,
                                "verified": verified,
                            }
                            for raw, verified in resolved
                        ],
                    },
                }
            )
            yield sse(
                {
                    "type": "done",
                    "message_id": assistant_message.id,
                    "citations": len(resolved),
                    "verified": verified_count,
                }
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
