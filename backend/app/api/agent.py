
import logging

from fastapi import APIRouter, HTTPException

from app.agents.workflow import (
    ShoppingRequest,
    ShoppingResponse,
    process_shopping_request,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/agent",
    tags=["AI Shopping Agent"],
)


@router.post(
    "/chat",
    response_model=ShoppingResponse,
)
def chat_with_agent(request: ShoppingRequest):
    """
    Send a shopping request to PayPilot AI.

    Example:
    {
        "message": "Find a laptop for coding under 60000",
        "budget": 60000
    }
    """

    try:
        result = process_shopping_request(request)

        return result

    except ValueError as error:
        logger.warning("Invalid shopping request: %s", error)

        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception:
        logger.exception("PayPilot AI agent execution failed")

        raise HTTPException(
            status_code=502,
            detail=(
                "The AI shopping assistant is temporarily "
                "unavailable. Please try again."
            ),
        )
