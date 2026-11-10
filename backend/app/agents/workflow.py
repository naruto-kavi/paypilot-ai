
from pydantic import BaseModel, Field

from app.agents.shopping_agent import run_shopping_agent


class ShoppingRequest(BaseModel):
    message: str = Field(
        min_length=2,
        max_length=2000,
        description="User's shopping request",
    )

    budget: float = Field(
        default=60000,
        gt=0,
        le=10000000,
        description="Shopping budget in INR",
    )


class ShoppingResponse(BaseModel):
    success: bool
    agent: str
    response: str
    budget: float
    currency: str = "INR"


def process_shopping_request(
    request: ShoppingRequest,
) -> ShoppingResponse:
    """
    Process a user's request through the PayPilot AI agent.

    Args:
        request: Validated shopping request.

    Returns:
        Structured AI shopping response.
    """

    result = run_shopping_agent(
        user_message=request.message,
        user_budget=request.budget,
    )

    return ShoppingResponse(**result)
