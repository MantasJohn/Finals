import { supabase } from './supabase';
import type { Profile, Role } from './profile';
import {
  normalizeAttendanceStatus,
  type AttendanceStatus,
} from './attendance';

// ---------- Administrator: user management ----------

export async function listAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .order('role', { ascending: true })
    .order('email', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as Profile[];
}

export async function updateUserRole(
  userId: string,
  role: Role
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  return { error: error?.message ?? null };
}

// ---------- Administrator: attendance records + corrections ----------

export type AdminAttendanceRecord = {
  id: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  scannedAt: string;
  status: AttendanceStatus;
};

/**
 * Every attendance row in the system, newest first, enriched with the student
 * and event details. Names/emails are looked up in a separate query so a
 * missing RLS policy on the embedded join never hides the records entirely.
 */
export async function getAllAttendanceRecords(): Promise<
  AdminAttendanceRecord[]
> {
  const { data: attendance, error } = await supabase
    .from('attendance')
    .select('id, student_id, event_id, scanned_at, status')
    .order('scanned_at', { ascending: false });

  if (error || !attendance) {
    return [];
  }

  const studentIds = [...new Set(attendance.map((a: any) => a.student_id))];
  const eventIds = [...new Set(attendance.map((a: any) => a.event_id))];

  const profileById: Record<string, { name: string | null; email: string | null }> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', studentIds);
    for (const p of (profiles as any[]) ?? []) {
      profileById[p.id] = { name: p.full_name ?? null, email: p.email ?? null };
    }
  }

  const eventById: Record<string, { code: string; title: string }> = {};
  if (eventIds.length > 0) {
    const { data: events } = await supabase
      .from('events')
      .select('id, event_code, title')
      .in('id', eventIds);
    for (const e of (events as any[]) ?? []) {
      eventById[e.id] = { code: e.event_code, title: e.title };
    }
  }

  return attendance.map((row: any) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: profileById[row.student_id]?.name ?? null,
    studentEmail: profileById[row.student_id]?.email ?? null,
    eventId: row.event_id,
    eventCode: eventById[row.event_id]?.code ?? row.event_id,
    eventTitle: eventById[row.event_id]?.title ?? 'Unknown event',
    scannedAt: row.scanned_at,
    status: normalizeAttendanceStatus(row.status),
  }));
}

export async function updateAttendanceRecord(
  id: string,
  updates: { scanned_at?: string; status?: AttendanceStatus }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('attendance')
    .update(updates)
    .eq('id', id);

  return { error: error?.message ?? null };
}

export async function deleteAttendanceRecord(
  id: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('attendance').delete().eq('id', id);
  return { error: error?.message ?? null };
}

// ---------- Administrator: reports ----------

export type AttendanceReport = {
  totalEvents: number;
  totalScans: number;
  totalStudents: number;
  totalTeachers: number;
  totalAdmins: number;
  byEvent: {
    eventId: string;
    eventCode: string;
    title: string;
    count: number;
  }[];
  byStatus: Record<AttendanceStatus, number>;
  topStudents: {
    studentId: string;
    name: string | null;
    email: string | null;
    count: number;
  }[];
};

export async function getAttendanceReport(): Promise<AttendanceReport> {
  const [profiles, records] = await Promise.all([
    listAllProfiles(),
    getAllAttendanceRecords(),
  ]);

  const { data: events } = await supabase
    .from('events')
    .select('id, event_code, title');

  const eventRows = (events as any[]) ?? [];

  const byEventCounts: Record<string, number> = {};
  const byStudentCounts: Record<string, number> = {};
  const byStatus: Record<AttendanceStatus, number> = {
    present: 0,
    late: 0,
    excused: 0,
    absent: 0,
  };
  for (const r of records) {
    byEventCounts[r.eventId] = (byEventCounts[r.eventId] ?? 0) + 1;
    byStudentCounts[r.studentId] = (byStudentCounts[r.studentId] ?? 0) + 1;
    byStatus[r.status] += 1;
  }

  const profileById: Record<string, Profile> = {};
  for (const p of profiles) profileById[p.id] = p;

  const byEvent = eventRows
    .map((e) => ({
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      count: byEventCounts[e.id] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topStudents = Object.entries(byStudentCounts)
    .map(([studentId, count]) => ({
      studentId,
      name: profileById[studentId]?.full_name ?? null,
      email: profileById[studentId]?.email ?? null,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalEvents: eventRows.length,
    totalScans: records.length,
    totalStudents: profiles.filter((p) => p.role === 'student').length,
    totalTeachers: profiles.filter((p) => p.role === 'teacher').length,
    totalAdmins: profiles.filter((p) => p.role === 'admin').length,
    byEvent,
    byStatus,
    topStudents,
  };
}
