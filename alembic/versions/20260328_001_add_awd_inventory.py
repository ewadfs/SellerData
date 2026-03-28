"""Add AWD inventory table

Revision ID: awd001
Revises: None
Create Date: 2026-03-28
"""

from alembic import op
import sqlalchemy as sa

revision = "awd001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "awd_inventory",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("seller_sku", sa.String(255), nullable=True),
        sa.Column("fnsku", sa.String(255), nullable=True),
        sa.Column("asin", sa.String(20), nullable=True),
        sa.Column("total_onhand_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_inbound_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_transferring_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity_available", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity_reserved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity_inbound_working", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity_inbound_shipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity_inbound_receiving", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "snapshot_date"),
    )
    op.create_index("ix_awd_inventory_product_id", "awd_inventory", ["product_id"])
    op.create_index("ix_awd_inventory_seller_sku", "awd_inventory", ["seller_sku"])


def downgrade() -> None:
    op.drop_index("ix_awd_inventory_seller_sku", table_name="awd_inventory")
    op.drop_index("ix_awd_inventory_product_id", table_name="awd_inventory")
    op.drop_table("awd_inventory")
