"""Verified citations

Adds ``citations`` — a claim's quoted span, together with the document and page it was
taken from and whether the quote was actually found there.

This replaces ``messages.sources_cited``, which counted regex matches against the
model's own prose and so could not tell a real clause reference from a passing mention
of a statute. A count that has verified nothing is worse than no count: it invites the
reader to stop checking.

Revision ID: 003_citations
Revises: 002_document_pages
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "003_citations"
down_revision: str | None = "002_document_pages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "citations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("message_id", sa.String(), nullable=False),
        # Footnote number as rendered in the answer, 1-based and stable per message.
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_citations_message_id", "citations", ["message_id"])

    op.drop_column("messages", "sources_cited")


def downgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("sources_cited", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.drop_index("ix_citations_message_id", table_name="citations")
    op.drop_table("citations")
