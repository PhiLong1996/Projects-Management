from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from src.config import get_settings

settings = get_settings()

# 1. Create Async Engine
# echo=True prints SQL queries to console (useful for development)
async_engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    future=True,
)

# 2. Create Async Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# 3. Base class for all ORM models (models.py in modules will inherit from this)
class Base(DeclarativeBase):
    pass

# 4. Dependency to get DB session in FastAPI route handlers
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()