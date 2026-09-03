// Mirrors src/modules/*/schemas.py in the FastAPI backend. Keep in sync
// with CODEBASE_SUMMARY.md's API section if the backend contract changes.

export type SystemRole = "ADMIN" | "PROJECT_MANAGER" | "TEAM_MEMBER";
export type UserStatus = "ACTIVE" | "LOCKED" | "INACTIVE";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "CLOSED";
export type ProjectRole = "MANAGER" | "MEMBER";
export type SprintStatus = "PLANNED" | "ACTIVE" | "CLOSED";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_REASSIGNED"
  | "TASK_STATUS_CHANGED"
  | "TASK_UPDATED"
  | "COMMENT_ADDED"
  | "DEADLINE_APPROACHING"
  | "TASK_OVERDUE"
  | "PROJECT_MEMBER_ADDED";

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface TokenUser {
  id: string;
  email: string;
  full_name: string;
  system_role: SystemRole;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: TokenUser;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  system_role: SystemRole;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  project_role: ProjectRole;
  is_active: boolean;
  joined_at: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user: {
    id: string;
    full_name: string;
    email: string;
    system_role: SystemRole;
    status: UserStatus;
  };
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  sprint_id: string | null;
  assignee_id: string | null;
  reporter_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  task_id: string;
  actor_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  original_name: string;
  storage_key: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

export interface DashboardStats {
  scope: { project_id: string; sprint_id: string | null } | null;
  summary: {
    total_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
    completion_rate: number;
  };
  tasks_by_status: { status: string; count: number }[];
  tasks_by_priority: { priority: string; count: number }[];
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface PaginatedNotifications {
  items: Notification[];
  total_items: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiErrorBody {
  detail?: string | { code?: string; message?: string } | Array<{ msg: string; loc: (string | number)[] }>;
}
