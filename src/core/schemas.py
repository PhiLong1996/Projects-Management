"""Shared response envelope for every paginated list/search endpoint.

Used by Project, Task, and User search/listing (spec FR-07: "Cho phép tìm
kiếm: Project, Task, User — có thể hỗ trợ Filter, Sort, Pagination") so all
three expose the same `{"items": [...], "pagination": {...}}` shape instead
of each module inventing its own.
"""
from typing import Generic, List, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    pagination: PaginationMeta
