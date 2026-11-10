
from pydantic import BaseModel


class Product(BaseModel):
    id: int
    name: str
    category: str
    price: float
    description: str
    ram: str
    storage: str


PRODUCTS = [
    Product(
        id=1,
        name="MacBook Air M2",
        category="Laptop",
        price=59999,
        description="Apple laptop for development and productivity",
        ram="8GB",
        storage="256GB SSD",
    ),
    Product(
        id=2,
        name="ASUS Vivobook 15",
        category="Laptop",
        price=52999,
        description="Laptop for coding and college",
        ram="16GB",
        storage="512GB SSD",
    ),
    Product(
        id=3,
        name="Lenovo IdeaPad Slim 5",
        category="Laptop",
        price=55999,
        description="Laptop for programming and multitasking",
        ram="16GB",
        storage="512GB SSD",
    ),
    Product(
        id=4,
        name="HP Pavilion 14",
        category="Laptop",
        price=64999,
        description="Premium laptop for productivity",
        ram="16GB",
        storage="512GB SSD",
    ),
    Product(
        id=5,
        name="Dell Inspiron 15",
        category="Laptop",
        price=48999,
        description="Affordable laptop for students",
        ram="8GB",
        storage="512GB SSD",
    ),
]
