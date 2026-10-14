import { useRef, useState } from 'react';
import type { Progress, Rarity, Settings } from '../types';
import type { Strings } from '../i18n';
import { parseProgress } from '../lib/progress';

export type SyncState = { status: 'off' | 'busy' | 'ok' | 'error'; message?: string; at?: number };

interface Props {
  settings: Settings;
  progress: Progress;
  sync: SyncState;
  counts: Record<'definitions' | 'synonyms', Record<Rarity, number>>;
  t: Strings;
  onSave: (s: Settings) => void;
  onSyncNow: () => void;
  onImport: (p: Progress) => void;
  onReset: () => void;
  onHome: () => void;
}

export function SettingsPanel({ settings, progress, sync, counts, t, onSave, onSyncNow, onImport, onReset, onHome }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const setSync = (k: keyof Settings['sync'], v: string) =>
    setDraft((d) => ({ ...d, sync: { ...d.sync, [k]: v } }));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(progress, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'progress.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = parseProgress(JSON.parse(await file.text()));
      if (!p) throw new Error('bad');
      onImport(p);
      setMsg('');
    } catch {
      setMsg(t.importFailed);
    }
  };

  const syncText =
    sync.status === 'off' ? t.syncOff
    : sync.status === 'busy' ? t.syncBusy
    : sync.status === 'ok' ? `${t.syncOk}${sync.at ? ` · ${new Date(sync.at).toLocaleTimeString()}` : ''}`
    : `${t.syncError}: ${sync.message ?? ''}`;

  return (
    <div className="settings">
      <header className="session-head">
        <button type="button" className="link" onClick={onHome}>
          ← {t.backHome}
        </button>
        <h2>{t.settings}</h2>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...draft, size: Math.min(15, Math.max(12, Number(draft.size) || 12)) });
        }}
      >
        <label className="field">
          <span>{t.language}</span>
          <select value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as 'hu' | 'en' })}>
            <option value="hu">Magyar</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">
          <span>
            {t.dailySize}: {draft.size}
          </span>
          <input type="range" min={12} max={15} value={draft.size} onChange={(e) => setDraft({ ...draft, size: Number(e.target.value) })} />
        </label>

        <fieldset>
          <legend>{t.dailyRarity}</legend>
          {(
            [
              ['veryrare', t.rarityVeryRare],
              ['rare', t.rarityRare],
              ['all', t.rarityAll],
            ] as [Rarity, string][]
          ).map(([l, label]) => (
            <label key={l} className={draft.rarity === l ? 'choice block active' : 'choice block'}>
              <input type="radio" name="daily-rarity" checked={draft.rarity === l} onChange={() => setDraft({ ...draft, rarity: l })} />
              <span>
                <strong>
                  {label}{' '}
                  <span className="count">
                    ({counts.definitions[l]} / {counts.synonyms[l]})
                  </span>
                </strong>
              </span>
            </label>
          ))}
          <p className="muted small">{t.rarityLevelHelp} ({t.definitionsTitle} / {t.synonymsTitle})</p>
        </fieldset>

        <h3>{t.sync}</h3>
        <p className="muted">{t.syncHelp}</p>
        <label className="field">
          <span>{t.owner}</span>
          <input value={draft.sync.owner} autoCapitalize="none" autoCorrect="off" onChange={(e) => setSync('owner', e.target.value)} />
        </label>
        <label className="field">
          <span>{t.repo}</span>
          <input value={draft.sync.repo} autoCapitalize="none" autoCorrect="off" onChange={(e) => setSync('repo', e.target.value)} />
        </label>
        <label className="field">
          <span>{t.path}</span>
          <input value={draft.sync.path} autoCapitalize="none" autoCorrect="off" onChange={(e) => setSync('path', e.target.value)} />
        </label>
        <label className="field">
          <span>{t.branch}</span>
          <input value={draft.sync.branch ?? ''} autoCapitalize="none" autoCorrect="off" onChange={(e) => setSync('branch', e.target.value)} />
        </label>
        <label className="field">
          <span>{t.token}</span>
          <input type="password" value={draft.sync.token} autoComplete="off" onChange={(e) => setSync('token', e.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" className="btn primary">
            {t.save}
          </button>
          <button type="button" className="btn secondary" onClick={onSyncNow}>
            {t.syncNow}
          </button>
        </div>
        <p className={`sync-status ${sync.status}`} role="status">
          {syncText}
        </p>
      </form>

      <div className="actions wrap">
        <button type="button" className="btn secondary" onClick={exportJson}>
          {t.exportData}
        </button>
        <button type="button" className="btn secondary" onClick={() => fileRef.current?.click()}>
          {t.importData}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            if (window.confirm(t.resetConfirm)) onReset();
          }}
        >
          {t.reset}
        </button>
      </div>
      {msg && <p className="error">{msg}</p>}

      <h3>{t.sources}</h3>
      <p className="muted">{t.sourcesText}</p>
    </div>
  );
}
