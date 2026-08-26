import uuid
from typing import List
from fastapi import APIRouter, Depends, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.comments import service
from src.modules.tasks.schemas import CommentCreate, CommentResponse, AttachmentResponse

router = APIRouter(prefix="/tasks/{task_id}", tags=["Comments & Attachments"])


# --- Comments ---

@router.post("/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    task_id: uuid.UUID,
    payload: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.create_comment(db, current_user, task_id, payload)


@router.get("/comments", response_model=List[CommentResponse])
async def list_comments(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.list_comments(db, current_user, task_id)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await service.delete_comment(db, current_user, task_id, comment_id)


# --- Attachments ---

@router.post("/attachments", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    task_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await file.read()
    return await service.upload_attachment(
        db, current_user, task_id, file.filename, file.content_type, contents
    )


@router.get("/attachments", response_model=List[AttachmentResponse])
async def list_attachments(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.list_attachments(db, current_user, task_id)
