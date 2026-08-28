import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from src.database import async_engine, Base
from src.core.realtime import redis_subscriber_loop
from src.modules.auth.router import router as auth_router
from src.modules.projects.router import router as projects_router
from src.modules.sprints.router import router as sprints_router
from src.modules.tasks.router import router as tasks_router
from src.modules.tasks.search_router import router as tasks_search_router
from src.modules.dashboard.router import router as dashboard_router
from src.modules.reporting.router import router as reporting_router
from src.modules.users.router import router as users_router
from src.modules.notifications.router import router as notifications_router
from src.modules.comments.router import router as comments_router

logger = logging.getLogger("app")

# Import all ORM models to register metadata
from src.modules.users.models import User
from src.modules.projects.models import Project, ProjectMember
from src.modules.sprints.models import Sprint
from src.modules.tasks.models import Task
from src.modules.comments.models import Comment, Attachment
from src.modules.notifications.models import Notification

import uvicorn

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize schema tables automatically in dev environment
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Seed default Admin user if database is empty
    from src.database import AsyncSessionLocal
    from src.modules.users.models import User, SystemRole, UserStatus
    from src.core.security import hash_password
    from src.config import get_settings
    from sqlalchemy import select

    settings = get_settings()
    async with AsyncSessionLocal() as session:
        async with session.begin():
            res = await session.execute(select(User).limit(1))
            if not res.scalar_one_or_none():
                admin_user = User(
                    email=settings.admin_email.strip().lower(),
                    full_name="Administrator",
                    password_hash=hash_password(settings.admin_password),
                    system_role=SystemRole.ADMIN,
                    status=UserStatus.ACTIVE
                )
                session.add(admin_user)

    # Background task: stays subscribed to Redis for the app's lifetime so
    # notifications published by *any* instance (including this one) reach
    # the WebSocket connections this instance is holding. See
    # src/core/realtime.py's module docstring for the full delivery path.
    # If Redis isn't reachable, this retries quietly in the background
    # rather than blocking startup — notification creation and the REST
    # endpoints work regardless of whether realtime delivery is up.
    subscriber_task = asyncio.create_task(redis_subscriber_loop())

    yield

    subscriber_task.cancel()
    try:
        await subscriber_task
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.warning("Error while shutting down Redis subscriber task", exc_info=True)

    await async_engine.dispose()

app = FastAPI(
    title="Smart Task Management System API",
    version="1.0.0",
    lifespan=lifespan
)

# Route Registrations
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(sprints_router, prefix="/api/v1")
app.include_router(tasks_search_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(comments_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(reporting_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)