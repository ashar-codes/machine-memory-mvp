/** datetime-local contains browser-local wall time, not UTC text. Minute precision is explicit. */
export function localDateTime(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function localDateTimeToIso(value: string, defaultInstant?: Date): string {
  // Preserve the untouched default even in the repeated hour at a DST fall-back.
  if (defaultInstant && localDateTime(defaultInstant) === value) {
    return new Date(Math.floor(defaultInstant.getTime() / 60_000) * 60_000).toISOString();
  }
  const date = new Date(value);
  // Round-trip validation rejects impossible calendar dates and nonexistent DST wall times.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    || !Number.isFinite(date.getTime()) || localDateTime(date) !== value) {
    throw new Error('Enter a valid local date and time. This time may not exist during a daylight-saving change.');
  }
  return date.toISOString();
}
