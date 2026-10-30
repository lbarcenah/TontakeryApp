// Calendar arithmetic is in Europe/Madrid, never a fixed 24-hour duration.
const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
export function madridNine(year: number, month: number, day: number): Date {
  const calendar = new Date(Date.UTC(year, month - 1, day, 9));
  const hour = Number(parts(calendar).hour);
  return new Date(calendar.getTime() - (hour - 9) * 3600000);
}
export function roundBounds(now: Date): { start: Date; end: Date } {
  const p = parts(now);
  const y = Number(p.year),
    m = Number(p.month),
    d = Number(p.day);
  const before = Number(p.hour) < 9;
  return {
    start: madridNine(y, m, d - (before ? 1 : 0)),
    end: madridNine(y, m, d + (before ? 0 : 1)),
  };
}
export function nextEnd(start: Date): Date {
  const p = parts(start);
  return madridNine(Number(p.year), Number(p.month), Number(p.day) + 1);
}
