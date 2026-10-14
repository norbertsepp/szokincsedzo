import { describe, expect, it } from 'vitest';
import type { DefinitionEntry, Progress, SynonymEntry } from '../types';
import { ConflictError, pullRemote, syncProgress } from './githubSync';
import {
  applyResult,
  completeSession,
  emptyProgress,
  mergeProgress,
  parseProgress,
  recordPractice,
  startSession,
  streak,
} from './progress';
import { selectEntries, synonymClue } from './selection';
import { countByLevel, inLevel, poolFor } from './rarity';
import { addDays, mulberry32, shuffle, todayStr } from './util';

const defs = (n: number): DefinitionEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `d:w${i}`, word: `w${i}`, pos: '', definition: `definition number ${i}`,
    examples: [], labels: [], synonyms: [], freq: null, source: 'test', url: '',
  }));

const syns = (): SynonymEntry[] => [
  { id: 's:a', word: 'a', synonyms: ['b', 'c', 'd'], freq: 1 },
  { id: 's:e', word: 'e', synonyms: ['f', 'g', 'h'], freq: 2 },
  { id: 's:clash', word: 'clash', synonyms: ['c', 'x', 'y'], freq: 3 }, // shares "c" with a
  { id: 's:i', word: 'i', synonyms: ['j', 'k', 'l'], freq: 4 },
];

describe('util', () => {
  it('formats local dates and adds days across month ends', () => {
    expect(todayStr(new Date(2026, 9, 14))).toBe('2026-10-14');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('seeded rng is reproducible', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], mulberry32(5));
    const b = shuffle([1, 2, 3, 4, 5, 6], mulberry32(5));
    expect(a).toEqual(b);
  });
});

describe('spaced repetition', () => {
  it('moves up a box on a first-try hit and resets on a miss', () => {
    const a = applyResult(undefined, 'k', '2026-10-14', 1);
    expect(a).toMatchObject({ s: 'k', b: 1, d: '2026-10-16', r: 1, w: 0 });
    const b = applyResult(a, 'k', '2026-10-16', 2);
    expect(b).toMatchObject({ b: 2, d: '2026-10-20' });
    const c = applyResult(b, 'u', '2026-10-20', 3);
    expect(c).toMatchObject({ s: 'u', b: 0, d: '2026-10-21', w: 1 });
  });
  it('caps at the top box', () => {
    let p = applyResult(undefined, 'k', '2026-01-01', 1);
    for (let i = 0; i < 10; i++) p = applyResult(p, 'k', '2026-01-01', 1);
    expect(p.b).toBe(5);
  });
});

describe('selection', () => {
  const today = '2026-10-14';
  it('is deterministic per day and returns the requested size', () => {
    const e = defs(40);
    const a = selectEntries(e, 'definitions', emptyProgress(), today, 12).map((x) => x.id);
    const b = selectEntries(e, 'definitions', emptyProgress(), today, 12).map((x) => x.id);
    const c = selectEntries(e, 'definitions', emptyProgress(), '2026-10-15', 12).map((x) => x.id);
    expect(a).toHaveLength(12);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(12);
  });
  it('mixes in unknown words that are due, ahead of known ones', () => {
    const e = defs(40);
    let p = emptyProgress();
    p = { ...p, words: {
      'd:w0': { s: 'u', b: 0, d: '2026-10-13', r: 0, w: 1, t: 1 },
      'd:w1': { s: 'k', b: 1, d: '2026-10-13', r: 1, w: 0, t: 1 },
      'd:w2': { s: 'k', b: 3, d: '2026-12-01', r: 3, w: 0, t: 1 }, // not due
    } };
    const ids = selectEntries(e, 'definitions', p, today, 10).map((x) => x.id);
    expect(ids).toContain('d:w0');
    expect(ids).toContain('d:w1');
    expect(ids).not.toContain('d:w2');
  });
  it('falls back to not-yet-due words when the bank is small', () => {
    const e = defs(5);
    const words: Progress['words'] = {};
    e.forEach((x) => (words[x.id] = { s: 'k', b: 2, d: '2099-01-01', r: 1, w: 0, t: 1 }));
    const ids = selectEntries(e, 'definitions', { ...emptyProgress(), words }, today, 12);
    expect(ids).toHaveLength(5);
  });
  it('never puts overlapping synonym sets into one session', () => {
    for (const day of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) {
      const ids = selectEntries(syns(), 'synonyms', emptyProgress(), day, 4).map((x) => x.id);
      expect(ids.includes('s:a') && ids.includes('s:clash')).toBe(false);
    }
  });
  it('synonym clue is a stable subset', () => {
    const e = { id: 's:z', word: 'z', synonyms: ['1', '2', '3', '4', '5', '6', '7'], freq: 1 };
    const a = synonymClue(e, today);
    expect(a).toHaveLength(5);
    expect(synonymClue(e, today)).toEqual(a);
    expect(a.every((x) => e.synonyms.includes(x))).toBe(true);
  });
});

describe('progress', () => {
  const today = '2026-10-14';
  it('startSession freezes ids; completeSession records once and builds the streak', () => {
    let p = startSession(emptyProgress(), 'definitions', today, ['d:a', 'd:b'], 1);
    p = startSession(p, 'definitions', today, ['d:zzz'], 2); // ignored: already started
    expect(p.days[today].definitions?.ids).toEqual(['d:a', 'd:b']);
    p = completeSession(p, 'definitions', today, { 'd:a': 'k', 'd:b': 'u' }, 3);
    const again = completeSession(p, 'definitions', today, { 'd:a': 'u', 'd:b': 'u' }, 4);
    expect(again).toBe(p); // double-submit ignored
    expect(p.words['d:b'].s).toBe('u');
    expect(streak(p, today)).toBe(0); // synonyms not done yet
    p = completeSession(p, 'synonyms', today, { 's:x': 'k' }, 5);
    expect(p.done).toEqual([today]);
    expect(streak(p, today)).toBe(1);
  });
  it('streak counts back from yesterday when today is still open', () => {
    const p: Progress = { ...emptyProgress(), done: ['2026-10-12', '2026-10-13'] };
    expect(streak(p, '2026-10-14')).toBe(2);
    expect(streak({ ...p, done: ['2026-10-10'] }, '2026-10-14')).toBe(0);
  });
  it('merge keeps the newest word record and any completed session', () => {
    const a: Progress = { ...emptyProgress(), words: { 'd:a': { s: 'k', b: 1, d: 'x', r: 1, w: 0, t: 10 } },
      days: { x: { definitions: { ids: ['d:a'], res: {}, done: false, t: 5 } } }, done: ['2026-10-01'], t: 10 };
    const b: Progress = { ...emptyProgress(), words: { 'd:a': { s: 'u', b: 0, d: 'y', r: 1, w: 1, t: 20 } },
      days: { x: { definitions: { ids: ['d:a'], res: { 'd:a': 'u' }, done: true, t: 6 } } }, done: ['2026-10-02'], t: 20 };
    const m = mergeProgress(a, b);
    expect(m.words['d:a'].s).toBe('u');
    expect(m.days.x.definitions?.done).toBe(true);
    expect(m.done).toEqual(['2026-10-01', '2026-10-02']);
    expect(mergeProgress(b, a)).toEqual(m); // symmetric
  });
  it('parseProgress rejects junk', () => {
    expect(parseProgress({})).toBeNull();
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress({ v: 1, words: {} })).not.toBeNull();
  });
});

// ---- GitHub sync against a tiny fake of the Contents API ----
function fakeGithub(initial?: Progress) {
  let file: { json: string; sha: string } | null = initial
    ? { json: JSON.stringify(initial), sha: 'sha1' }
    : null;
  let n = 1;
  const puts: unknown[] = [];
  let conflictOnce = false;
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
      if (conflictOnce) {
        conflictOnce = false;
        // another device writes first
        file = { json: JSON.stringify(otherDevice), sha: `sha${++n}` };
        return json({ message: 'conflict' }, 409);
      }
      if ((file?.sha ?? undefined) !== body.sha) return json({ message: 'sha mismatch' }, 409);
      file = { json: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha${++n}` };
      puts.push(JSON.parse(file.json));
      return json({ content: { sha: file.sha } });
    }
    if (u.includes('/contents/')) {
      if (!file) return json({ message: 'Not Found' }, 404);
      return json({ sha: file.sha, encoding: 'base64', content: b64(file.json) });
    }
    return json({ full_name: 'o/r' }); // repo probe
  }) as unknown as typeof fetch;
  const otherDevice: Progress = { ...emptyProgress(), words: { 'd:remote': { s: 'k', b: 1, d: '2026-10-20', r: 1, w: 0, t: 99 } }, t: 99 };
  return { f, puts, get file() { return file; }, setConflictOnce() { conflictOnce = true; } };
}

const cfg = { owner: 'o', repo: 'r', path: 'progress.json', token: 't' };
const localWithWord: Progress = { ...emptyProgress(), words: { 'd:árvíztűrő': { s: 'k', b: 1, d: '2026-10-16', r: 1, w: 0, t: 5 } }, t: 5 };

describe('github sync', () => {
  it('creates the file when it does not exist yet and round-trips UTF-8', async () => {
    const gh = fakeGithub();
    await syncProgress(cfg, localWithWord, gh.f);
    expect(gh.puts).toHaveLength(1);
    const back = await pullRemote(cfg, gh.f);
    expect(Object.keys(back.progress?.words ?? {})).toEqual(['d:árvíztűrő']);
  });
  it('merges remote progress into local and writes the union', async () => {
    const remote: Progress = { ...emptyProgress(), words: { 'd:remote': { s: 'u', b: 0, d: '2026-10-15', r: 0, w: 1, t: 50 } }, t: 50 };
    const gh = fakeGithub(remote);
    const merged = await syncProgress(cfg, localWithWord, gh.f);
    expect(Object.keys(merged.words).sort()).toEqual(['d:remote', 'd:árvíztűrő']);
    expect(gh.puts).toHaveLength(1);
  });
  it('does not write when remote is already up to date', async () => {
    const gh = fakeGithub(localWithWord);
    await syncProgress(cfg, localWithWord, gh.f);
    expect(gh.puts).toHaveLength(0);
  });
  it('retries after a conflict from another device and keeps both sides', async () => {
    const gh = fakeGithub({ ...emptyProgress() });
    gh.setConflictOnce();
    const merged = await syncProgress(cfg, localWithWord, gh.f);
    expect(Object.keys(merged.words).sort()).toEqual(['d:remote', 'd:árvíztűrő']);
    expect(ConflictError).toBeDefined();
  });
  it('reports a clear error when the token has no access', async () => {
    const f = (async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as unknown as typeof fetch;
    await expect(pullRemote(cfg, f)).rejects.toThrow(/401/);
  });
});

describe('rarity levels', () => {
  const mk = (n: number, freq: number | null): SynonymEntry => ({ id: `s:r${n}`, word: `r${n}`, synonyms: [`a${n}`, `b${n}`, `c${n}`], freq });
  const bank = [mk(1, 5), mk(2, 50), mk(3, 400), mk(4, 4000), mk(5, null)];

  it('filters by family frequency and never drops entries without one', () => {
    expect(bank.filter((e) => inLevel(e, 'veryrare')).map((e) => e.id)).toEqual(['s:r1', 's:r2', 's:r5']);
    expect(bank.filter((e) => inLevel(e, 'rare')).map((e) => e.id)).toEqual(['s:r1', 's:r2', 's:r3', 's:r5']);
    expect(countByLevel(bank)).toEqual({ all: 5, rare: 4, veryrare: 3 });
  });

  it('tops up a too-narrow level with the next-rarest words instead of failing', () => {
    const pool = poolFor(bank, 'veryrare', 3); // needs 9 words, only 5 exist
    expect(pool).toHaveLength(5);
    const many = Array.from({ length: 40 }, (_, i) => mk(100 + i, 1000 + i));
    const topped = poolFor([...many, mk(1, 5)], 'veryrare', 4); // 1 rare word, needs 12
    expect(topped).toHaveLength(12);
    expect(topped[0].freq).toBe(5);
    expect(topped.slice(1).every((e) => (e.freq ?? 0) < 1011)).toBe(true); // rarest of the rest
  });
});

describe('practice sessions', () => {
  const today = '2026-10-14';
  const e = defs(60);

  it('different seeds give different words, the same seed repeats', () => {
    const a = selectEntries(e, 'definitions', emptyProgress(), today, 20, { seed: 'practice:1' }).map((x) => x.id);
    const b = selectEntries(e, 'definitions', emptyProgress(), today, 20, { seed: 'practice:1' }).map((x) => x.id);
    const c = selectEntries(e, 'definitions', emptyProgress(), today, 20, { seed: 'practice:2' }).map((x) => x.id);
    expect(a).toHaveLength(20);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('supports sizes up to 30', () => {
    expect(selectEntries(e, 'definitions', emptyProgress(), today, 30, { seed: 'x' })).toHaveLength(30);
  });

  it("'new' mode prefers never-seen words, 'unknown' mode returns only unknown ones", () => {
    const words: Progress['words'] = {};
    for (let i = 0; i < 10; i++) words[`d:w${i}`] = { s: i < 3 ? 'u' : 'k', b: 1, d: '2026-10-01', r: 1, w: 0, t: 1 };
    const p = { ...emptyProgress(), words };
    const fresh = selectEntries(e, 'definitions', p, today, 20, { seed: 's', mode: 'new' });
    expect(fresh.every((x) => !(x.id in words))).toBe(true);
    const unknown = selectEntries(e, 'definitions', p, today, 20, { seed: 's', mode: 'unknown' }).map((x) => x.id).sort();
    expect(unknown).toEqual(['d:w0', 'd:w1', 'd:w2']);
    expect(selectEntries(e, 'definitions', emptyProgress(), today, 20, { seed: 's', mode: 'unknown' })).toEqual([]);
  });

  it('recordPractice updates words but never touches days or the streak', () => {
    const base: Progress = { ...emptyProgress(), done: ['2026-10-13'] };
    const next = recordPractice(base, { 'd:a': 'k', 'd:b': 'u' }, today, 9);
    expect(next.words['d:a'].s).toBe('k');
    expect(next.words['d:b']).toMatchObject({ s: 'u', w: 1 });
    expect(next.days).toEqual(base.days);
    expect(next.done).toEqual(base.done);
    expect(streak(next, today)).toBe(1);
  });
});
