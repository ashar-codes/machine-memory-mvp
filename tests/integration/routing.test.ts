// Deterministic query routing. Pure functions: no database, no provider, no network.
//
// The cases are paraphrases rather than the exact strings the application ships, because routing
// must follow the shape of a request and not memorised wording.
import { describe, expect, it } from 'vitest';
import { extractEventCodes, routeQuery } from '../../backend/src/routing.js';

const CONTEXT = { currentEventCode: 'PEN-100210', knownEventCodes: ['PEN-100210', 'PEN-5000', 'PEN-10'] };
const route = (question: string, context: Parameters<typeof routeQuery>[1] = CONTEXT) => routeQuery(question, context);

describe('technical reference questions', () => {
  // The defect: "maintenance" alone routed a topical research request into the change window.
  it.each([
    'wind turbine drivetrain reliability maintenance',
    'gearbox durability and drivetrain maintenance',
    'What research discusses wind turbine drivetrain failures?',
    'Is there published guidance on pitch bearing reliability?',
    'What does the NREL report say about premature bearing failure?',
    'What does OSHA say about hazardous energy?',
    'Show me the technical references for this platform',
    'Which standards cover operations and maintenance of wind plants?',
    'Any literature on gearbox design life?',
  ])('routes to technical guidance: %s', (question) => {
    expect(route(question).intent).toBe('TECHNICAL_GUIDANCE');
  });

  it('does not narrow a topical question to the selected event', () => {
    expect(route('wind turbine drivetrain reliability maintenance').scope).toBe('ASSET_WIDE');
  });
});

describe('maintenance questions about this machine', () => {
  it.each([
    'What maintenance happened before this fault?',
    'What changed recently?',
    'What was replaced before this event?',
    'What work was carried out on this turbine before the alarm?',
    'Was anything serviced prior to this fault?',
  ])('routes to recent changes: %s', (question) => {
    expect(route(question).intent).toBe('RECENT_CHANGES');
  });
});

describe('recurrence and frequency', () => {
  it.each([
    ['How often has PEN-100210 occurred?', 'PEN-100210'],
    ['How many times has PEN-5000 occurred?', 'PEN-5000'],
    ['What is the frequency of PEN-10 on this turbine?', 'PEN-10'],
    ['How many times did PEN-5000 happen?', 'PEN-5000'],
    ['Total number of PEN-100210 events?', 'PEN-100210'],
  ])('asks for a count and scopes to the named code: %s', (question, code) => {
    const routed = route(question);
    expect(routed.aggregate).toBe(true);
    expect(routed.eventCode).toBe(code);
    expect(routed.scope).toBe('EVENT_CODE');
  });

  it.each([
    'Has this happened before?',
    'Has it recurred?',
    'Have we seen this before?',
  ])('keeps a bare recurrence question on the selected event: %s', (question) => {
    const routed = route(question);
    expect(routed.intent).toBe('HISTORY');
    expect(routed.scope).toBe('CURRENT_EVENT');
    expect(routed.eventCode).toBe('PEN-100210');
  });
});

describe('asset-wide versus event-specific scope', () => {
  it.each([
    'Summarize this turbine’s event history',
    'Summarise the event history for this turbine',
    'What are the most common events on this turbine?',
    'What happened to this turbine recently?',
    'Give me a breakdown of all the faults on this machine',
  ])('widens to the whole asset: %s', (question) => {
    const routed = route(question);
    expect(routed.scope).toBe('ASSET_WIDE');
    expect(routed.intent).toBe('HISTORY');
  });

  it('keeps event scope when the sentence names the event as well as the turbine', () => {
    expect(route('Has this turbine seen this fault before?').scope).toBe('CURRENT_EVENT');
  });

  it('an explicitly named code always wins over asset-wide phrasing', () => {
    const routed = route('Summarize how often PEN-5000 happened on this turbine');
    expect(routed.scope).toBe('EVENT_CODE');
    expect(routed.eventCode).toBe('PEN-5000');
  });

  it('routes fleet comparisons away from the single asset', () => {
    for (const question of ['Find similar fleet cases.', 'Has this happened on other turbines?', 'Compare this with the rest of the fleet']) {
      expect(route(question).scope).toBe('FLEET');
    }
  });
});

describe('resolution and safety', () => {
  it.each([
    'How was it solved previously?',
    'What was the root cause last time?',
    'How did we fix this before?',
    'What corrective action was recorded?',
  ])('routes to previous resolution: %s', (question) => {
    expect(route(question).intent).toBe('PREVIOUS_RESOLUTION');
  });

  it('carries an explicit code into a resolution question', () => {
    const routed = route('How was PEN-5000 solved previously?');
    expect(routed.intent).toBe('PREVIOUS_RESOLUTION');
    expect(routed.eventCode).toBe('PEN-5000');
  });

  it.each([
    'Can I bypass the pressure protection?',
    'Is it safe to work on this energized?',
    'What is the lockout procedure?',
  ])('routes safety topics to safety: %s', (question) => {
    expect(route(question).intent).toBe('SAFETY');
  });
});

describe('explicit event-code extraction', () => {
  it('finds a named code in several shapes', () => {
    expect(extractEventCodes('Has PEN-5000 happened before?')).toEqual(['PEN-5000']);
    expect(extractEventCodes('What about PITCH-HYD-214?')).toEqual(['PITCH-HYD-214']);
    expect(extractEventCodes('tell me about GEAR-TMP-402 please')).toEqual(['GEAR-TMP-402']);
    expect(extractEventCodes('PEN-100210 details')).toEqual(['PEN-100210']);
  });

  it('normalizes case against known codes', () => {
    expect(extractEventCodes('has pen-5000 occurred?', ['PEN-5000'])).toEqual(['PEN-5000']);
    // Unknown codes keep the user's own spelling upper-cased, so "no records" names what they typed.
    expect(extractEventCodes('what about zzz-9999?')).toEqual(['ZZZ-9999']);
  });

  it('does not read ordinary hyphenated English as a code', () => {
    // The digit requirement is what makes this safe.
    for (const text of [
      'lockout-tagout procedures for wind-turbine start-up',
      'the gear-box oil temperature is high',
      'follow-up on the pre-existing issue',
      'what changed recently?',
    ]) expect(extractEventCodes(text)).toEqual([]);
  });

  it('returns every distinct code in order, without duplicates', () => {
    expect(extractEventCodes('compare PEN-5000 with PITCH-HYD-214 and PEN-5000 again'))
      .toEqual(['PEN-5000', 'PITCH-HYD-214']);
  });
});

describe('explicit code precedence over selection', () => {
  it('answers about the named code, not the selected one', () => {
    const routed = route('Has PEN-5000 happened before?');
    expect(routed.eventCode).toBe('PEN-5000');
    expect(routed.eventCode).not.toBe(CONTEXT.currentEventCode);
  });

  it('falls back to the selected event when the question names none', () => {
    expect(route('Has this happened before?').eventCode).toBe('PEN-100210');
  });

  it('carries no event code when nothing is named and nothing is selected', () => {
    expect(route('Has this happened before?', { currentEventCode: null }).eventCode).toBeNull();
  });

  it('asks for clarification rather than guessing between two named codes', () => {
    const routed = route('Compare PEN-5000 and PITCH-HYD-214 occurrences');
    expect(routed.clarification).toMatch(/PEN-5000/);
    expect(routed.clarification).toMatch(/PITCH-HYD-214/);
    expect(routed.eventCode).toBeNull();
  });
});

describe('routing is deterministic', () => {
  it('returns the same decision for the same input', () => {
    for (const question of ['How often has PEN-5000 occurred?', 'wind turbine drivetrain reliability maintenance']) {
      expect(route(question)).toEqual(route(question));
    }
  });

  it('always reports why it routed the way it did', () => {
    for (const question of ['Has this happened before?', 'What changed recently?', 'Any research on gearboxes?']) {
      expect(route(question).reason.length).toBeGreaterThan(0);
    }
  });
});
