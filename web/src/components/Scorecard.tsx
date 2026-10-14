import { useMemo, useState } from 'react';
import type { DefinitionEntry, Progress, SynonymEntry } from '../types';
import type { Strings } from '../i18n';
import { countStatus, streak } from '../lib/progress';

interface Props {
  progress: Progress;
  defs: DefinitionEntry[];
  syns: SynonymEntry[];
  today: string;
  t: Strings;
  onHome: () => void;
}

type Filter = 'u' | 'k' | 'all';

export function Scorecard({ progress, defs, syns, today, t, onHome }: Props) {
  const [filter, setFilter] = useState<Filter>('u');
  const d = countStatus(progress, 'd:', defs.length);
  const s = countStatus(progress, 's:', syns.length);

  const rows = useMemo(() => {
    const byId = new Map<string, { word: string; clue: string }>();
    for (const e of defs) byId.set(e.id, { word: e.word, clue: e.definition });
    for (const e of syns) byId.set(e.id, { word: e.word, clue: e.synonyms.join(', ') });
    return Object.entries(progress.words)
      .filter(([id, wp]) => byId.has(id) && (filter === 'all' || wp.s === filter))
      .map(([id, wp]) => ({ id, ...byId.get(id)!, wp }))
      .sort((a, b) => b.wp.t - a.wp.t)
      .slice(0, 200);
  }, [progress, defs, syns, filter]);

  return (
    <div className="scorecard">
      <header className="session-head">
        <button type="button" className="link" onClick={onHome}>
          ← {t.backHome}
        </button>
        <h2>{t.scorecard}</h2>
      </header>

      <div className="tiles">
        <Tile title={t.definitionsTitle} c={d} t={t} />
        <Tile title={t.synonymsTitle} c={s} t={t} />
      </div>
      <p className="muted">
        {t.streak}: {streak(progress, today)} {t.days} · {t.sessionsDone}: {progress.done.length}
      </p>

      <div className="tabs" role="tablist">
        {(['u', 'k', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? 'tab active' : 'tab'}
            onClick={() => setFilter(f)}
          >
            {f === 'u' ? t.unknown : f === 'k' ? t.known : t.all}
          </button>
        ))}
      </div>
      <ul className="word-list">
        {rows.map((r) => (
          <li key={r.id} className={r.wp.s === 'u' ? 'unknown' : 'known'}>
            <strong>{r.word}</strong>
            <span className="clue">{r.clue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ title, c, t }: { title: string; c: { known: number; unknown: number; fresh: number; total: number }; t: Strings }) {
  const pct = (n: number) => `${(n / Math.max(1, c.total)) * 100}%`;
  return (
    <div className="tile">
      <h3>{title}</h3>
      <div className="stack" aria-hidden="true">
        <div className="seg known" style={{ width: pct(c.known) }} />
        <div className="seg unknown" style={{ width: pct(c.unknown) }} />
      </div>
      <dl>
        <div><dt>{t.known}</dt><dd>{c.known}</dd></div>
        <div><dt>{t.unknown}</dt><dd>{c.unknown}</dd></div>
        <div><dt>{t.fresh}</dt><dd>{c.fresh}</dd></div>
      </dl>
    </div>
  );
}
