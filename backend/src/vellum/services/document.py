from __future__ import annotations

import os
import uuid

import pymupdf
import structlog
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vellum.config import settings
from vellum.db.models import Document

logger = structlog.get_logger()


def extract_text(file_path: str) -> tuple[str, int]:
    """Pull the text layer out of a PDF, returning it with the page count."""
    parts: list[str] = []
    with pymupdf.open(file_path) as doc:
        for page in doc:
            text = page.get_text()
            if text.strip():
                parts.append(text)
        return "\n\n".join(parts), len(doc)


async def upload_document(
    session: AsyncSession, conversation_id: str, file: UploadFile
) -> Document:
    """Save a PDF, extract its text, and attach it to the conversation.

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
    # Two matters can hold documents with the same name, and the second must not
    # overwrite the first on disk.
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    try:
        text, page_count = extract_text(file_path)
    except Exception:
        # A PDF that cannot be parsed should not take the upload down with it — the
        # file is on disk, and the failure belongs in the logs rather than in a 500.
        logger.exception("Failed to extract text from PDF", filename=original_filename)
        text, page_count = "", 0

    document = Document(
        conversation_id=conversation_id,
        filename=original_filename,
        file_path=file_path,
        extracted_text=text,
        page_count=page_count,
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)

    logger.info(
        "Document uploaded",
        filename=original_filename,
        document_id=document.id,
        page_count=page_count,
        characters=len(text),
    )
    return document


async def get_document(session: AsyncSession, document_id: str) -> Document | None:
    result = await session.execute(select(Document).where(Document.id == document_id))
    return result.scalar_one_or_none()


async def list_documents(session: AsyncSession, conversation_id: str) -> list[Document]:
    """Documents attached to a conversation, oldest first."""
    result = await session.execute(
        select(Document)
        .where(Document.conversation_id == conversation_id)
        .order_by(Document.uploaded_at)
    )
    return list(result.scalars().all())
