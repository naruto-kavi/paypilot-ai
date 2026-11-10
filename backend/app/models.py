
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    Numeric,
    String,
    Index,
    JSON,
)

from app.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)

    # PayPal transaction identifiers
    paypal_order_id = Column(String(100), nullable=False, unique=True)
    paypal_capture_id = Column(String(100), nullable=True, unique=True)

    # Product information
    product_id = Column(Integer, nullable=False)
    product_name = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)

    # Payment amounts
    original_amount_inr = Column(Numeric(12, 2), nullable=False)
    amount_usd = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), nullable=False, default="USD")

    # Payment status
    status = Column(String(30), nullable=False, default="COMPLETED")

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("idx_payment_order_id", "paypal_order_id"),
        Index("idx_payment_created_at", "created_at"),
    )

    def __repr__(self):
        return (
            f"<Payment("
            f"order_id={self.paypal_order_id}, "
            f"product={self.product_name}, "
            f"status={self.status})>"
        )


class PayPalWebhookEvent(Base):
    __tablename__ = "paypal_webhook_events"

    id = Column(Integer, primary_key=True, index=True)

    # Unique PayPal event identifier prevents duplicate processing.
    paypal_event_id = Column(
        String(100),
        nullable=False,
        unique=True,
    )

    # Example: PAYMENT.CAPTURE.COMPLETED
    event_type = Column(String(150), nullable=False)

    # PayPal resource identifier, such as capture or order ID.
    resource_id = Column(String(100), nullable=True)

    # Signature verification result.
    signature_verified = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    # received, processed, ignored, or failed
    processing_status = Column(
        String(30),
        nullable=False,
        default="received",
    )

    # Store the event payload for audit and troubleshooting.
    event_payload = Column(JSON, nullable=True)

    received_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    processed_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_webhook_event_type", "event_type"),
        Index("idx_webhook_received_at", "received_at"),
    )

    def __repr__(self):
        return (
            f"<PayPalWebhookEvent("
            f"event_id={self.paypal_event_id}, "
            f"type={self.event_type}, "
            f"status={self.processing_status})>"
        )
