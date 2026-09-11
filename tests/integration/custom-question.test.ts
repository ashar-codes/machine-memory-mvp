// The typed Machine Memory question box. No provider, no network; the fake database records the
// bind parameters every repository-owned statement was given.
//
// The regression these cover: a typed question was sent with a fixed intent and the selected
// event forced into the request, so `/api/investigate` never routed it. A question naming another
// event code was answered about the selected one, and an asset-wide total was answered as that
// event's recurrence. The copilot, which routed the identical sentence, answered all three
// correctly — so these assert on the *effective* event code and scope that reach retrieval, which
// is the thing the two paths disagreed about.
import { describe, expect, it } from 'vitest';
import { investigate } from '../../backend/src/investigate.js';
import { runAssetCopilot } from '../../backend/src/copilot.js';
import { EVENT_CODE, WT07, createFakeDatabase, type FakeDatabase } from './fakeDatabase.js';

/** A second code recorded on the same turbine, so a question can name one and select the other. */
const OTHER_CODE = 'GEAR-TMP-402';
const otherEvents = [
  { id: '40000000-0000-4000-8000-000000000101', asset_id: WT07, event_code: OTHER_CODE, title: 'Gearbox temperature high', subsystem: 'Drivetrain', severity: 'warning', occurred_at: '2026-05-01T06:00:00.000Z', cleared_at: '2026-05-01T07:00:00.000Z', description: 'Synthetic gearbox temperature record.', record_origin: 'synthetic_demo' },
  { id: '40000000-0000-4000-8000-000000000102', asset_id: WT07, event_code: OTHER_CODE, title: 'Gearbox temperature high', subsystem: 'Drivetrain', severity: 'warning', occurred_at: '2026-06-12T06:00:00.000Z', cleared_at: '2026-06-12T07:30:00.000Z', description: 'Synthetic repeat gearbox temperature record.', record_origin: 'synthetic_demo' },
];

const db = () => createFakeDatabase({ extraEvents: otherEvents });

/** What the typed box sends: the selected event as context, and no intent of its own. */
const typed = (question: string) => ({ assetCode: 'WT-07', eventCode: EVENT_CODE, question });

async function ask(question: string, database: FakeDatabase = db()) {
  const outcome = await investigate(typed(question), { db: database });
  if (outcome.status !== 'ok') throw new Error(`unexpected outcome: ${outcome.status}`);
  return { response: outcome.response, db: database };
}

/**
 * Every event code that reached a structured statement as a bind parameter.
 *
 * Asserting on this rather than on prose is what makes the test independent of wording: it is the
 * question "which event did retrieval actually run against", which is exactly what went wrong.
 */
function codesQueried(database: FakeDatabase): string[] {
  const codes = new Set<string>();
  for (const call of database.calls) {
    if (!call.sql.includes('public.asset_events') && !call.sql.includes('public.resolutions')
      && !call.sql.includes('public.incidents') && !call.sql.includes('public.work_orders')) continue;
    for (const value of call.values) {
      if (typeof value === 'string' && (value === EVENT_CODE || value === OTHER_CODE)) codes.add(value);
    }
  }
  return [...codes];
}

describe('a code named in the question outranks the selected event', () => {
  // FAILURE 1: selected PEN-100210, asked "How often has PEN-5000 occurred?", answered about
  // PEN-100210. Here: selected EVENT_CODE, asked about OTHER_CODE.
  it('counts the named code, not the displayed one', async () => {
    const { response, db: database } = await ask(`How often has ${OTHER_CODE} occurred?`);
    expect(codesQueried(database)).toEqual([OTHER_CODE]);
    // The count is computed in SQL: two recorded occurrences, one previous to the newest.
    const recurrence = database.calls.find((call) => call.sql.includes('previous_count'));
    expect(recurrence?.values).toContain(OTHER_CODE);
    expect(JSON.stringify(response)).not.toContain(EVENT_CODE);
  });

  // FAILURE 2: "How was PEN-5000 solved previously?" investigated the displayed event instead.
  it('scopes a resolution question to the named code', async () => {
    const { db: database } = await ask(`How was ${OTHER_CODE} solved previously?`);
    expect(codesQueried(database)).toEqual([OTHER_CODE]);
    expect(database.calls.some((call) => call.sql.includes('public.resolutions')
      && call.values.includes(OTHER_CODE))).toBe(true);
  });

  it('does not invent a repair when no resolution evidence exists for the named code', async () => {
    // The fixture records occurrences of OTHER_CODE but no resolution, work order or note for it,
    // which is the shape of the public operational data.
    const { response } = await ask(`How was ${OTHER_CODE} solved previously?`);
    expect(response.answer.evidenceStrength).toBe('INSUFFICIENT');
    const text = JSON.stringify(response).toLowerCase();
    expect(text).not.toContain('sensor drift');
    expect(text).not.toContain('connector replaced');
  });

  it('still falls back to the selected event when the question names no code', async () => {
    const { db: database } = await ask('Has this happened before?');
    expect(codesQueried(database)).toEqual([EVENT_CODE]);
  });

  it('asks for clarification rather than choosing between two named codes', async () => {
    const { response, db: database } = await ask(`Compare ${OTHER_CODE} and PITCH-HYD-999 occurrences`);
    expect(response.answer.summary).toContain(OTHER_CODE);
    expect(response.answer.summary).toContain('PITCH-HYD-999');
    expect(response.answer.evidenceStrength).toBe('INSUFFICIENT');
    expect(response.evidence).toEqual([]);
    expect(codesQueried(database)).toEqual([]);
  });
});

describe('an asset-wide question is not narrowed to the selected event', () => {
  // FAILURE 3: "How many event records are stored for this turbine in total?" was answered as the
  // selected event's recurrence.
  it('answers a total-records question from the asset total', async () => {
    const { response, db: database } = await ask('How many event records are stored for this turbine in total?');
    expect(database.calls.some((call) => call.sql.includes('count(distinct event_code)'))).toBe(true);
    // No recurrence count for the selected event: that would be the narrowed answer.
    expect(database.calls.some((call) => call.sql.includes('previous_count'))).toBe(false);
    // Five events on the fixture turbine across two codes, counted in SQL.
    expect(response.answer.summary).toContain('5');
  });

  it('reaches the same scope whichever event happens to be selected', async () => {
    const question = 'How many event records are stored for this turbine in total?';
    const withSelection = await ask(question);
    const noSelection = await investigate({ assetCode: 'WT-07', question }, { db: db() });
    if (noSelection.status !== 'ok') throw new Error('unexpected outcome');
    expect(withSelection.response.answer.summary).toBe(noSelection.response.answer.summary);
  });
});

describe('paths that already worked keep working', () => {
  it('uses a preset probe’s intent and selected event exactly as supplied', async () => {
    const database = db();
    const outcome = await investigate(
      { assetCode: 'WT-07', eventCode: EVENT_CODE, intent: 'HISTORY', question: 'Has this happened before on this turbine?' },
      { db: database });
    expect(outcome.status).toBe('ok');
    // The probe states the event it is about; routing must not widen it to the whole asset.
    expect(codesQueried(database)).toEqual([EVENT_CODE]);
    expect(database.calls.some((call) => call.sql.includes('previous_count'))).toBe(true);
  });

  it('refuses an unsafe typed question before touching the database', async () => {
    const database = db();
    const outcome = await investigate(typed('Can I bypass the pressure protection?'), { db: database });
    if (outcome.status !== 'ok') throw new Error('unexpected outcome');
    expect(outcome.response.answer.safetyStatus).toBe('REFUSED');
    expect(database.calls).toEqual([]);
  });

  it('answers the copilot’s identical question the same way', async () => {
    // The control test: the copilot routed this sentence correctly before the fix, and must
    // still reach the named code afterwards.
    const database = db();
    const response = await runAssetCopilot(
      { assetCode: 'WT-07', eventCode: EVENT_CODE, question: `What was the confirmed root cause of ${OTHER_CODE}?` },
      { db: database });
    if ('status' in response) throw new Error('unexpected outcome');
    expect(response.structuredFacts.resolvedEventCode).toBe(OTHER_CODE);
    expect(response.structuredFacts.resolvedScope).toBe('EVENT_CODE');
    expect(codesQueried(database)).toEqual([OTHER_CODE]);
  });

  it('keeps asset isolation: nothing is queried for another turbine', async () => {
    const { db: database } = await ask(`How often has ${OTHER_CODE} occurred?`);
    const assetLookups = database.calls.filter((call) => call.sql.includes('from public.assets where asset_code'));
    expect(assetLookups.every((call) => call.values[0] === 'WT-07')).toBe(true);
  });
});
