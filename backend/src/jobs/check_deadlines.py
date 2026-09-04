"""
Scheduled job: check task deadlines and emit DEADLINE_APPROACHING / TASK_OVERDUE notifications.

Run periodically via cron, e.g.:
    python -m src.jobs.check_deadlines
"""
import asyncio
import logging
from typing import Optional
from datetime import datetime, timedelta, date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.modules.tasks.models import Task, TaskStatus
from src.modules.projects.models import ProjectMember, ProjectRole
from src.modules.notifications.models import NotificationType
from src.modules.notifications.service import create_event_notification

logger = logging.getLogger("jobs.check_deadlines")


def _due_date_value(task: Task) -> Optional[date]:
    if not task.due_date:
        return None
    return task.due_date.date() if hasattr(task.due_date, "date") else task.due_date


async def check_deadlines(session: AsyncSession) -> dict:
    now = datetime.utcnow()
    today = now.date()
    approaching_window_end = now + timedelta(hours=24)
    stats = {"deadline_approaching": 0, "task_overdue": 0}

    active_statuses = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW]
    result = await session.execute(
        select(Task).where(
            Task.due_date.isnot(None),
            Task.status.in_(active_statuses),
            Task.assignee_id.isnot(None),
        )
    )
    tasks = result.scalars().all()

    for task in tasks:
        due = _due_date_value(task)
        if not due:
            continue

        assignee_id = task.assignee_id

        # DEADLINE_APPROACHING: within next 24 hours, not yet overdue
        if task.due_date and task.due_date <= approaching_window_end and task.due_date > now:
            event_key = f"DEADLINE_APPROACHING:TASK:{task.id}:{assignee_id}"
            await create_event_notification(
                db=session,
                recipient_id=assignee_id,
                project_id=task.project_id,
                type=NotificationType.DEADLINE_APPROACHING,
                title="Deadline Approaching",
                message=f"Task '{task.title}' is due within 24 hours.",
                entity_type="TASK",
                entity_id=task.id,
                event_key=event_key,
            )
            stats["deadline_approaching"] += 1

        # TASK_OVERDUE: due date before today
        if due < today:
            assignee_key = f"TASK_OVERDUE:TASK:{task.id}:{assignee_id}"
            await create_event_notification(
                db=session,
                recipient_id=assignee_id,
                project_id=task.project_id,
                type=NotificationType.TASK_OVERDUE,
                title="Task Overdue",
                message=f"Task '{task.title}' is overdue.",
                entity_type="TASK",
                entity_id=task.id,
                event_key=assignee_key,
            )
            stats["task_overdue"] += 1

            pm_result = await session.execute(
                select(ProjectMember.user_id).where(
                    ProjectMember.project_id == task.project_id,
                    ProjectMember.project_role == ProjectRole.MANAGER,
                    ProjectMember.is_active == True,
                )
            )
            for pm_id in pm_result.scalars().all():
                if pm_id == assignee_id:
                    continue
                pm_key = f"TASK_OVERDUE:TASK:{task.id}:{pm_id}"
                await create_event_notification(
                    db=session,
                    recipient_id=pm_id,
                    project_id=task.project_id,
                    type=NotificationType.TASK_OVERDUE,
                    title="Task Overdue",
                    message=f"Task '{task.title}' in your project is overdue.",
                    entity_type="TASK",
                    entity_id=task.id,
                    event_key=pm_key,
                )
                stats["task_overdue"] += 1

    await session.commit()
    return stats


async def deadline_check_loop(interval_seconds: int) -> None:
    """Run check_deadlines() forever on a fixed interval, for the lifetime of
    the app process. Started as a background asyncio task from app.py's
    lifespan (same pattern as core/realtime.py's redis_subscriber_loop) so
    DEADLINE_APPROACHING / TASK_OVERDUE notifications get generated
    automatically whenever the backend web process is running, instead of
    depending on an external cron entry calling `python -m
    src.jobs.check_deadlines` separately.

    A failed run (e.g. a transient DB hiccup) is logged and swallowed rather
    than crashing the loop / the app — the next scheduled run just tries
    again. CancelledError (from task.cancel() on shutdown) is re-raised so
    the loop actually stops instead of retrying forever.
    """
    while True:
        try:
            async with AsyncSessionLocal() as session:
                stats = await check_deadlines(session)
                logger.info("Deadline check complete: %s", stats)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Deadline check run failed; will retry next interval", exc_info=True)
        await asyncio.sleep(interval_seconds)

async def main():
    async with AsyncSessionLocal() as session:
        stats = await check_deadlines(session)
        print(f"Deadline check complete: {stats}")


if __name__ == "__main__":
    asyncio.run(main())
