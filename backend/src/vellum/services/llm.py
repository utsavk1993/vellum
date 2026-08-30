from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import structlog
from pydantic_ai import Agent, RunContext

from vellum.config import settings  # noqa: F401 — triggers ANTHROPIC_API_KEY export
from vellum.db.session import async_session
from vellum.services import document as document_service
from vellum.services import retrieval

logger = structlog.get_logger()

# How much of a page the model may pull in one read. Legal pages run long; this is
# generous enough to capture a full clause and its provisos without inviting the model
# to work through an entire document one page at a time.
MAX_PAGE_CHARS = 12_000

# Ceiling on a single batched read, so "read the whole document" cannot swamp context.
MAX_PAGES_PER_READ = 8


@dataclass
class Deps:
    """Scope for a run. Only the conversation id — tools open their own DB sessions.

    An ``AsyncSession`` is not safe under concurrent use, and the agent issues tool
    calls in parallel, so sharing the request's session across tools intermittently
    fails with 'concurrent operations are not permitted'. Each tool call getting its
    own short-lived session also frees tools from the request's lifecycle, which
    matters because the SSE generator outlives the request that started it.
    """

    conversation_id: str


SYSTEM_PROMPT = """\
You are a document analyst for commercial real estate lawyers doing due diligence.
They are reviewing leases, title reports, environmental assessments and purchase
agreements, and they will rely on your answers in advice they put their name to.

Finding the material:
- You cannot see the documents until you retrieve them. Start with `search_documents`.
- `search_documents` covers every document in this conversation at once, so
  cross-document questions ("do the lease and the title report agree on the area?")
  are answered by searching, comparing, and naming which document said what.
- Search returns page snippets. When a snippet looks relevant, call `read_pages` to
  see the full page before relying on it — snippets are truncated and can mislead.
- `read_pages` takes a list. Ask for every page you want from a document at once —
  [4, 5, 6], not three separate calls — because each call is a round trip the person
  waiting for the answer pays for.
- Search again with different wording if the first attempt comes back thin. Terms of
  art vary: "break clause" may appear as "right to determine", "tenant option to
  terminate", or "break right".

Citing — this is not optional, and it is the point of the product:

Every factual claim you make about a document MUST be followed immediately by a
citation tag containing the exact text from the page that supports it:

  <cite doc="DOCUMENT_ID" page="PAGE_NUMBER">exact text copied from the page</cite>

Worked example. Having read page 7 of document a1b2c3d4, you would write:

  The tenant must give at least twelve months' written notice to exercise the break
  right.<cite doc="a1b2c3d4" page="7">The Tenant must give the Landlord not less than
  twelve (12) months' prior written notice of its intention to exercise a break
  right</cite> The notice is irrevocable once served.<cite doc="a1b2c3d4" page="7">A
  Break Notice, once given, shall be irrevocable.</cite>

Rules:
- The quoted text is copied character for character from the page. It is checked
  against the stored source text before the lawyer sees it, and a quote that does not
  match is shown to them marked unverified — worse for you than no citation at all.
- Quote the span that actually supports the claim: roughly one to three sentences.
  Do not quote a whole paragraph to be safe, and do not quote a fragment so short it
  means nothing on its own.
- Quote the *clause*, never the bare value. To support a title number, a rent or a
  price, quote the sentence that states it — not the number by itself. A quote of
  "LN782451" or "£850,000" proves nothing: the same digits appear in any document, and
  it is rejected before the lawyer sees it, so the claim arrives marked unverified.
    WRONG   <cite doc="d1" page="1">LN782451</cite>
    RIGHT   <cite doc="d1" page="1">Title Number: LN782451 Title Type: Absolute Freehold</cite>
- Never join separated text with an ellipsis. "Initial Rent... £850,000" is not a quote
  from the page — it is two fragments stitched together, and it is rejected as one.
  Quote one continuous run of text exactly as it appears.
- One citation per claim, not per sentence. Where several consecutive sentences develop
  a single point from the same passage, cite it once at the point it is established.
  A marker on every sentence is noise that makes the genuinely load-bearing ones harder
  to pick out.
- `doc` is the document id from the search results (e.g. a1b2c3d4), never the filename.
- The tag is invisible to the reader — it renders as a small numbered marker. Write
  your prose as normal and attach tags to it. Never write "as quoted below", never
  mention the tag, and never show the raw tag as example text in your answer.
- Your answer must read completely with every marker removed. State the point in your
  own words first, then attach the tag. Never let a tag carry the point on its own:
  a line that reads "The mechanism: [1] [2]" has told the lawyer nothing, because all
  they see is two numbers. Write the sentence, then cite it.
- This matters most in tables and lists, where it is tempting to put the tag in the
  cell. A citation tag must never be the entire content of a table cell or bullet.
  Write the value, then the tag:
    WRONG   | Title number | <cite doc="d1" page="1">Title number LN782451</cite> |
    RIGHT   | Title number | LN782451<cite doc="d1" page="1">Title number LN782451</cite> |
  The first renders as an empty-looking cell containing a number the reader cannot
  interpret; the second reads correctly whether or not the marker is shown.
- An answer about a document containing no citation tags is a failed answer.

Answering:
- If retrieval finds nothing relevant, say so plainly. Never answer a question about a
  document from general knowledge of how such documents usually read — for these users
  a confident guess is worse than "the documents do not address this".
- Distinguish what a document says from what it implies. Flag ambiguity where a clause
  could be read two ways; that judgement is the substance of the work.
- Be concise and precise. Lead with the answer, then the supporting detail.
"""

agent = Agent(
    f"anthropic:{settings.llm_model}",
    deps_type=Deps,
    system_prompt=SYSTEM_PROMPT,
    retries=2,
)


@agent.tool
async def list_documents(ctx: RunContext[Deps]) -> str:
    """List the documents attached to this conversation, with their ids and page counts."""
    async with async_session() as session:
        documents = await document_service.list_documents(session, ctx.deps.conversation_id)
    if not documents:
        return "No documents have been uploaded to this conversation."
    return "\n".join(
        f"- doc={doc.id} {doc.filename} ({doc.page_count} pages)"
        + ("" if doc.has_text else " — no extractable text, likely a scan")
        for doc in documents
    )


@agent.tool
async def search_documents(
    ctx: RunContext[Deps], query: str, document_ids: list[str] | None = None
) -> str:
    """Search every document in this conversation for pages matching a query.

    Call this first, and call it again with different phrasing when results look thin.
    Returns ranked page snippets with the document id and page number needed to quote
    or to read the full page.

    Args:
        query: Words likely to appear in the text, e.g. "break clause notice period".
        document_ids: Optional. Restrict the search to specific documents. Omit to
            search all of them, which is what cross-document questions need.
    """
    async with async_session() as session:
        hits = await retrieval.search_pages(
            session, ctx.deps.conversation_id, query, document_ids=document_ids
        )
    if not hits:
        return f"No pages matched {query!r}. Try different wording or broader terms."

    lines = [f"{len(hits)} matching page(s) for {query!r}:"]
    lines.extend(
        f"- doc={hit.document_id} page={hit.page_number} ({hit.filename})\n  {hit.snippet}"
        for hit in hits
    )
    return "\n".join(lines)


@agent.tool
async def read_pages(ctx: RunContext[Deps], document_id: str, page_numbers: list[int]) -> str:
    """Read one or more pages of a document in full, before relying on them.

    Ask for every page you need from a document in a single call. Each call is a
    round trip, and reading pages 4, 5 and 6 one at a time costs three times what
    asking for [4, 5, 6] costs.

    Args:
        document_id: The document id from search results.
        page_numbers: 1-based page numbers, e.g. [7] or [4, 5, 6].
    """
    if not page_numbers:
        return "No page numbers given."

    # Bound the request: a whole large document in one call would swamp the context
    # and defeats the point of retrieving.
    wanted = list(dict.fromkeys(page_numbers))[:MAX_PAGES_PER_READ]

    async with async_session() as session:
        pages = {
            number: await document_service.get_page_text(session, document_id, number)
            for number in wanted
        }

    sections: list[str] = []
    for number, text in pages.items():
        if text is None:
            sections.append(
                f"--- {document_id} page {number} ---\n"
                "No such page, or it holds no extractable text (a scanned page)."
            )
        else:
            sections.append(f"--- {document_id} page {number} ---\n{text[:MAX_PAGE_CHARS]}")
    return "\n\n".join(sections)


def to_transcript(history: list[dict[str, Any]]) -> str:
    """Flatten prior turns so follow-up questions have something to refer back to."""
    return "\n\n".join(f"{entry['role']}: {entry['content']}" for entry in history)


async def generate_title(user_message: str) -> str:
    """Generate a 3-5 word conversation title from the first user message."""
    result = await agent.run(
        f"Generate a concise 3-5 word title for a conversation that starts with: "
        f"{user_message!r}. Return only the title, nothing else.",
        deps=Deps(conversation_id=""),
    )
    title = str(result.output).strip().strip('"').strip("'")
    return title[:97] + "..." if len(title) > 100 else title


# Sent back to the model when an answer about documents arrives with no citation tags
# at all. Emitting them is probabilistic — prompting raises the rate but cannot
# guarantee it — so the pipeline checks the result and asks again rather than quietly
# serving an uncited answer.
CITATION_CORRECTION = """

[SYSTEM CORRECTION — your previous answer contained no <cite> tags, so it was rejected \
before the user saw it. Write the answer again, the same in substance, but attach a \
citation tag to every factual claim about a document:

<cite doc="DOCUMENT_ID" page="PAGE_NUMBER">exact text copied from that page</cite>

Writing "cl. 8.1.1" or "(Section 8)" in prose is NOT a citation — only the tag counts. \
Re-read any page you need the exact wording from. Do not mention this correction.]"""


async def chat_with_documents(
    conversation_id: str,
    user_message: str,
    conversation_history: list[dict[str, Any]],
    has_documents: bool,
    correction: str | None = None,
) -> AsyncIterator[str]:
    """Run the agent, yielding text as it is produced."""
    prompt = user_message
    if not has_documents:
        prompt = (
            f"{user_message}\n\n[No documents have been uploaded to this conversation. "
            "Tell the user they need to upload one before you can answer questions "
            "about a document.]"
        )
    if correction:
        prompt = f"{prompt}\n{correction}"
    if conversation_history:
        prompt = f"{to_transcript(conversation_history)}\n\n{prompt}"

    async with agent.run_stream(prompt, deps=Deps(conversation_id=conversation_id)) as stream:
        async for chunk in stream.stream_text(delta=True):
            yield chunk
