import type { Kind, Progress, Result, SessionRecord, WordProgress } from '../types';
import { addDays } from './util';

/** Leitner boxes: days until a word comes back after a correct first-try answer. */
export const INTERVALS = [1, 2, 4, 8, 16, 32];
export const KEEP_DAYS = 30;

export function emptyProgress(): Progress {
  return { v: 1, words: {}, days: {}, done: [], t: 0 };
}

export function applyResult(
  prev: WordProgress | undefined,
  result: Result,
  today: string,
  now: number,
): WordProgress {
  const box = prev?.b ?? 0;
  if (result === 'k') {
    const nb = Math.min(box + 1, INTERVALS.length - 1);
    return { s: 'k', b: nb, d: addDays(today, INTERVALS[nb]), r: (prev?.r ?? 0) + 1, w: prev?.w ?? 0, t: now };
  }
  return { s: 'u', b: 0, d: addDays(today, 1), r: prev?.r ?? 0, w: (prev?.w ?? 0) + 1, t: now };
}

/** Fix today's word list for a session (so a reload or a sync cannot change it). */
export function startSession(p: Progress, kind: Kind, today: string, ids: string[], now: number): Progress {
  const day = p.days[today] ?? {};
  if (day[kind]) return p;
  const rec: SessionRecord = { ids, res: {}, done: false, t: now };
  return { ...p, days: { ...p.days, [today]: { ...day, [kind]: rec } }, t: now };
}

export function completeSession(
  p: Progress,
  kind: Kind,
  today: string,
  results: Record<string, Result>,
  now: number,
): Progress {
  const day = p.days[today] ?? {};
  const existing = day[kind];
  if (existing?.done) return p; // never double-count a day's session
  const words = { ...p.words };
  for (const [id, res] of Object.entries(results)) words[id] = applyResult(words[id], res, today, now);
  const rec: SessionRecord = { ids: existing?.ids ?? Object.keys(results), res: results, done: true, t: now };
  const newDay = { ...day, [kind]: rec };
  const done =
    newDay.definitions?.done && newDay.synonyms?.done && !p.done.includes(today)
      ? [...p.done, today].sort()
      : p.done;
  return pruneDays({ ...p, words, days: { ...p.days, [today]: newDay }, done, t: now }, today);
}

/**
 * Record the results of an extra practice round that the user chose to count: word
 * statuses and review dates are updated like for the daily challenge, but no day record
 * is written, so practice never changes the daily streak or the day's own session.
 */
export function recordPractice(p: Progress, results: Record<string, Result>, today: string, now: number): Progress {
  const words = { ...p.words };
  for (const [id, res] of Object.entries(results)) words[id] = applyResult(words[id], res, today, now);
  return { ...p, words, t: now };
}

export function pruneDays(p: Progress, today: string): Progress {
  const cutoff = addDays(today, -KEEP_DAYS);
  const days: Progress['days'] = {};
  for (const [d, rec] of Object.entries(p.days)) if (d >= cutoff) days[d] = rec;
  return { ...p, days };
}

function pickSession(a?: SessionRecord, b?: SessionRecord): SessionRecord | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.done !== b.done) return a.done ? a : b;
  return a.t >= b.t ? a : b;
}

/** Merge two progress files (e.g. local + remote): newest record wins per word / session. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const words: Record<string, WordProgress> = { ...a.words };
  for (const [id, wp] of Object.entries(b.words)) {
    const cur = words[id];
    if (!cur || wp.t > cur.t) words[id] = wp;
  }
  const days: Progress['days'] = {};
  for (const d of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) {
    const definitions = pickSession(a.days[d]?.definitions, b.days[d]?.definitions);
    const synonyms = pickSession(a.days[d]?.synonyms, b.days[d]?.synonyms);
    days[d] = { ...(definitions ? { definitions } : {}), ...(synonyms ? { synonyms } : {}) };
  }
  const done = [...new Set([...a.done, ...b.done])].sort();
  return { v: 1, words, days, done, t: Math.max(a.t, b.t) };
}

export function sameProgress(a: Progress, b: Progress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Consecutive fully-completed days ending today (or yesterday if today is still open). */
export function streak(p: Progress, today: string): number {
  const set = new Set(p.done);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function countStatus(p: Progress, prefix: 'd:' | 's:', total: number) {
  let known = 0;
  let unknown = 0;
  for (const [id, wp] of Object.entries(p.words)) {
    if (!id.startsWith(prefix)) continue;
    if (wp.s === 'k') known++;
    else unknown++;
  }
  return { known, unknown, fresh: Math.max(0, total - known - unknown), total };
}

/** Accept anything that looks like a progress file; otherwise return null. */
export function parseProgress(raw: unknown): Progress | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Progress>;
  if (o.v !== 1 || typeof o.words !== 'object' || o.words === null) return null;
  return {
    v: 1,
    words: o.words as Progress['words'],
    days: (o.days ?? {}) as Progress['days'],
    done: Array.isArray(o.done) ? o.done.filter((x): x is string => typeof x === 'string') : [],
    t: typeof o.t === 'number' ? o.t : 0,
  };
}
