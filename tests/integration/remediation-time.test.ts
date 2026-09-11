import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { localDateTimeToIso } from '../../frontend/src/localTime.js';

describe('local datetime boundary', () => {
  it.each(['UTC', 'Asia/Karachi', 'America/Phoenix', 'America/New_York'])('round-trips default and manual times in %s', (timezone) => {
    const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { localDateTime, localDateTimeToIso } from './frontend/src/localTime.ts';
      const instant=new Date('2026-09-11T12:34:00.000Z');
      const displayed=localDateTime(instant);
      console.log(JSON.stringify({roundTrip:localDateTimeToIso(displayed),
        manual:localDateTimeToIso('2024-02-29T12:00'),
        expected:new Date(2024,1,29,12,0).toISOString()}));
    `], { encoding: 'utf8', env: { ...process.env, TZ: timezone } })) as { roundTrip: string; manual: string; expected: string };
    expect(result.roundTrip).toBe('2026-09-11T12:34:00.000Z');
    expect(result.manual).toBe(result.expected);
  });
  it.each(['2026-02-29T12:00', '2026-02-30T12:00', '2026-13-01T12:00', '2026-09-11T25:00'])('rejects impossible local time %s', (value) => {
    expect(() => localDateTimeToIso(value)).toThrow('valid local date');
  });
  it('rejects nonexistent DST wall time', () => {
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { localDateTimeToIso } from './frontend/src/localTime.ts';
      try {localDateTimeToIso('2026-03-08T02:30'); console.log('accepted');}
      catch {console.log('rejected');}
    `], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
    expect(result.trim()).toBe('rejected');
  });
  it('preserves the untouched default during the second occurrence of a DST hour', () => {
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { localDateTime, localDateTimeToIso } from './frontend/src/localTime.ts';
      const instant=new Date('2026-11-01T06:30:45.000Z');
      console.log(localDateTimeToIso(localDateTime(instant),instant));
    `], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
    expect(result.trim()).toBe('2026-11-01T06:30:00.000Z');
  });
});
