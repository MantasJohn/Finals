import { supabase } from './supabase';

export type EventStatus = 'open' | 'closed';

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

/** Treats any unknown/missing status as "open" so older rows keep working. */
export function normalizeStatus(
  status: string | null | undefined
): EventStatus {
  return status === 'closed' ? 'closed' : 'open';
}

export type Event = {
  eventId: string;   // the public event code (from the UI, e.g. EVT-2026-0002)
  title: string;
  venue?: string;
  description?: string;
  start?: string;
  end?: string;
  status?: EventStatus;
};

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  venue: string | null;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  status: EventStatus | null;
  created_by: string | null;
  created_at: string;
};

export async function createEvent(
  event: Event,
  teacherId?: string
): Promise<{ error: string | null }> {
  // Prefer the explicitly passed teacher id. Falling back to
  // supabase.auth.getUser() alone is fragile: if it resolves to null
  // (stale/unpersisted session), the event is saved with created_by = null
  // and never shows up in the teacher's History tab.
  let createdBy: string | null = teacherId ?? null;
  if (!createdBy) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    createdBy = user?.id ?? null;
  }

  if (!createdBy) {
    return { error: 'You must be logged in as a teacher or admin to create an event.' };
  }

  const { error } = await supabase.from('events').upsert(
    {
      event_code: event.eventId,
      title: event.title,
      venue: event.venue ?? null,
      description: event.description ?? null,
      start_time: event.start || null,
      end_time: event.end || null,
      status: event.status ?? 'open',
      created_by: createdBy,
    },
    { onConflict: 'event_code' }
  );

  return { error: error?.message ?? null };
}

export async function updateEvent(
  id: string,
  updates: {
    event_code?: string;
    title?: string;
    venue?: string | null;
    description?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    status?: EventStatus;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('events').update(updates).eq('id', id);
  return { error: error?.message ?? null };
}

/** Closes an event so no further attendance can be recorded against it. */
export async function closeEvent(
  id: string
): Promise<{ error: string | null }> {
  return updateEvent(id, { status: 'closed' });
}

/** Re-opens a previously closed event. */
export async function reopenEvent(
  id: string
): Promise<{ error: string | null }> {
  return updateEvent(id, { status: 'open' });
}

export async function setEventStatus(
  id: string,
  status: EventStatus
): Promise<{ error: string | null }> {
  return updateEvent(id, { status });
}

export async function deleteEvent(
  id: string
): Promise<{ error: string | null }> {
  // Remove the attendance rows first so events can be deleted even when the
  // database has no ON DELETE CASCADE rule configured.
  const { error: attendanceError } = await supabase
    .from('attendance')
    .delete()
    .eq('event_id', id);

  if (attendanceError) {
    return { error: attendanceError.message };
  }

  const { error } = await supabase.from('events').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/** Every event in the system, soonest first (students + administrator). */
export async function getAllEvents(): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('start_time', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

/**
 * Events still open for attendance: not explicitly closed, and not already
 * finished based on their end time.
 */
export async function getAvailableEvents(): Promise<CloudEvent[]> {
  const events = await getAllEvents();
  const now = Date.now();

  return events.filter((event) => {
    if (normalizeStatus(event.status) === 'closed') return false;
    if (!event.end_time) return true;
    const end = new Date(event.end_time).getTime();
    return Number.isNaN(end) || end >= now;
  });
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

export async function getEventById(
  id: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_code', code)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}
