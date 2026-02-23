"""Add content digest tables.

Revision ID: 001_content_digest
Revises:
Create Date: 2026-02-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "001_content_digest"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_sources",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("url", sa.String(2048), nullable=True),
        sa.Column("config", postgresql.JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "vip_people",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("platform", sa.String(50), nullable=False),
        sa.Column("handle", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("platform", "handle", name="uq_vip_platform_handle"),
    )

    op.create_table(
        "content_items",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("source_id", sa.Uuid(), sa.ForeignKey("content_sources.id"), nullable=False),
        sa.Column("external_id", sa.String(512), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String(1024), nullable=True),
        sa.Column("url", sa.String(2048), nullable=True),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("content_text", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("is_from_vip", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("vip_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "external_id", name="uq_content_source_external"),
    )
    op.create_index("ix_content_items_content_hash", "content_items", ["content_hash"])
    op.create_index("ix_content_items_published_at", "content_items", ["published_at"])

    op.create_table(
        "seen_content",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("content_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_seen_content_content_hash", "seen_content", ["content_hash"], unique=True)

    op.create_table(
        "digests",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("digest_date", sa.Date(), nullable=False, unique=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("html_content", sa.Text(), nullable=True),
        sa.Column("item_count", sa.Integer(), server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "digest_entries",
        sa.Column("id", sa.Uuid(), nullable=False, default=sa.text("gen_random_uuid()")),
        sa.Column("digest_id", sa.Uuid(), sa.ForeignKey("digests.id"), nullable=False),
        sa.Column("content_item_id", sa.Uuid(), sa.ForeignKey("content_items.id"), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("topic", sa.String(255), nullable=False),
        sa.Column("importance_score", sa.Float(), nullable=True),
        sa.Column("display_title", sa.String(1024), nullable=True),
        sa.Column("display_url", sa.String(2048), nullable=True),
        sa.Column("source_name", sa.String(255), nullable=True),
        sa.Column("source_type", sa.String(50), nullable=True),
        sa.Column("is_from_vip", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("vip_name", sa.String(255), nullable=True),
        sa.Column("author", sa.String(255), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_digest_entries_digest_topic", "digest_entries", ["digest_id", "topic"])


def downgrade() -> None:
    op.drop_table("digest_entries")
    op.drop_table("digests")
    op.drop_table("seen_content")
    op.drop_table("content_items")
    op.drop_table("vip_people")
    op.drop_table("content_sources")
