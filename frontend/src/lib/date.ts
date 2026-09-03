// The backend serializes naive UTC datetimes (no trailing "Z" or offset) for
// timestamp fields like created_at/updated_at/last_login_at. JavaScript's
// Date parser treats an offset-less ISO string as *local* time (ES2015+),
// which silently shifts every such timestamp by the browser's UTC offset —
// e.g. a notification created seconds ago reads as "7 hours ago" for a
// viewer in UTC+7. Date-only fields (start_date, due_date, ...) don't have
// this problem, since a bare "YYYY-MM-DD" string is always parsed as UTC —
// only use this for fields that carry a time component.
export function parseApiDate(iso: string): Date {
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTimezone ? iso : `${iso}Z`);
}
