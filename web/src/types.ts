export type Kind = 'definitions' | 'synonyms';
export type Result = 'k' | 'u'; // known / unknown

export interface DefinitionEntry {
  id: string; // "d:<word>"
  word: string;
  pos: string;
  definition: string;
  examples: string[];
  labels: string[];
  synonyms: string[];
  freq: number | null; // corpus count of the word's family (lower = rarer); null = unknown (demo)
  source: string;
  url: string;
}

export interface SynonymEntry {
  id: string; // "s:<word>"
  word: string;
  synonyms: string[];
  freq: number | null;
}

export type Entry = DefinitionEntry | SynonymEntry;

export interface Bank<E extends Entry> {
  version: number;
  generated: string;
  source: string;
  entries: E[];
}

/** What the match game shows: a word on the left, a clue on the right. */
export interface GameItem {
  id: string;
  word: string;
  clue: string;
  entry: Entry;
}

// ---- progress (compact keys: this file is synced through the GitHub API) ----

export interface WordProgress {
  s: Result; // current status
  b: number; // Leitner box 0..5
  d: string; // next due date YYYY-MM-DD
  r: number; // times right (first try)
  w: number; // times wrong
  t: number; // last update, epoch ms
}

export interface SessionRecord {
  ids: string[]; // the words chosen for the day (fixed once started)
  res: Record<string, Result>; // results, filled in when the session completes
  done: boolean;
  t: number;
}

export interface DayRecord {
  definitions?: SessionRecord;
  synonyms?: SessionRecord;
}

export interface Progress {
  v: 1;
  words: Record<string, WordProgress>;
  days: Record<string, DayRecord>; // only the most recent days are kept in detail
  done: string[]; // every date on which both sessions were completed
  t: number;
}

export interface SyncConfig {
  owner: string;
  repo: string;
  path: string;
  token: string;
  branch?: string;
}

export type Rarity = 'all' | 'rare' | 'veryrare';
export type PracticeMode = 'mix' | 'new' | 'unknown';

export interface PracticeConfig {
  kind: Kind;
  size: number; // 12..30
  mode: PracticeMode;
  rarity: Rarity;
  count: boolean; // record the results in the progress report
}

export interface Settings {
  lang: 'hu' | 'en';
  size: number; // words in the daily challenge, 12..15
  rarity: Rarity; // rarity level of the daily challenge
  practice: PracticeConfig; // last-used practice setup
  sync: SyncConfig;
}
