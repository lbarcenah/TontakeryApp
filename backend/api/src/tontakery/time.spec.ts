import { nextEnd, roundBounds } from './time';
describe('Madrid rounds', () => {
  test('before and exactly at 09:00 winter', () => {
    expect(
      roundBounds(new Date('2026-01-03T07:59:59Z')).start.toISOString(),
    ).toBe('2026-01-02T08:00:00.000Z');
    expect(
      roundBounds(new Date('2026-01-03T08:00:00Z')).start.toISOString(),
    ).toBe('2026-01-03T08:00:00.000Z');
  });
  test('summer and midnight calendar rollover', () => {
    expect(
      roundBounds(new Date('2026-07-01T07:00:00Z')).end.toISOString(),
    ).toBe('2026-07-02T07:00:00.000Z');
    expect(
      roundBounds(new Date('2026-01-01T00:00:00Z')).start.toISOString(),
    ).toBe('2025-12-31T08:00:00.000Z');
  });
  test('spring round is 23 hours', () => {
    const start = new Date('2026-03-28T08:00:00Z');
    expect(nextEnd(start).getTime() - start.getTime()).toBe(23 * 3600000);
  });
  test('autumn round is 25 hours', () => {
    const start = new Date('2026-10-24T07:00:00Z');
    expect(nextEnd(start).getTime() - start.getTime()).toBe(25 * 3600000);
  });
});
