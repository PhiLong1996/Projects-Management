"""Shared `sort_by` parsing for search/list endpoints (spec FR-07).

Every searchable resource (Project, Task, User) accepts a `sort_by` query
param using the same convention: a bare field name, or a field name
prefixed with `-` (descending) or `+` (ascending). A bare field name with
no prefix defaults to descending, matching this API's original Task search
behavior — kept here as the one shared implementation so Project and User
search behave identically instead of drifting.
"""
from typing import Tuple


def parse_sort(sort_by: str) -> Tuple[str, str]:
    """Parse a `sort_by` query param into `(field_name, order)`.

    `order` is always either "asc" or "desc".
    """
    if sort_by.startswith("-"):
        return sort_by[1:], "desc"
    if sort_by.startswith("+"):
        return sort_by[1:], "asc"
    return sort_by, "desc"
