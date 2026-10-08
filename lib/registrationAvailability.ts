// Pure. Whether a webinar can still take registrations, and why not.
//
// Applied by the hosted registration page, the one-click link and the submit endpoint so all three
// give the same answer — and so a person who clicks a link after the event gets an honest
// "this webinar has ended" instead of being silently registered for something in the past.

export type ClosedReason = 'archived' | 'completed' | 'ended' | 'full';

export interface AvailabilityInput {
  archived?: boolean | null;
  status?: string | null;
  scheduledAt?: Date | null;
  durationMinutes?: number | null;
  capacity?: number | null;
  /** Registrations so far (the campaign counter). */
  registrations?: number | null;
}

export type Availability = { open: true } | { open: false; reason: ClosedReason };

/** How long after the start we keep accepting registrations (people join late; reminders still go out). */
export const LATE_JOIN_GRACE_MIN = 15;

export function registrationAvailability(c: AvailabilityInput, now: Date = new Date()): Availability {
  if (c.archived) return { open: false, reason: 'archived' };
  if (c.status === 'completed') return { open: false, reason: 'completed' };
  if (c.scheduledAt) {
    const endsAt = c.scheduledAt.getTime() + ((c.durationMinutes ?? 60) + LATE_JOIN_GRACE_MIN) * 60_000;
    if (now.getTime() > endsAt) return { open: false, reason: 'ended' };
  }
  if (c.capacity && c.capacity > 0 && (c.registrations ?? 0) >= c.capacity) return { open: false, reason: 'full' };
  return { open: true };
}

export const CLOSED_COPY: Record<ClosedReason, { title: string; body: string }> = {
  archived: { title: 'Registration Is Closed', body: 'This webinar is no longer available.' },
  completed: { title: 'This Webinar Has Ended', body: 'Registration is closed. Ask the organiser about the recording.' },
  ended: { title: 'This Webinar Has Ended', body: 'Registration is closed. Ask the organiser about the recording.' },
  full: { title: 'This Webinar Is Full', body: 'All seats have been taken. Ask the organiser to be added to the next session.' },
};
