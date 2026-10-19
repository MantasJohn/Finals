import { supabase } from './supabase';
import { parseQRPayload } from './qr';
import { getEventByCode, normalizeStatus } from './events';
import { getProfile } from './profile';

// ---------- Types ----------

export type AttendanceStatus = 'present' | 'late' | 'excused' | 'absent';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  excused: 'Excused',
  absent: 'Absent',
};

/** Treats any unknown/missing status as "present" so older rows keep working. */
export function normalizeAttendanceStatus(
  value: string | null | undefined
): AttendanceStatus {
  return value === 'late' || value === 'excused' || value === 'absent'
    ? value
    : 'present';
}

/** A scan counts as late when it happens after this grace period. */
export const LATENESS_GRACE_MINUTES = 15;

export type AttendanceRecord = {
  id: string;
  eventId: string;
  eventTitle: string;
  scannedAt: string;
  status: AttendanceStatus;
};

export type RegisterResult = {
  success: boolean;
  message: string;
  /** True when the student had already checked in to this event. */
  alreadyRegistered?: boolean;
  eventTitle?: string;
  eventCode?: string;
  venue?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  status?: string | null;
  scannedAt?: string;
  attendanceStatus?: AttendanceStatus;
};

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  venue: string | null;
  description: string | null;
  status: string | null;
  startTime: string | null;
  endTime: string | null;
  attendeeCount: number;
  attendees: {
    studentId: string;
    scannedAt: string;
    studentName: string | null;
    status: AttendanceStatus;
  }[];
};

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  attendeeCount: number;
};

// ---------- Student: register + history ----------

export async function registerAttendance(
  rawPayload: string,
  studentId: string
): Promise<RegisterResult> {
  // --- Validation 1: invalid QR codes -------------------------------------
  // Rejects anything that isn't an attendance QR (bad JSON, wrong version,
  // missing event code, etc.).
  const parsed = parseQRPayload(rawPayload);
  if (!parsed.ok) {
    return { success: false, message: parsed.message };
  }
  const payload = parsed.payload;

  // --- Validation 2: unauthorized attendance recording --------------------
  // The caller must be signed in, must be a student, and may only record
  // their own attendance. This mirrors the `attendance_insert` RLS policy so
  // it can never be bypassed by calling the API directly.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      message: 'You must be signed in to record attendance.',
    };
  }
  if (studentId && studentId !== user.id) {
    return {
      success: false,
      message: 'You can only record attendance for your own account.',
    };
  }

  const profile = await getProfile(user.id);
  if (profile && profile.role !== 'student') {
    return {
      success: false,
      message: 'Only student accounts can record attendance.',
    };
  }

  // Always record against the authenticated user, never a caller-supplied id.
  const studentKey = user.id;

  // --- Validation 3: the event must exist ---------------------------------
  const foundEvent = await getEventByCode(payload.event);
  if (!foundEvent) {
    return {
      success: false,
      message: 'Event not found. Ask your teacher to create this event first.',
    };
  }

  const eventInfo = {
    eventTitle: foundEvent.title,
    eventCode: foundEvent.event_code,
    venue: foundEvent.venue,
    startTime: foundEvent.start_time,
    endTime: foundEvent.end_time,
    status: foundEvent.status,
  };

  // --- Validation 4: duplicate attendance ---------------------------------
  const { data: existing } = await supabase
    .from('attendance')
    .select('id')
    .eq('student_id', studentKey)
    .eq('event_id', foundEvent.id)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      alreadyRegistered: true,
      message: 'Already registered for this event.',
      ...eventInfo,
    };
  }

  // --- Validation 5: closed events ----------------------------------------
  if (normalizeStatus(foundEvent.status) === 'closed') {
    return {
      success: false,
      message: 'This event is closed. Attendance is no longer being recorded.',
      ...eventInfo,
    };
  }

  // --- Validation 6: event time window (from the database, not the QR) -----
  const now = Date.now();
  const start = foundEvent.start_time
    ? new Date(foundEvent.start_time).getTime()
    : null;
  const end = foundEvent.end_time
    ? new Date(foundEvent.end_time).getTime()
    : null;

  if (start && !Number.isNaN(start) && now < start) {
    return { success: false, message: 'Event has not started yet.', ...eventInfo };
  }
  if (end && !Number.isNaN(end) && now > end) {
    return { success: false, message: 'Event has already ended.', ...eventInfo };
  }

  // --- Record the attendance row ------------------------------------------
  // Status is derived from the database start time: scans after the grace
  // period are marked "late", otherwise "present".
  const attendanceStatus: AttendanceStatus =
    start && !Number.isNaN(start) &&
    now > start + LATENESS_GRACE_MINUTES * 60 * 1000
      ? 'late'
      : 'present';

  const { error: attError } = await supabase.from('attendance').insert([
    { student_id: studentKey, event_id: foundEvent.id, status: attendanceStatus },
  ]);

  if (attError) {
    // Unique (student_id, event_id) constraint — covers race conditions where
    // two scans happen at once.
    if (attError.code === '23505') {
      return {
        success: false,
        alreadyRegistered: true,
        message: 'Already registered for this event.',
        ...eventInfo,
      };
    }
    return { success: false, message: attError.message, ...eventInfo };
  }

  return {
    success: true,
    message: 'Attendance recorded!',
    scannedAt: new Date().toISOString(),
    attendanceStatus,
    ...eventInfo,
  };
}

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, scanned_at, status, event_id, events(event_code, title)')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    eventId: row.events?.event_code ?? row.event_id,
    eventTitle: row.events?.title ?? 'Unknown event',
    scannedAt: row.scanned_at,
    status: normalizeAttendanceStatus(row.status),
  }));
}

// ---------- Teacher: event attendance views ----------

export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, venue, description, status, start_time, end_time')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);
  if (eventIds.length === 0) return [];

  const emptyResult = (): TeacherEventAttendance[] =>
    events.map((e: any) => ({
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      venue: e.venue ?? null,
      description: e.description ?? null,
      status: e.status ?? null,
      startTime: e.start_time,
      endTime: e.end_time,
      attendeeCount: 0,
      attendees: [],
    }));

  // Fetch attendance WITHOUT the profiles join first. The embedded
  // `profiles(full_name)` join fails when the FK or RLS policy is missing,
  // which previously caused this whole function to return [] (hiding the
  // teacher's events entirely). Fetch names separately instead.
  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, status, event_id')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attError || !attendance) return emptyResult();

  // Look up student names in a separate, best-effort query. If RLS blocks
  // it, fall back to null names instead of hiding the events.
  let nameById: Record<string, string | null> = {};
  const studentIds = [...new Set(attendance.map((a: any) => a.student_id))];
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', studentIds);
    if (profiles) {
      for (const p of profiles as any[]) {
        nameById[p.id] = p.full_name ?? null;
      }
    }
  }

  return events.map((e: any) => {
    const rows = attendance.filter((a: any) => a.event_id === e.id);
    return {
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      venue: e.venue ?? null,
      description: e.description ?? null,
      status: e.status ?? null,
      startTime: e.start_time,
      endTime: e.end_time,
      attendeeCount: rows.length,
      attendees: rows.map((a: any) => ({
        studentId: a.student_id,
        scannedAt: a.scanned_at,
        studentName: nameById[a.student_id] ?? null,
        status: normalizeAttendanceStatus(a.status),
      })),
    };
  });
}

export async function getTeacherEventSummary(
  teacherId: string
): Promise<TeacherEventSummary[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);
  if (eventIds.length === 0) return [];

  const emptyCounts = (): TeacherEventSummary[] =>
    events.map((e: any) => ({
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      attendeeCount: 0,
    }));

  const { data: attRows, error: attError } = await supabase
    .from('attendance')
    .select('event_id')
    .in('event_id', eventIds);

  // Never hide the teacher's events just because the attendance
  // count query failed (e.g. RLS). Show them with a 0 count instead.
  if (attError || !attRows) return emptyCounts();

  const counts: Record<string, number> = {};
  attRows.forEach((r: any) => {
    counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
  });

  return events.map((e: any) => ({
    eventId: e.id,
    eventCode: e.event_code,
    title: e.title,
    attendeeCount: counts[e.id] ?? 0,
  }));
}

// ---------- Single-event attendance (event details screen) ----------

export type EventAttendee = {
  studentId: string;
  studentName: string | null;
  scannedAt: string;
  status: AttendanceStatus;
};

export async function getEventAttendance(
  eventId: string
): Promise<EventAttendee[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, status')
    .eq('event_id', eventId)
    .order('scanned_at', { ascending: true });

  if (error || !data) return [];

  const studentIds = [...new Set(data.map((r: any) => r.student_id))];
  const nameById: Record<string, string | null> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', studentIds);
    for (const p of (profiles as any[]) ?? []) {
      nameById[p.id] = p.full_name ?? null;
    }
  }

  return data.map((r: any) => ({
    studentId: r.student_id,
    studentName: nameById[r.student_id] ?? null,
    scannedAt: r.scanned_at,
    status: normalizeAttendanceStatus(r.status),
  }));
}