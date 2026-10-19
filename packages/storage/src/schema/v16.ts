// Ordering and calendar-scoped range scans. Both are added after the v15
// history tables so the migration stays append-only.
export const SCHEMA_V16_SQL = `
CREATE INDEX idx_entries_order ON entries(date, start_time, id);
CREATE INDEX idx_entries_calendar_date ON entries(calendar, date);
`;