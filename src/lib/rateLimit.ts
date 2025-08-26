const windowMs = 60 * 1000;
const max = 5;
const hits = new Map<string, { count: number; time: number }>();

export function rateLimit(ip: string) {
  const entry = hits.get(ip);
  const now = Date.now();
  if (!entry || now - entry.time > windowMs) {
    hits.set(ip, { count: 1, time: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
