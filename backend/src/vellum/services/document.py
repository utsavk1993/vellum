from __future__ import annotations

import os
import uuid

import pymupdf
import structlog
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vellum.config import settings
from vellum.db.models import Document, DocumentPage

logger = structlog.get_logger()


def extract_pages(file_path: str) -> list[tuple[int, str]]:
    """Extract per-page text from a PDF as (page_number, text) pairs, 1-indexed.

    Pages with no extractable text are omitted — a scanned page contributes nothing
    to retrieval, and an empty row would only pollute the index.
    """
    pages: list[tuple[int, str]] = []
    with pymupdf.open(file_path) as doc:
        for index, page in enumerate(doc):
            text = page.get_text()
            if text.strip():
                pages.append((index + 1, text))
    return pages


def page_count(file_path: str) -> int:
    with pymupdf.open(file_path) as doc:
        return len(doc)


async def upload_document(
    session: AsyncSession, conversation_id: str, file: UploadFile
) -> Document:
    """Save a PDF, index it page by page, and attach it to the conversation.

    A conversation holds as many documents as the deal needs — the lawyers this is
    built for review dozens per matter, and cross-document questions are the point.

    Raises ValueError if the file is not a PDF or exceeds the size limit.
    """
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        filename = file.filename or ""
        if not filename.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are supported.")

    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise ValueError(
            f"File too large. Maximum size is {settings.max_upload_size // (1024 * 1024)}MB."
        )

    original_filename = file.filename or "document.pdf"
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    try:
        pages = extract_pages(file_path)
        total_pages = page_count(file_path)
    except Exception:
        logger.exception("Failed to extract text from PDF", filename=original_filename)
        pages, total_pages = [], 0

    document = Document(
        conversation_id=conversation_id,
        filename=original_filename,
        file_path=file_path,
        page_count=total_pages,
        has_text=bool(pages),
    )
    session.add(document)
    await session.flush()

    session.add_all(
        DocumentPage(document_id=document.id, page_number=number, text=text)
        for number, text in pages
    )
    await session.commit()
    await session.refresh(document)

    logger.info(
        "Indexed document",
        filename=original_filename,
        document_id=document.id,
        page_count=total_pages,
        indexed_pages=len(pages),
        has_text=document.has_text,
    )
    return document


async def get_document(session: AsyncSession, document_id: str) -> Document | None:
    result = await session.execute(select(Document).where(Document.id == document_id))
    return result.scalar_one_or_none()


async def list_documents(session: AsyncSession, conversation_id: str) -> list[Document]:
    """Every document attached to a conversation, oldest first."""
    result = await session.execute(
        select(Document)
        .where(Document.conversation_id == conversation_id)
        .order_by(Document.uploaded_at)
    )
    return list(result.scalars().all())


async def get_page_text(session: AsyncSession, document_id: str, page_number: int) -> str | None:
    result = await session.execute(
        select(DocumentPage.text).where(
            DocumentPage.document_id == document_id,
            DocumentPage.page_number == page_number,
        )
    )
    return result.scalar_one_or_none()
