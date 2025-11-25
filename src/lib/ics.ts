import { format } from 'date-fns';

export function generateICS({
  startsAt,
  durationMinutes = 90,
  summary,
  description,
}:
  { startsAt: Date; durationMinutes?: number; summary: string; description: string }) {
  const end = new Date(startsAt.getTime() + durationMinutes * 60000);
  const dtStart = format(startsAt, "yyyyMMdd'T'HHmmss'Z'");
  const dtEnd = format(end, "yyyyMMdd'T'HHmmss'Z'");
  return `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${dtStart}\nDTEND:${dtEnd}\nSUMMARY:${summary}\nDESCRIPTION:${description}\nEND:VEVENT\nEND:VCALENDAR`;
}
