"""Business logic for task comments and attachments (AC-07)."""
import os
import uuid
from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.modules.comments.models import Comment, Attachment
from src.modules.notifications.service import create_event_notification
from src.modules.notifications.models import NotificationType
from src.modules.projects.models import ProjectMember, ProjectRole
from src.modules.tasks.models import Task
from src.modules.tasks.schemas import CommentCreate
from src.modules.users.models import User, SystemRole

settings = get_settings()
MAX_FILE_SIZE_BYTES = settings.max_file_size_bytes
ALLOWED_MIME_TYPES = settings.allowed_mime_types
ALLOWED_EXTENSIONS = settings.allowed_extensions


async def check_task_access(task_id: uuid.UUID, user: User, db: AsyncSession) -> Task:
    task_res = await db.execute(select(Task).where(Task.id == task_id))
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if user.system_role == SystemRole.ADMIN:
        return task

    # Check active project membership for view/interact access
    member_res = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == task.project_id,
            ProjectMember.user_id == user.id,
            ProjectMember.is_active == True,
        )
    )
    if not member_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this task's project.",
        )
    return task


# --- Comments ---

async def create_comment(
    db: AsyncSession, current_user: User, task_id: uuid.UUID, payload: CommentCreate
) -> Comment:
    task = await check_task_access(task_id, current_user, db)

    comment = Comment(task_id=task_id, author_id=current_user.id, content=payload.content)
    db.add(comment)

    # Trigger notifications: COMMENT_ADDED
    # Recipient: assignee and reporter, excluding the comment author
    recipients = set()
    if task.assignee_id and task.assignee_id != current_user.id:
        recipients.add(task.assignee_id)
    if task.reporter_id and task.reporter_id != current_user.id:
        recipients.add(task.reporter_id)

    for recipient_id in recipients:
        await create_event_notification(
            db=db,
            recipient_id=recipient_id,
            project_id=task.project_id,
            type=NotificationType.COMMENT_ADDED,
            title="New Comment Added",
            message=f"A new comment was added to task '{task.title}' by {current_user.full_name}.",
            entity_type="TASK",
            entity_id=task.id,
        )

    await db.commit()
    await db.refresh(comment)
    return comment


async def list_comments(db: AsyncSession, current_user: User, task_id: uuid.UUID) -> List[Comment]:
    await check_task_access(task_id, current_user, db)
    result = await db.execute(
        select(Comment).where(Comment.task_id == task_id).order_by(Comment.created_at.asc())
    )
    return result.scalars().all()


async def delete_comment(
    db: AsyncSession, current_user: User, task_id: uuid.UUID, comment_id: uuid.UUID
) -> None:
    task = await check_task_access(task_id, current_user, db)

    comm_res = await db.execute(
        select(Comment).where(Comment.id == comment_id, Comment.task_id == task_id)
    )
    comment = comm_res.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    # Author can delete their own; Admin or PM of the project can delete any
    if comment.author_id != current_user.id and current_user.system_role != SystemRole.ADMIN:
        pm_res = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == task.project_id,
                ProjectMember.user_id == current_user.id,
                ProjectMember.project_role == ProjectRole.MANAGER,
                ProjectMember.is_active == True,
            )
        )
        if not pm_res.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only delete your own comments unless you are a Project Manager or Admin.",
            )

    await db.delete(comment)
    await db.commit()


# --- Attachments ---

async def upload_attachment(
    db: AsyncSession,
    current_user: User,
    task_id: uuid.UUID,
    filename: str,
    content_type: str,
    contents: bytes,
) -> Attachment:
    await check_task_access(task_id, current_user, db)

    # Validate extension & MIME type
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File type or extension not allowed by security policy.",
        )

    # Validate size
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    # Store file locally
    upload_dir = f"uploads/tasks/{task_id}"
    os.makedirs(upload_dir, exist_ok=True)
    saved_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(upload_dir, saved_filename)

    with open(file_path, "wb") as f:
        f.write(contents)

    attachment = Attachment(
        task_id=task_id,
        uploaded_by=current_user.id,
        original_name=filename,
        storage_key=file_path,
        size_bytes=len(contents),
        content_type=content_type,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return attachment


async def list_attachments(db: AsyncSession, current_user: User, task_id: uuid.UUID) -> List[Attachment]:
    await check_task_access(task_id, current_user, db)
    result = await db.execute(
        select(Attachment).where(Attachment.task_id == task_id).order_by(Attachment.created_at.desc())
    )
    return result.scalars().all()
