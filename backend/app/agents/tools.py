
import json

from langchain_core.tools import tool

from app.products import PRODUCTS


@tool
def search_products(
    query: str = "",
    max_price: float = 100000,
) -> str:
    """
    Search the product catalog using keywords and a maximum price.

    Args:
        query: Product name, category, or description keyword.
        max_price: Maximum acceptable product price in INR.

    Returns:
        Matching products in JSON format.
    """

    keyword = query.lower().strip()

    results = []

    for product in PRODUCTS:

        matches_query = (
            not keyword
            or keyword in product.name.lower()
            or keyword in product.category.lower()
            or keyword in product.description.lower()
            or keyword in product.ram.lower()
            or keyword in product.storage.lower()
        )

        matches_budget = product.price <= max_price

        if matches_query and matches_budget:
            results.append(product.model_dump())

    if not results:
        return json.dumps({
            "success": True,
            "message": "No matching products found.",
            "products": [],
        })

    return json.dumps({
        "success": True,
        "count": len(results),
        "products": results,
    })


@tool
def compare_products(product_ids: list[int]) -> str:
    """
    Compare multiple products using their IDs.

    Args:
        product_ids: List of product IDs to compare.

    Returns:
        Product specifications and prices.
    """

    if len(product_ids) < 2:
        return json.dumps({
            "success": False,
            "message": "At least two product IDs are required.",
        })

    selected_products = [
        product
        for product in PRODUCTS
        if product.id in product_ids
    ]

    if len(selected_products) != len(set(product_ids)):
        return json.dumps({
            "success": False,
            "message": "One or more product IDs are invalid.",
        })

    selected_products.sort(key=lambda product: product.price)

    cheapest = selected_products[0]

    return json.dumps({
        "success": True,
        "comparison": [
            product.model_dump()
            for product in selected_products
        ],
        "cheapest_product": cheapest.name,
        "cheapest_price": cheapest.price,
        "currency": "INR",
    })


@tool
def check_budget(
    product_price: float,
    user_budget: float,
) -> str:
    """
    Check whether a product is affordable within the user's budget.

    Args:
        product_price: Product price in INR.
        user_budget: User's available shopping budget in INR.

    Returns:
        Affordability information and remaining budget.
    """

    if product_price < 0 or user_budget < 0:
        return json.dumps({
            "success": False,
            "message": "Price and budget cannot be negative.",
        })

    affordable = product_price <= user_budget

    remaining = user_budget - product_price

    return json.dumps({
        "success": True,
        "affordable": affordable,
        "product_price": product_price,
        "user_budget": user_budget,
        "remaining_budget": remaining if affordable else 0,
        "additional_amount_needed": (
            abs(remaining) if not affordable else 0
        ),
        "currency": "INR",
        "message": (
            "Product is within your budget."
            if affordable
            else "Product exceeds your budget."
        ),
    })


# All tools available to the PayPilot AI agent.
PAYPILOT_TOOLS = [
    search_products,
    compare_products,
    check_budget,
]
