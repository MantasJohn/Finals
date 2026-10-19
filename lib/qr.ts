export type QRPayload = {
  v: 1;
  event: string;
  title?: string;
  start?: string;
  end?: string;
};

export function buildQRPayload(event: {
  eventId: string;
  title: string;
  start?: string;
  end?: string;
}): string {
  const payload: QRPayload = {
    v: 1,
    event: event.eventId,
  };

  if (event.title) payload.title = event.title;
  if (event.start) payload.start = event.start;
  if (event.end) payload.end = event.end;

  return JSON.stringify(payload);
}

export type ParseQRResult =
  | { ok: true; payload: QRPayload }
  | { ok: false; message: string };

export function parseQRPayload(raw: string): ParseQRResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, message: 'Invalid QR code.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  // Must be a JSON object with a supported version and a non-empty event code.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  if (parsed.v !== 1) {
    return { ok: false, message: 'Unsupported QR code version.' };
  }

  if (typeof parsed.event !== 'string' || parsed.event.trim().length === 0) {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  return {
    ok: true,
    payload: {
      v: 1,
      event: parsed.event.trim(),
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      start: typeof parsed.start === 'string' ? parsed.start : undefined,
      end: typeof parsed.end === 'string' ? parsed.end : undefined,
    },
  };
}