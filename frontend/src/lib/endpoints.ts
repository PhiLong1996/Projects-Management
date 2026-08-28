// Thin typed wrappers, one per backend route. Grouped to mirror
// src/modules/*/router.py in the FastAPI app — see CODEBASE_SUMMARY.md §6
// for the full endpoint table this was built from.
import { api } from "./api";
import type {
  Attachment,
  AuditLog,
  Comment,
  DashboardStats,
  Notification,
  PaginatedNotifications,
  PaginatedResponse,
  Project,
  ProjectMember,
  Sprint,
  Task,
  TaskPriority,
  TaskStatus,
  TokenResponse,
  User,
} from "./types";

// --- Auth ---
export const authApi = {
  login: (email: string, password: string) =>
    api.post<TokenResponse>("/auth/login", { email, password }, { skipAuth: true }),
  logout: (refresh_token: string) => api.post<void>("/auth/logout", { refresh_token }),
  changePassword: (current_password: string, new_password: string) =>
    api.post<void>("/auth/change-password", { current_password, new_password }),
  forgotPassword: (email: string) =>
    api.post<void>("/auth/forgot-password", { email }, { skipAuth: true }),
  resetPassword: (token: string, new_password: string) =>
    api.post<void>("/auth/reset-password", { token, new_password }, { skipAuth: true }),
};

// --- Users ---
export const usersApi = {
  list: (params: { search?: string; status?: string; role?: string; sort_by?: string; page?: number; page_size?: number } = {}) =>
    api.get<PaginatedResponse<User>>("/users", params),
  create: (payload: { email: string; full_name: string; password: string; system_role: string }) =>
    api.post<User>("/users", payload),
  updateStatus: (userId: string, status: string) => api.patch<User>(`/users/${userId}/status`, { status }),
  updateRole: (userId: string, system_role: string) => api.patch<User>(`/users/${userId}/role`, { system_role }),
  updateProfile: (userId: string, payload: { email?: string; full_name?: string }) =>
    api.patch<User>(`/users/${userId}`, payload),
};

// --- Projects ---
export const projectsApi = {
  list: (params: { search?: string; status?: string; sort_by?: string; page?: number; page_size?: number } = {}) =>
    api.get<PaginatedResponse<Project>>("/projects", params),
  create: (payload: { code: string; name: string; description?: string; start_date?: string; end_date?: string }) =>
    api.post<Project>("/projects", payload),
  update: (projectId: string, payload: Partial<{ name: string; description: string; status: string; start_date: string; end_date: string }>) =>
    api.patch<Project>(`/projects/${projectId}`, payload),
  addMember: (projectId: string, user_id: string, project_role: string = "MEMBER") =>
    api.post<ProjectMember>(`/projects/${projectId}/members`, { user_id, project_role }),
  removeMember: (projectId: string, userId: string, reassign_to_user_id?: string) =>
    api.delete<void>(`/projects/${projectId}/members/${userId}`, { reassign_to_user_id }),
};

// --- Sprints ---
export const sprintsApi = {
  list: (projectId: string) => api.get<Sprint[]>(`/projects/${projectId}/sprints`),
  create: (projectId: string, payload: { name: string; goal?: string; start_date: string; end_date: string }) =>
    api.post<Sprint>(`/projects/${projectId}/sprints`, payload),
  update: (projectId: string, sprintId: string, payload: Partial<{ name: string; goal: string; status: string; start_date: string; end_date: string }>) =>
    api.patch<Sprint>(`/projects/${projectId}/sprints/${sprintId}`, payload),
  close: (projectId: string, sprintId: string, target_sprint_id?: string | null) =>
    api.post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/close`, { target_sprint_id: target_sprint_id ?? null }),
};

// --- Tasks ---
export const tasksApi = {
  listForProject: (
    projectId: string,
    params: {
      sprint_id?: string;
      assignee_id?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      search?: string;
      sort_by?: string;
      page?: number;
      page_size?: number;
    } = {}
  ) => api.get<PaginatedResponse<Task>>(`/projects/${projectId}/tasks`, params),
  create: (
    projectId: string,
    payload: {
      title: string;
      description?: string;
      priority: TaskPriority;
      sprint_id?: string | null;
      assignee_id?: string | null;
      due_date?: string | null;
      estimated_hours?: number | null;
    }
  ) => api.post<Task>(`/projects/${projectId}/tasks`, payload),
  update: (taskId: string, payload: Partial<Task>) => api.patch<Task>(`/tasks/${taskId}`, payload),
  updateStatus: (taskId: string, status: TaskStatus) =>
    api.patch<{ id: string; previous_status: TaskStatus; status: TaskStatus; updated_at: string }>(
      `/tasks/${taskId}/status`,
      { status }
    ),
  auditLogs: (taskId: string) => api.get<AuditLog[]>(`/tasks/${taskId}/audit-logs`),
};

// --- Comments & attachments ---
export const commentsApi = {
  list: (taskId: string) => api.get<Comment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, content: string) => api.post<Comment>(`/tasks/${taskId}/comments`, { content }),
  remove: (taskId: string, commentId: string) => api.delete<void>(`/tasks/${taskId}/comments/${commentId}`),
  listAttachments: (taskId: string) => api.get<Attachment[]>(`/tasks/${taskId}/attachments`),
  upload: (taskId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<Attachment>(`/tasks/${taskId}/attachments`, form);
  },
};

// --- Dashboard ---
export const dashboardApi = {
  forProject: (projectId: string, params: { sprint_id?: string; assignee_id?: string } = {}) =>
    api.get<DashboardStats>(`/dashboard/projects/${projectId}`, params),
};

// --- Notifications ---
export const notificationsApi = {
  list: (params: { is_read?: boolean; page?: number; page_size?: number } = {}) =>
    api.get<PaginatedNotifications>("/notifications", params),
  markRead: (notificationId: string) => api.patch<Notification>(`/notifications/${notificationId}/read`),
  markAllRead: () => api.patch<{ updated: number } | void>("/notifications/read-all"),
};
