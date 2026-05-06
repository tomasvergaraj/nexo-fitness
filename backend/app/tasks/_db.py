"""Helpers compartidos por tareas Celery que necesitan acceso a DB.

Cada llamada Celery corre `asyncio.run(...)` en un loop nuevo. Usar el engine
global (con `pool_pre_ping=True`) provoca `RuntimeError: got Future attached
to a different loop` cuando el pool intenta reusar conexiones asyncpg ligadas
a un loop anterior. Para evitarlo, cada task crea su propio engine con
`NullPool` y lo descarta al terminar.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings


@asynccontextmanager
async def task_session() -> AsyncIterator[AsyncSession]:
    """Yield un AsyncSession con engine NullPool dedicado y disposed al salir."""
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as session:
            yield session
    finally:
        await engine.dispose()
