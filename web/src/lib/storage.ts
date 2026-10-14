import type { Bank, Entry, PracticeConfig, Progress, Rarity, Settings } from '../types';
import { emptyProgress, parseProgress } from './progress';

const PROGRESS_KEY = 'hvt.progress.v1';
const SETTINGS_KEY = 'hvt.settings.v1';

export const defaultPractice = (): PracticeConfig => ({
  kind: 'definitions',
  size: 20,
  mode: 'mix',
  rarity: 'veryrare',
  count: false,
});

export const defaultSettings = (): Settings => ({
  lang: 'hu',
  size: 12,
  rarity: 'veryrare',
  practice: defaultPractice(),
  sync: { owner: '', repo: '', path: 'progress.json', token: '', branch: '' },
});

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: the app still works for this session */
  }
}

export function loadProgress(): Progress {
  return parseProgress(read(PROGRESS_KEY)) ?? emptyProgress();
}
export function saveProgress(p: Progress): void {
  write(PROGRESS_KEY, p);
}

export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY) as Partial<Settings> | null;
  const d = defaultSettings();
  if (!raw) return d;
  const rarity = (v: unknown, fallback: Rarity): Rarity =>
    v === 'all' || v === 'rare' || v === 'veryrare' ? v : fallback;
  const pr: Partial<PracticeConfig> = raw.practice ?? {};
  return {
    lang: raw.lang === 'en' ? 'en' : 'hu',
    size: Math.min(15, Math.max(12, Number(raw.size) || d.size)),
    rarity: rarity(raw.rarity, d.rarity),
    practice: {
      kind: pr.kind === 'synonyms' ? 'synonyms' : 'definitions',
      size: Math.min(30, Math.max(12, Number(pr.size) || d.practice.size)),
      mode: pr.mode === 'new' || pr.mode === 'unknown' ? pr.mode : 'mix',
      rarity: rarity(pr.rarity, d.practice.rarity),
      count: pr.count === true,
    },
    sync: { ...d.sync, ...(raw.sync ?? {}) },
  };
}
export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export async function loadBank<E extends Entry>(name: 'definitions' | 'synonyms'): Promise<E[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
  if (!res.ok) throw new Error(`Could not load ${name}.json (HTTP ${res.status})`);
  const bank = (await res.json()) as Bank<E>;
  return (bank.entries ?? []).filter(
    (e) => e && typeof e.id === 'string' && typeof e.word === 'string',
  );
}
