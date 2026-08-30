from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import structlog
from pydantic_ai import Agent

from vellum.config import settings  # noqa: F401 — triggers ANTHROPIC_API_KEY export

logger = structlog.get_logger()

# How much of a document's text to put in front of the model. Generous, because the
# whole document is all the model gets — there is no retrieval yet, so anything cut
# here is simply invisible to it.
MAX_DOCUMENT_CHARS = 100_000


SYSTEM_PROMPT = """\
You are a document analyst for commercial real estate lawyers doing due diligence.
They are reviewing leases, title reports, environmental assessments and purchase
agreements, and they will rely on your answers in advice they put their name to.

- Answer only from the document text you have been given. If it does not address the
  question, say so plainly. Never answer from general knowledge of how such documents
  usually read — for these users a confident guess is worse than "the document does not
  address this".
- Distinguish what the document says from what it implies. Flag ambiguity where a
  clause could be read two ways; that judgement is the substance of the work.
- Refer to the clause or section a statement comes from, so it can be checked.
- Be concise and precise. Lead with the answer, then the supporting detail.
"""

agent = Agent(
    f"anthropic:{settings.llm_model}",
    system_prompt=SYSTEM_PROMPT,
)


def build_prompt(user_message: str, documents: list[Any]) -> str:
    """Put the document text in front of the model, then the question."""
    if not documents:
        return (
            f"{user_message}\n\n[No documents have been uploaded to this conversation. "
            "Tell the user they need to upload one before you can answer questions "
            "about a document.]"
        )

    sections = [
        f"--- {doc.filename} ({doc.page_count} pages) ---\n"
        f"{(doc.extracted_text or '')[:MAX_DOCUMENT_CHARS]}"
        for doc in documents
    ]
    return "\n\n".join([*sections, f"Question: {user_message}"])


def to_transcript(history: list[dict[str, Any]]) -> str:
    """Flatten prior turns so follow-up questions have something to refer back to."""
    return "\n\n".join(f"{entry['role']}: {entry['content']}" for entry in history)


async def generate_title(user_message: str) -> str:
    """Generate a 3-5 word conversation title from the first user message."""
    result = await agent.run(
        f"Generate a concise 3-5 word title for a conversation that starts with: "
        f"{user_message!r}. Return only the title, nothing else."
    )
    title = str(result.output).strip().strip('"').strip("'")
    return title[:97] + "..." if len(title) > 100 else title


async def chat_with_documents(
    user_message: str,
    conversation_history: list[dict[str, Any]],
    documents: list[Any],
) -> AsyncIterator[str]:
    """Run the agent, yielding text as it is produced.

    Streaming is not a nicety here: a due-diligence answer takes tens of seconds, and
    watching it arrive is the difference between "thinking" and "hung".
    """
    prompt = build_prompt(user_message, documents)
    if conversation_history:
        prompt = f"{to_transcript(conversation_history)}\n\n{prompt}"

    async with agent.run_stream(prompt) as stream:
        async for chunk in stream.stream_text(delta=True):
            yield chunk
