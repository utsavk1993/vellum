from __future__ import annotations

from dataclasses import dataclass

import structlog
from sqlalchemy import Float, Text, func, literal, select
from sqlalchemy.dialects.postgresql import REGCONFIG
from sqlalchemy.ext.asyncio import AsyncSession

from vellum.db.models import Document, DocumentPage

logger = structlog.get_logger()

SNIPPET_OPTIONS = "MaxFragments=2, MaxWords=40, MinWords=15, StartSel=<<, StopSel=>>"

# Postgres resolves the text-search config by `regconfig`, not by string: bound as a
# plain parameter these calls fail to find an overload at all.
ENGLISH = literal("english", type_=REGCONFIG)


@dataclass(frozen=True)
class SearchHit:
    document_id: str
    filename: str
    page_number: int
    snippet: str
    score: float


async def search_pages(
    session: AsyncSession,
    conversation_id: str,
    query: str,
    document_ids: list[str] | None = None,
    limit: int = 8,
) -> list[SearchHit]:
    """Rank pages across a conversation's documents against a natural-language query.

    Uses Postgres full-text search rather than embeddings. Legal queries are strongly
    lexical — "break clause", "rent review", "demised premises" are terms of art that
    appear verbatim — and this keeps the stack to one dependency the project already
    has, so `just dev` remains the whole setup story.

    ``websearch_to_tsquery`` gives the model the query syntax it already writes in
    (quoted phrases, ``or``, ``-``) and never raises on input it cannot parse, which
    matters when the query is model-authored.
    """
    if not query.strip():
        return []

    rows = await _ranked(
        session,
        conversation_id,
        func.websearch_to_tsquery(ENGLISH, literal(query, type_=Text)),
        document_ids,
        limit,
    )

    return [
        SearchHit(
            document_id=document_id,
            filename=filename,
            page_number=page_number,
            snippet=" ".join(text.split()),
            score=float(score),
        )
        for document_id, filename, page_number, text, score in rows
    ]


async def _ranked(
    session: AsyncSession,
    conversation_id: str,
    tsquery,
    document_ids: list[str] | None,
    limit: int,
) -> list[tuple[str, str, int, str, float]]:
    """Pages matching a tsquery, best first."""
    rank = func.ts_rank(DocumentPage.search_vector, tsquery).cast(Float)
    snippet = func.ts_headline(ENGLISH, DocumentPage.text, tsquery, literal(SNIPPET_OPTIONS))

    stmt = (
        select(
            DocumentPage.document_id,
            Document.filename,
            DocumentPage.page_number,
            snippet,
            rank,
        )
        .join(Document, Document.id == DocumentPage.document_id)
        .where(
            Document.conversation_id == conversation_id,
            DocumentPage.search_vector.op("@@")(tsquery),
        )
        .order_by(rank.desc(), DocumentPage.page_number)
        .limit(limit)
    )
    if document_ids:
        stmt = stmt.where(DocumentPage.document_id.in_(document_ids))
    return list((await session.execute(stmt)).all())  # type: ignore[arg-type]
