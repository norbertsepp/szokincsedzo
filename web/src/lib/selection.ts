import type { DefinitionEntry, Entry, GameItem, Kind, PracticeMode, Progress, SynonymEntry } from '../types';
import { hashString, mulberry32, shuffle } from './util';

export const REVIEW_SHARE = 0.4; // up to 40% of a session are words due for review

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

/** Two cards may share a session only if the game stays unambiguous. */
function compatible(kind: Kind, chosen: Entry[], cand: Entry): boolean {
  if (kind === 'definitions') {
    const d = normalise((cand as DefinitionEntry).definition);
    return chosen.every((c) => c.word !== cand.word && normalise((c as DefinitionEntry).definition) !== d);
  }
  const mine = new Set([cand.word, ...(cand as SynonymEntry).synonyms].map(normalise));
  return chosen.every((c) => {
    const theirs = [c.word, ...(c as SynonymEntry).synonyms].map(normalise);
    return theirs.every((w) => !mine.has(w));
  });
}

/**
 * Pick today's words. Deterministic for a given date + progress, so every device
 * would choose the same set; the chosen ids are then frozen in the day record.
 *
 * Order of preference: words due for review (unknown first, oldest due first) up to
 * REVIEW_SHARE of the session, then never-seen words, then any remaining due words,
 * then already-known words that are not yet due.
 */
export function selectEntries<E extends Entry>(
  entries: readonly E[],
  kind: Kind,
  progress: Progress,
  today: string,
  size: number,
  opts: { seed?: string; mode?: PracticeMode } = {},
): E[] {
  const rng = mulberry32(hashString(`${opts.seed ?? today}:${kind}`));
  const mode = opts.mode ?? 'mix';
  const shuffled = shuffle(entries, rng);

  const due: E[] = [];
  const fresh: E[] = [];
  const later: E[] = [];
  for (const e of shuffled) {
    const wp = progress.words[e.id];
    if (!wp) fresh.push(e);
    else if (wp.d <= today) due.push(e);
    else later.push(e);
  }
  due.sort((a, b) => {
    const wa = progress.words[a.id];
    const wb = progress.words[b.id];
    if (wa.s !== wb.s) return wa.s === 'u' ? -1 : 1; // unknown first
    return wa.d < wb.d ? -1 : wa.d > wb.d ? 1 : 0;
  });

  let ordered: E[];
  if (mode === 'new') {
    ordered = [...fresh, ...due, ...later]; // never-seen words first, top up if the pool runs dry
  } else if (mode === 'unknown') {
    // only words currently tagged unknown (due ones first); no top-up: the user asked for these
    const unknown = [...due, ...later].filter((e) => progress.words[e.id].s === 'u');
    ordered = unknown;
  } else {
    const quota = Math.min(due.length, Math.ceil(size * REVIEW_SHARE));
    ordered = [...due.slice(0, quota), ...fresh, ...due.slice(quota), ...later];
  }

  const chosen: E[] = [];
  for (const cand of ordered) {
    if (chosen.length >= size) break;
    if (compatible(kind, chosen, cand)) chosen.push(cand);
  }
  return chosen;
}

/** A seeded subset of a word's synonyms to show as the clue (order shuffled, stable per day). */
export function synonymClue(entry: SynonymEntry, today: string, max = 5): string[] {
  const rng = mulberry32(hashString(`${today}:${entry.id}`));
  return shuffle(entry.synonyms, rng).slice(0, max);
}

export function toGameItem(entry: Entry, kind: Kind, today: string): GameItem {
  if (kind === 'definitions') {
    const d = entry as DefinitionEntry;
    return { id: d.id, word: d.word, clue: d.definition, entry };
  }
  const s = entry as SynonymEntry;
  return { id: s.id, word: s.word, clue: synonymClue(s, today).join(', '), entry };
}
