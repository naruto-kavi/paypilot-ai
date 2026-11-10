
import re
from typing import Any

from app.products import PRODUCTS


def extract_requested_ram(message: str) -> str | None:
    """Extract RAM requirements such as 8GB or 16GB."""
    match = re.search(
        r"\b(4|8|16|32|64)\s*gb\s*(?:ram|memory)?\b",
        message,
        re.IGNORECASE,
    )

    if match:
        return f"{match.group(1)}GB"

    return None


def parse_amount(value: str) -> float:
    """Convert amounts such as 50,000, 50000, or 50k into numbers."""
    cleaned = value.lower().replace(",", "").replace("₹", "").strip()

    if cleaned.endswith("k"):
        return float(cleaned[:-1]) * 1000

    return float(cleaned)


def extract_message_budget(message: str) -> float | None:
    """
    Extract a budget explicitly mentioned in the user's message.

    Recognizes examples:
    - My budget is ₹50,000
    - under ₹45,000
    - below 60000
    - within 50k
    - maximum budget 55,000
    """
    amount_pattern = r"(?:₹\s*)?(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?k)"

    budget_patterns = [
        rf"(?:my\s+)?budget\s+(?:is|of|around|up\s+to)\s*{amount_pattern}",
        rf"(?:under|below|less\s+than|within|maximum|max)\s*{amount_pattern}",
        rf"(?:budget\s+limit|spend\s+limit)\s*(?:is|of)?\s*{amount_pattern}",
    ]

    extracted_amounts = []

    for pattern in budget_patterns:
        matches = re.findall(pattern, message, re.IGNORECASE)

        for match in matches:
            try:
                extracted_amounts.append(parse_amount(match))
            except (ValueError, TypeError):
                continue

    if extracted_amounts:
        # If more than one explicit budget is mentioned, use the lowest.
        return min(extracted_amounts)

    return None


def get_effective_budget(
    user_message: str,
    frontend_budget: float,
) -> float:
    """
    Use the lower of the slider budget and an explicit message budget.
    """
    message_budget = extract_message_budget(user_message)

    if message_budget is not None:
        return min(frontend_budget, message_budget)

    return frontend_budget


def get_matching_products(
    user_message: str,
    effective_budget: float,
) -> list[dict[str, Any]]:
    """
    Filter the actual catalog using the effective budget and requested RAM.
    """
    requested_ram = extract_requested_ram(user_message)
    message = user_message.lower()

    matches = []

    for product in PRODUCTS:
        if product.price > effective_budget:
            continue

        if requested_ram and product.ram.lower() != requested_ram.lower():
            continue

        if "laptop" in message and product.category.lower() != "laptop":
            continue

        matches.append(product.model_dump())

    return sorted(matches, key=lambda item: item["price"])


def format_product(product: dict[str, Any]) -> str:
    """Format a product using exact catalog data."""
    return (
        f"{product['name']} — ₹{product['price']:,.0f}\n"
        f"RAM: {product['ram']}\n"
        f"Storage: {product['storage']}\n"
        f"Description: {product['description']}"
    )


def build_catalog_response(
    user_message: str,
    effective_budget: float,
    products: list[dict[str, Any]],
) -> str:
    """Create a recommendation without using an LLM."""
    requested_ram = extract_requested_ram(user_message)

    if not products:
        response = (
            f"I couldn't find a matching product within "
            f"your budget of ₹{effective_budget:,.0f}."
        )

        if requested_ram:
            response += f" I checked for products with {requested_ram} RAM."

        response += (
            "\n\nYou can increase your budget or adjust your "
            "specifications to see more catalog options."
        )

        return response

    if len(products) == 1:
        product = products[0]
        remaining_budget = effective_budget - product["price"]

        return (
            f"Based on your budget of ₹{effective_budget:,.0f}, "
            f"you can afford:\n\n"
            f"{format_product(product)}\n\n"
            f"Remaining budget: ₹{remaining_budget:,.0f}\n\n"
            f"This product matches your requirements and is within "
            f"your budget."
        )

    message = user_message.lower()

    if any(word in message for word in ["compare", "comparison", "better"]):
        lines = [
            f"Here are the matching products within "
            f"your budget of ₹{effective_budget:,.0f}:"
        ]

        for product in products:
            lines.append(format_product(product))

        return "\n\n".join(lines)

    lines = [
        f"I found {len(products)} matching products within "
        f"your budget of ₹{effective_budget:,.0f}:"
    ]

    for product in products:
        lines.append(format_product(product))

    lines.append(
        "\nThese recommendations are based on the available product catalog."
    )

    return "\n\n".join(lines)


def run_shopping_agent(user_message: str, user_budget: float):
    """
    Process a shopping request using deterministic catalog filtering.
    """
    if not user_message or not user_message.strip():
        return {
            "success": False,
            "agent": "PayPilot AI",
            "response": "Please enter a shopping request.",
            "budget": user_budget,
            "currency": "INR",
        }

    if user_budget <= 0:
        return {
            "success": False,
            "agent": "PayPilot AI",
            "response": "Please provide a valid budget greater than zero.",
            "budget": user_budget,
            "currency": "INR",
        }

    try:
        effective_budget = get_effective_budget(
            user_message=user_message,
            frontend_budget=user_budget,
        )

        matching_products = get_matching_products(
            user_message=user_message,
            effective_budget=effective_budget,
        )

        response_text = build_catalog_response(
            user_message=user_message,
            effective_budget=effective_budget,
            products=matching_products,
        )

        return {
            "success": True,
            "agent": "PayPilot AI",
            "response": response_text,
            "budget": effective_budget,
            "currency": "INR",
        }

    except Exception as error:
        print(f"PayPilot AI error: {error}")

        return {
            "success": False,
            "agent": "PayPilot AI",
            "response": (
                "I encountered an issue while searching the product catalog. "
                "Please try again."
            ),
            "budget": user_budget,
            "currency": "INR",
        }
