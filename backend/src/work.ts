// Local-process resource bounds. No queue, no client-disconnect shortcut around active work.
import type { RequestHandler } from 'express';
import type pg from 'pg';
import type { Queryable } from './retrieval.js';
import type { LlmClient } from './llm.js';

export const MAX_ACTIVE_JOBS = 2;
export const MAX_MODEL_OPERATIONS = 500;
export class WorkLimitError extends Error {
  status = 503;
  code = 'WORK_CAPACITY_REACHED';
  constructor() { super('The demo is busy. Retry after the current work finishes.'); }
}

export function createWorkGate(limit = MAX_ACTIVE_JOBS) {
  let active = 0;
  const acquire = () => {
    if (active >= limit) throw new WorkLimitError();
    active += 1;
    let released = false;
    return () => { if (!released) { released = true; active -= 1; } };
  };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    const release = acquire();
    try { return await operation(); } finally { release(); }
  };
  const handle = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    await run(async () => { await handler(req, res, next); });
  };
  return { run, handle, active: () => active };
}
export type WorkGate = ReturnType<typeof createWorkGate>;

/** Lifetime call allowance includes failures. Exhaustion uses existing deterministic degradation. */
export function budgetLlm(llm: LlmClient | null, allowance = MAX_MODEL_OPERATIONS): LlmClient | null {
  if (!llm) return null;
  let remaining = allowance;
  const call = async <T>(operation: () => Promise<T>): Promise<T | null> => {
    if (remaining <= 0) return null;
    remaining -= 1;
    return operation();
  };
  return {
    embed: (...args) => call(() => llm.embed(...args)),
    synthesize: (...args) => call(() => llm.synthesize(...args)),
    ...(llm.structured ? { structured: (...args: Parameters<NonNullable<LlmClient['structured']>>) => call(() => llm.structured!(...args)) } : {}),
  };
}

/** Indexers embed before their first SQL statement; acquire a transaction client only then. */
export async function withLazyClient<T>(pool: pg.Pool, operation: (db: Queryable) => Promise<T>): Promise<T> {
  let connection: Promise<pg.PoolClient> | undefined;
  try {
    return await operation({ query: async (sql, values) => {
      connection ??= pool.connect();
      return (await connection).query(sql, values);
    } });
  } finally {
    if (connection) await connection.then((client) => client.release(), () => undefined);
  }
}
