import type { Entry, Rarity } from '../types';

/**
 * Rarity levels, by word-family frequency in the corpus (see tools/vocabtools/common.py).
 * 'rare'     <= 600 occurrences in ~700 M words: uncommon, still understandable
 * 'veryrare' <= 60: genuinely rare words
 * Entries without a frequency (the demo set) are never filtered out.
 */
export const RARITY_MAX: Record<Rarity, number> = { all: Infinity, rare: 600, veryrare: 60 };

export function inLevel(e: Entry, level: Rarity): boolean {
  return e.freq === null || e.freq === undefined || e.freq <= RARITY_MAX[level];
}

export function countByLevel(entries: readonly Entry[]): Record<Rarity, number> {
  return {
    all: entries.length,
    rare: entries.filter((e) => inLevel(e, 'rare')).length,
    veryrare: entries.filter((e) => inLevel(e, 'veryrare')).length,
  };
}

/**
 * The words a session may draw from at a given level. If the level is too narrow to
 * fill a session, the pool is topped up with the next-rarest words rather than failing.
 */
export function poolFor<E extends Entry>(entries: readonly E[], level: Rarity, minSize: number): E[] {
  const pool = entries.filter((e) => inLevel(e, level));
  if (pool.length >= minSize * 3) return pool;
  const rest = entries
    .filter((e) => !pool.includes(e))
    .sort((a, b) => (a.freq ?? 0) - (b.freq ?? 0));
  return [...pool, ...rest.slice(0, minSize * 3 - pool.length)];
}
