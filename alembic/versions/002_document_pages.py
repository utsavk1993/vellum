"""Page-level index for retrieval

Adds ``document_pages`` — one row per PDF page with a generated ``tsvector`` — so the
agent can search for the pages that matter instead of having a whole document stuffed
into the prompt.

``documents.extracted_text`` is dropped in the same step: page rows become the single
source of truth for document text, and keeping both invites them to drift.

``documents.has_text`` records whether the PDF yielded anything at all, so a scan is
never silently mistaken for an indexed document.

Revision ID: 002_document_pages
Revises: 001_initial
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_document_pages"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_pages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        # Generated and stored, so the vector cannot fall out of step with the text
        # it was built from and no application code has to remember to refresh it.
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('english', text)", persisted=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("document_id", "page_number", name="uq_document_page"),
    )
    op.create_index(
        "ix_document_pages_search_vector",
        "document_pages",
        ["search_vector"],
        postgresql_using="gin",
    )
    op.create_index("ix_document_pages_document_id", "document_pages", ["document_id"])

    op.add_column(
        "documents",
        sa.Column("has_text", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.drop_column("documents", "extracted_text")


def downgrade() -> None:
    op.add_column("documents", sa.Column("extracted_text", sa.Text(), nullable=True))
    op.drop_column("documents", "has_text")

    op.drop_index("ix_document_pages_document_id", table_name="document_pages")
    op.drop_index("ix_document_pages_search_vector", table_name="document_pages")
    op.drop_table("document_pages")
