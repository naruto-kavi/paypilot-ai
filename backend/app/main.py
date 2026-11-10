
import logging
import os
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app.database import Base, SessionLocal, engine
from app.models import Payment, PayPalWebhookEvent
from app.products import PRODUCTS, Product
from app.api.agent import router as agent_router


# --------------------------------------------------
# Environment and logging
# --------------------------------------------------

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --------------------------------------------------
# PayPal Sandbox configuration
# --------------------------------------------------

PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com"

PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")
PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID")

PAYPAL_RETURN_URL = os.getenv(
    "PAYPAL_RETURN_URL",
    "http://localhost:3000/checkout/success",
)

PAYPAL_CANCEL_URL = os.getenv(
    "PAYPAL_CANCEL_URL",
    "http://localhost:3000/checkout/cancel",
)

# Demo conversion rate only. Not a live exchange rate.
INR_TO_USD_RATE = Decimal("87.00")


# --------------------------------------------------
# Request models
# --------------------------------------------------

class CreateOrderRequest(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=5)


class CaptureOrderRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=100)


# --------------------------------------------------
# FastAPI initialization
# --------------------------------------------------

app = FastAPI(
    title="PayPilot AI API",
    description="AI-powered shopping assistant with PayPal Sandbox payments.",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://paypilot-ai-v.vercel.app",
        "https://paypilot-ai-rbcg5nyib-bharkavipms-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(agent_router, prefix="/api")


# --------------------------------------------------
# PayPal helper functions
# --------------------------------------------------

async def get_paypal_access_token(client: httpx.AsyncClient):
    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="PayPal Sandbox credentials are not configured.",
        )

    response = await client.post(
        f"{PAYPAL_BASE_URL}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        headers={
            "Accept": "application/json",
            "Accept-Language": "en_US",
        },
    )

    if response.status_code != 200:
        logger.error("PayPal authentication failed: %s", response.text)
        raise HTTPException(
            status_code=502,
            detail="PayPal authentication failed.",
        )

    token = response.json().get("access_token")

    if not token:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return an access token.",
        )

    return token


def calculate_usd_amount(product, quantity):
    total_inr = Decimal(str(product.price)) * quantity

    total_usd = (total_inr / INR_TO_USD_RATE).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )

    return total_inr, total_usd


def get_product_from_order(order_details):
    """
    Validate PayPilot metadata and the expected order amount.
    Returns trusted product and quantity information.
    """

    purchase_units = order_details.get("purchase_units", [])

    if len(purchase_units) != 1:
        raise HTTPException(
            status_code=400,
            detail="Invalid PayPilot order structure.",
        )

    purchase_unit = purchase_units[0]
    custom_id = purchase_unit.get("custom_id", "")

    try:
        prefix, product_id_text, quantity_text = custom_id.split(":")
        product_id = int(product_id_text)
        quantity = int(quantity_text)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail="This order does not belong to PayPilot AI.",
        )

    if prefix != "paypilot" or not 1 <= quantity <= 5:
        raise HTTPException(
            status_code=400,
            detail="Invalid PayPilot order metadata.",
        )

    product = next(
        (item for item in PRODUCTS if item.id == product_id),
        None,
    )

    if product is None:
        raise HTTPException(
            status_code=400,
            detail="The product associated with this order is invalid.",
        )

    expected_inr, expected_usd = calculate_usd_amount(
        product,
        quantity,
    )

    expected_amount = f"{expected_usd:.2f}"

    paypal_amount = purchase_unit.get("amount", {})

    if (
        paypal_amount.get("currency_code") != "USD"
        or paypal_amount.get("value") != expected_amount
    ):
        raise HTTPException(
            status_code=400,
            detail="PayPal order amount verification failed.",
        )

    return (
        product,
        quantity,
        expected_inr,
        expected_amount,
        purchase_unit,
    )


def build_payment_response(
    order_id,
    order_details,
    product,
    quantity,
    expected_inr,
    expected_amount,
    already_captured=False,
):
    """
    Build one consistent receipt response for both new
    captures and orders that were captured previously.
    """

    purchase_units = order_details.get("purchase_units", [])

    captures = (
        purchase_units[0]
        .get("payments", {})
        .get("captures", [])
        if purchase_units
        else []
    )

    completed_capture = next(
        (
            capture
            for capture in captures
            if capture.get("status") == "COMPLETED"
        ),
        None,
    )

    if not completed_capture:
        raise HTTPException(
            status_code=502,
            detail="PayPal has not returned a completed capture.",
        )

    capture_amount = completed_capture.get("amount", {})

    if (
        capture_amount.get("currency_code") != "USD"
        or capture_amount.get("value") != expected_amount
    ):
        raise HTTPException(
            status_code=400,
            detail="PayPal capture amount verification failed.",
        )

    return {
        "success": True,
        "message": (
            "Payment was already captured successfully."
            if already_captured
            else "Payment completed successfully!"
        ),
        "already_captured": already_captured,
        "order_id": order_id,
        "capture_id": completed_capture.get("id"),
        "status": order_details.get("status"),
        "capture_status": completed_capture.get("status"),
        "product": product.name,
        "product_id": product.id,
        "quantity": quantity,
        "amount": expected_amount,
        "currency": "USD",
        "original_amount_inr": f"{expected_inr:.2f}",
    }


def save_payment_record(receipt: dict) -> bool:
    """
    Save a PayPal-verified completed payment.
    Returns False on a database error so a confirmed PayPal payment
    is not misreported as failed.
    """
    db = SessionLocal()
    try:
        order_id = receipt["order_id"]
        capture_id = receipt["capture_id"]

        payment = (
            db.query(Payment)
            .filter(Payment.paypal_order_id == order_id)
            .first()
        )

        if payment is None:
            payment = Payment(
                paypal_order_id=order_id,
                paypal_capture_id=capture_id,
                product_id=receipt["product_id"],
                product_name=receipt["product"],
                quantity=receipt["quantity"],
                original_amount_inr=Decimal(receipt["original_amount_inr"]),
                amount_usd=Decimal(receipt["amount"]),
                currency=receipt["currency"],
                status=receipt["capture_status"],
            )
            db.add(payment)
        else:
            # Refresh an existing row without creating a duplicate.
            payment.paypal_capture_id = capture_id
            payment.product_id = receipt["product_id"]
            payment.product_name = receipt["product"]
            payment.quantity = receipt["quantity"]
            payment.original_amount_inr = Decimal(receipt["original_amount_inr"])
            payment.amount_usd = Decimal(receipt["amount"])
            payment.currency = receipt["currency"]
            payment.status = receipt["capture_status"]

        db.commit()
        logger.info("Payment history saved for PayPal order %s", order_id)
        return True

    except SQLAlchemyError:
        db.rollback()
        logger.exception(
            "Could not save payment history for order %s",
            receipt.get("order_id"),
        )
        return False
    finally:
        db.close()


def persist_receipt(receipt: dict) -> dict:
    """Persist receipt where possible and expose the persistence result."""
    receipt["history_saved"] = save_payment_record(receipt)
    return receipt



async def get_paypal_order(client, order_id, headers):
    response = await client.get(
        f"{PAYPAL_BASE_URL}/v2/checkout/orders/{order_id}",
        headers=headers,
    )

    if response.status_code != 200:
        logger.error("PayPal order lookup failed: %s", response.text)

        raise HTTPException(
            status_code=404,
            detail="PayPal order could not be found.",
        )

    return response.json()


# --------------------------------------------------
# Root and health endpoints
# --------------------------------------------------

@app.get("/")
def root():
    return {
        "message": "Welcome to PayPilot AI",
        "status": "running",
        "version": "1.2.0",
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "PayPilot AI Backend",
    }


# --------------------------------------------------
# Product endpoints
# --------------------------------------------------

@app.get("/api/products", response_model=list[Product])
def get_products(
    q: str = Query(default=""),
    max_price: float | None = Query(default=None, gt=0),
):
    results = PRODUCTS

    if q.strip():
        keyword = q.lower().strip()

        results = [
            product
            for product in results
            if keyword in product.name.lower()
            or keyword in product.description.lower()
            or keyword in product.category.lower()
            or keyword in product.ram.lower()
            or keyword in product.storage.lower()
        ]

    if max_price is not None:
        results = [
            product
            for product in results
            if product.price <= max_price
        ]

    return results


@app.get("/api/products/{product_id}", response_model=Product)
def get_product(product_id: int):
    product = next(
        (item for item in PRODUCTS if item.id == product_id),
        None,
    )

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found.",
        )

    return product


# --------------------------------------------------
# Create PayPal order
# --------------------------------------------------

@app.post("/api/payments/create-order")
async def create_paypal_order(request: CreateOrderRequest):

    product = next(
        (item for item in PRODUCTS if item.id == request.product_id),
        None,
    )

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found.",
        )

    total_inr, total_usd = calculate_usd_amount(
        product,
        request.quantity,
    )

    amount_value = f"{total_usd:.2f}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:

            access_token = await get_paypal_access_token(client)

            order_payload = {
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "custom_id": (
                            f"paypilot:{product.id}:{request.quantity}"
                        ),
                        "description": product.name,
                        "amount": {
                            "currency_code": "USD",
                            "value": amount_value,
                        },
                    }
                ],
                "application_context": {
                    "brand_name": "PayPilot AI",
                    "landing_page": "BILLING",
                    "user_action": "PAY_NOW",
                    "return_url": PAYPAL_RETURN_URL,
                    "cancel_url": PAYPAL_CANCEL_URL,
                },
            }

            response = await client.post(
                f"{PAYPAL_BASE_URL}/v2/checkout/orders",
                json=order_payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
            )

            if response.status_code not in (200, 201):
                logger.error(
                    "PayPal order creation failed: %s",
                    response.text,
                )

                raise HTTPException(
                    status_code=502,
                    detail="PayPal could not create the order.",
                )

            order_data = response.json()

            approval_url = next(
                (
                    link["href"]
                    for link in order_data.get("links", [])
                    if link.get("rel") == "approve"
                ),
                None,
            )

            if not approval_url:
                raise HTTPException(
                    status_code=502,
                    detail="PayPal approval URL was not returned.",
                )

            return {
                "success": True,
                "order_id": order_data["id"],
                "status": order_data.get("status"),
                "product": product.name,
                "product_id": product.id,
                "quantity": request.quantity,
                "amount": amount_value,
                "currency": "USD",
                "original_amount_inr": f"{total_inr:.2f}",
                "demo_conversion_rate": str(INR_TO_USD_RATE),
                "approval_url": approval_url,
            }

    except httpx.TimeoutException:
        logger.exception("PayPal order request timed out.")

        raise HTTPException(
            status_code=504,
            detail="PayPal request timed out.",
        )

    except httpx.RequestError:
        logger.exception("PayPal connection error.")

        raise HTTPException(
            status_code=502,
            detail="Could not connect to PayPal.",
        )


# --------------------------------------------------
# Capture and verify PayPal payment
# --------------------------------------------------

@app.post("/api/payments/capture-order")
async def capture_paypal_order(request: CaptureOrderRequest):

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:

            access_token = await get_paypal_access_token(client)

            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }

            # Step 1: Retrieve order from PayPal.
            order_details = await get_paypal_order(
                client,
                request.order_id,
                headers,
            )

            # Step 2: Validate PayPilot metadata and amount.
            (
                product,
                quantity,
                expected_inr,
                expected_amount,
                purchase_unit,
            ) = get_product_from_order(order_details)

            # Step 3: If already captured, return the existing receipt.
            if order_details.get("status") == "COMPLETED":

                logger.info(
                    "Order %s was already captured. Returning existing receipt.",
                    request.order_id,
                )

                return persist_receipt(build_payment_response(
                    request.order_id,
                    order_details,
                    product,
                    quantity,
                    expected_inr,
                    expected_amount,
                    already_captured=True,
                ))

            # Step 4: Only approved orders can be captured.
            if order_details.get("status") != "APPROVED":
                raise HTTPException(
                    status_code=400,
                    detail="The buyer has not approved this PayPal order.",
                )

            # Step 5: Capture using a stable request ID.
            # Retries for the same order use the same ID.
            capture_headers = {
                **headers,
                "PayPal-Request-Id": f"paypilot-{request.order_id}",
            }

            capture_response = await client.post(
                (
                    f"{PAYPAL_BASE_URL}/v2/checkout/orders/"
                    f"{request.order_id}/capture"
                ),
                headers=capture_headers,
                json={},
            )

            if capture_response.status_code not in (200, 201):

                logger.warning(
                    "PayPal capture response: status=%s body=%s",
                    capture_response.status_code,
                    capture_response.text,
                )

                # A concurrent or previous request may have completed
                # the capture. Check PayPal again before returning error.
                latest_order = await get_paypal_order(
                    client,
                    request.order_id,
                    headers,
                )

                if latest_order.get("status") == "COMPLETED":
                    return persist_receipt(build_payment_response(
                        request.order_id,
                        latest_order,
                        product,
                        quantity,
                        expected_inr,
                        expected_amount,
                        already_captured=True,
                    ))

                raise HTTPException(
                    status_code=502,
                    detail="PayPal payment capture failed.",
                )

            # Step 6: Retrieve final order details from PayPal.
            # This ensures the response uses the authoritative
            # order and capture information.
            final_order = await get_paypal_order(
                client,
                request.order_id,
                headers,
            )

            if final_order.get("status") != "COMPLETED":
                raise HTTPException(
                    status_code=402,
                    detail="Payment has not been completed.",
                )

            # Step 7: Return verified receipt.
            return persist_receipt(build_payment_response(
                request.order_id,
                final_order,
                product,
                quantity,
                expected_inr,
                expected_amount,
                already_captured=False,
            ))

    except HTTPException:
        raise

    except httpx.TimeoutException:
        logger.exception("PayPal capture request timed out.")

        raise HTTPException(
            status_code=504,
            detail="PayPal capture request timed out.",
        )

    except httpx.RequestError:
        logger.exception("PayPal capture connection error.")

        raise HTTPException(
            status_code=502,
            detail="Could not connect to PayPal.",
        )


# --------------------------------------------------
# PayPal webhook verification and event handling
# --------------------------------------------------

@app.post("/api/payments/paypal-webhook")
async def paypal_webhook(request: Request):
    """Verify PayPal's signature, then record and process the event."""

    if not PAYPAL_WEBHOOK_ID:
        logger.error("PAYPAL_WEBHOOK_ID is not configured.")
        raise HTTPException(
            status_code=503,
            detail="PayPal webhook is not configured.",
        )

    # Preserve the incoming event exactly as PayPal sent it for verification.
    try:
        event_payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook JSON.")

    if not isinstance(event_payload, dict) or not event_payload.get("id") or not event_payload.get("event_type"):
        raise HTTPException(status_code=400, detail="Invalid PayPal webhook event.")

    headers = request.headers
    required_headers = {
        "transmission_id": headers.get("paypal-transmission-id"),
        "transmission_time": headers.get("paypal-transmission-time"),
        "cert_url": headers.get("paypal-cert-url"),
        "auth_algo": headers.get("paypal-auth-algo"),
        "transmission_sig": headers.get("paypal-transmission-sig"),
    }

    if not all(required_headers.values()):
        raise HTTPException(
            status_code=400,
            detail="Required PayPal signature headers are missing.",
        )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            access_token = await get_paypal_access_token(client)
            verification_response = await client.post(
                f"{PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json={
                    **required_headers,
                    "webhook_id": PAYPAL_WEBHOOK_ID,
                    "webhook_event": event_payload,
                },
            )

        if verification_response.status_code != 200:
            logger.error(
                "PayPal webhook signature verification API failed: %s",
                verification_response.text,
            )
            raise HTTPException(
                status_code=502,
                detail="Could not verify PayPal webhook signature.",
            )

        verification_status = verification_response.json().get("verification_status")
        if verification_status != "SUCCESS":
            logger.warning(
                "Rejected unverified PayPal webhook event %s",
                event_payload.get("id"),
            )
            raise HTTPException(
                status_code=400,
                detail="PayPal webhook signature verification failed.",
            )

    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.exception("PayPal webhook verification timed out.")
        raise HTTPException(status_code=504, detail="Webhook verification timed out.")
    except httpx.RequestError:
        logger.exception("Could not connect to PayPal to verify webhook.")
        raise HTTPException(status_code=502, detail="Could not verify webhook with PayPal.")

    event_id = str(event_payload["id"])
    event_type = str(event_payload["event_type"])
    resource = event_payload.get("resource") or {}
    resource_id = resource.get("id") if isinstance(resource, dict) else None

    db = SessionLocal()
    try:
        existing_event = (
            db.query(PayPalWebhookEvent)
            .filter(PayPalWebhookEvent.paypal_event_id == event_id)
            .first()
        )
        if existing_event is not None:
            logger.info("Ignoring duplicate PayPal webhook event %s", event_id)
            return {"success": True, "duplicate": True, "event_id": event_id}

        webhook_record = PayPalWebhookEvent(
            paypal_event_id=event_id,
            event_type=event_type,
            resource_id=resource_id,
            signature_verified=True,
            processing_status="received",
            event_payload=event_payload,
        )
        db.add(webhook_record)
        db.flush()

        # Only update a payment when the event references a capture already
        # associated with a locally verified PayPal order.
        capture_status_by_event = {
            "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
            "PAYMENT.CAPTURE.DENIED": "DENIED",
            "PAYMENT.CAPTURE.REFUNDED": "REFUNDED",
            "PAYMENT.CAPTURE.REVERSED": "REVERSED",
        }
        new_payment_status = capture_status_by_event.get(event_type)

        if new_payment_status and resource_id:
            payment = (
                db.query(Payment)
                .filter(Payment.paypal_capture_id == str(resource_id))
                .first()
            )
            if payment is not None:
                payment.status = new_payment_status

        webhook_record.processing_status = "processed"
        webhook_record.processed_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(
            "Verified and recorded PayPal webhook event %s (%s)",
            event_id,
            event_type,
        )
        return {"success": True, "duplicate": False, "event_id": event_id}

    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not save PayPal webhook event %s", event_id)
        raise HTTPException(status_code=500, detail="Could not save webhook event.")
    finally:
        db.close()


# --------------------------------------------------
# Payment history
# --------------------------------------------------

@app.get("/api/payments/history")
def get_payment_history(limit: int = Query(default=50, ge=1, le=100),
                        offset: int = Query(default=0, ge=0)):
    """Return most recent saved PayPal payments."""
    db = SessionLocal()
    try:
        payments = (
            db.query(Payment)
            .order_by(Payment.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        return {
            "success": True,
            "count": len(payments),
            "payments": [
                {
                    "id": payment.id,
                    "order_id": payment.paypal_order_id,
                    "capture_id": payment.paypal_capture_id,
                    "product_id": payment.product_id,
                    "product": payment.product_name,
                    "quantity": payment.quantity,
                    "original_amount_inr": str(payment.original_amount_inr),
                    "amount": str(payment.amount_usd),
                    "currency": payment.currency,
                    "status": payment.status,
                    "created_at": (
                        payment.created_at.isoformat()
                        if payment.created_at else None
                    ),
                }
                for payment in payments
            ],
        }
    except SQLAlchemyError:
        logger.exception("Could not retrieve payment history.")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve payment history.",
        )
    finally:
        db.close()



# --------------------------------------------------
# Startup and shutdown
# --------------------------------------------------

@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)
    logger.info("Payment database tables initialized.")
    logger.info("PayPilot AI backend started successfully.")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("PayPilot AI backend shutting down.")
