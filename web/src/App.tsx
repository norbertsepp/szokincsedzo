import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DefinitionEntry, Entry, GameItem, Kind, PracticeConfig, Progress, Result, Settings, SynonymEntry } from './types';
import { STRINGS } from './i18n';
import { Session } from './components/Session';
import { Scorecard } from './components/Scorecard';
import { PracticeSetup } from './components/PracticeSetup';
import { SettingsPanel, type SyncState } from './components/SettingsPanel';
import { completeSession, emptyProgress, mergeProgress, pruneDays, recordPractice, sameProgress, startSession, streak } from './lib/progress';
import { countByLevel, poolFor } from './lib/rarity';
import { selectEntries, toGameItem } from './lib/selection';
import { isConfigured, syncProgress } from './lib/githubSync';
import { loadBank, loadProgress, loadSettings, saveProgress, saveSettings } from './lib/storage';
import { todayStr } from './lib/util';

type Screen = 'home' | 'play' | 'practice' | 'scorecard' | 'settings';
interface Active {
  kind: Kind;
  ids: string[];
  review: boolean; // open an already completed session in review mode
  practice?: PracticeConfig; // set for extra practice rounds (not the daily challenge)
  id: number; // distinguishes consecutive practice rounds
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [defs, setDefs] = useState<DefinitionEntry[] | null>(null);
  const [syns, setSyns] = useState<SynonymEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [today, setToday] = useState(todayStr());
  const [screen, setScreen] = useState<Screen>('home');
  const [active, setActive] = useState<Active | null>(null);
  const [sync, setSync] = useState<SyncState>({ status: 'off' });
  const [practiceError, setPracticeError] = useState('');

  const t = STRINGS[settings.lang];
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;

  // ---- persistence
  useEffect(() => saveProgress(progress), [progress]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  // ---- word banks
  useEffect(() => {
    Promise.all([loadBank<DefinitionEntry>('definitions'), loadBank<SynonymEntry>('synonyms')])
      .then(([d, s]) => {
        setDefs(d);
        setSyns(s);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // ---- sync with the private GitHub repo
  const doSync = useCallback(async () => {
    const cfg = settingsRef.current.sync;
    if (!isConfigured(cfg)) {
      setSync({ status: 'off' });
      return;
    }
    setSync({ status: 'busy' });
    try {
      const merged = await syncProgress(cfg, progressRef.current);
      setProgress((cur) => {
        const m = mergeProgress(cur, merged);
        return sameProgress(m, cur) ? cur : m;
      });
      setSync({ status: 'ok', at: Date.now() });
    } catch (e) {
      setSync({ status: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void doSync(); // once at start-up
  }, [doSync]);

  // PWA resumed (phone unlocked, tab revisited): roll the date over and re-sync
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setToday(todayStr());
      void doSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [doSync]);

  const bankOf = useCallback(
    (kind: Kind): Entry[] => ((kind === 'definitions' ? defs : syns) ?? []) as Entry[],
    [defs, syns],
  );

  // ---- starting / finishing sessions
  const begin = useCallback(
    (kind: Kind) => {
      const bank = bankOf(kind);
      const p = progressRef.current;
      const rec = p.days[today]?.[kind];
      if (rec) {
        setActive({ kind, ids: rec.ids, review: rec.done, id: 0 });
      } else {
        const pool = poolFor(bank, settings.rarity, settings.size);
        const size = Math.min(settings.size, pool.length);
        const ids = selectEntries(pool, kind, p, today, size).map((e) => e.id);
        if (ids.length < 2) return;
        setProgress(startSession(p, kind, today, ids, Date.now()));
        setActive({ kind, ids, review: false, id: 0 });
      }
      setScreen('play');
    },
    [bankOf, settings.size, settings.rarity, today],
  );

  const startPractice = useCallback(
    (cfg: PracticeConfig) => {
      const pool = poolFor(bankOf(cfg.kind), cfg.rarity, cfg.size);
      const size = Math.min(cfg.size, pool.length);
      const stamp = Date.now();
      const ids = selectEntries(pool, cfg.kind, progressRef.current, today, size, {
        seed: `practice:${stamp}`,
        mode: cfg.mode,
      }).map((e) => e.id);
      setSettings((s) => ({ ...s, practice: cfg })); // remember the choice for next time
      if (ids.length < 2) {
        setPracticeError(STRINGS[settingsRef.current.lang].notEnough);
        return;
      }
      setPracticeError('');
      setActive({ kind: cfg.kind, ids, review: false, practice: cfg, id: stamp });
      setScreen('play');
    },
    [bankOf, today],
  );

  const items: GameItem[] = useMemo(() => {
    if (!active) return [];
    const byId = new Map(bankOf(active.kind).map((e) => [e.id, e] as const));
    return active.ids.flatMap((id) => {
      const e = byId.get(id);
      return e ? [toGameItem(e, active.kind, today)] : [];
    });
  }, [active, bankOf, today]);

  const onComplete = useCallback(
    (results: Record<string, Result>) => {
      const a = activeRef.current;
      if (!a) return;
      let next: Progress;
      if (a.practice) {
        if (!a.practice.count) return; // practice that is not counted leaves no trace
        next = recordPractice(progressRef.current, results, today, Date.now());
      } else {
        next = pruneDays(completeSession(progressRef.current, a.kind, today, results, Date.now()), today);
      }
      progressRef.current = next;
      setProgress(next);
      void doSync();
    },
    [today, doSync],
  );

  const home = () => {
    setScreen('home');
    setActive(null);
  };

  const dayRec = progress.days[today] ?? {};
  const defsDone = Boolean(dayRec.definitions?.done);
  const synsDone = Boolean(dayRec.synonyms?.done);
  const nextKind: Kind | null = !defsDone ? 'definitions' : !synsDone ? 'synonyms' : null;
  const isDemo = Boolean(defs && defs.length > 0 && defs.every((d) => d.source === 'demo'));

  let body: JSX.Element;
  if (loadError) {
    body = <p className="error">{t.loadError}: {loadError}</p>;
  } else if (!defs || !syns) {
    body = <p className="muted">{t.loading}</p>;
  } else if (screen === 'settings') {
    body = (
      <SettingsPanel
        settings={settings}
        progress={progress}
        sync={sync}
        counts={{ definitions: countByLevel(defs), synonyms: countByLevel(syns) }}
        t={t}
        onSave={(s) => {
          settingsRef.current = s;
          setSettings(s);
          void doSync();
        }}
        onSyncNow={() => void doSync()}
        onImport={(p) => setProgress((cur) => mergeProgress(cur, p))}
        onReset={() => setProgress(emptyProgress())}
        onHome={home}
      />
    );
  } else if (screen === 'scorecard') {
    body = <Scorecard progress={progress} defs={defs} syns={syns} today={today} t={t} onHome={home} />;
  } else if (screen === 'practice') {
    body = (
      <>
        <PracticeSetup
          t={t}
          initial={settings.practice}
          counts={{
            definitions: countByLevel(defs),
            synonyms: countByLevel(syns),
          }}
          onStart={startPractice}
          onHome={home}
        />
        {practiceError && <p className="error">{practiceError}</p>}
      </>
    );
  } else if (screen === 'play' && active) {
    const rec = progress.days[today]?.[active.kind];
    const afterDefs = !active.practice && active.kind === 'definitions' && !synsDone;
    body = (
      <Session
        key={`${active.kind}:${today}:${active.id}:${active.review ? 'r' : 'p'}`}
        kind={active.kind}
        items={items}
        t={t}
        initialResults={active.review ? rec?.res : undefined}
        onComplete={onComplete}
        title={active.practice ? `${t.practice}: ${active.kind === 'definitions' ? t.definitionsTitle : t.synonymsTitle}` : undefined}
        note={active.practice ? (active.practice.count ? t.practiceCounted : t.practiceNotCounted) : undefined}
        extra={active.practice ? { label: t.newPractice, onClick: () => setScreen('practice') } : undefined}
        nextLabel={afterDefs ? t.continueNext : t.finish}
        onNext={() => (afterDefs ? begin('synonyms') : home())}
        onHome={home}
      />
    );
  } else {
    body = (
      <Home
        t={t}
        today={today}
        progress={progress}
        defsReady={defs.length >= 2}
        synsReady={syns.length >= 2}
        defsDone={defsDone}
        synsDone={synsDone}
        nextKind={nextKind}
        isDemo={isDemo}
        onBegin={begin}
        onPractice={() => {
          setPracticeError('');
          setScreen('practice');
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={home}>
          {t.appName}
        </button>
        <nav>
          <button type="button" className="nav-btn" onClick={() => setScreen('scorecard')}>
            {t.scorecard}
          </button>
          <button type="button" className="nav-btn" onClick={() => setScreen('settings')} aria-label={t.settings}>
            {t.settings}
            <span className={`dot ${sync.status}`} aria-hidden="true" />
          </button>
        </nav>
      </header>
      <main>{body}</main>
    </div>
  );
}

interface HomeProps {
  t: (typeof STRINGS)['hu'];
  today: string;
  progress: Progress;
  defsReady: boolean;
  synsReady: boolean;
  defsDone: boolean;
  synsDone: boolean;
  nextKind: Kind | null;
  isDemo: boolean;
  onBegin: (k: Kind) => void;
  onPractice: () => void;
}

function Home({ t, today, progress, defsReady, synsReady, defsDone, synsDone, nextKind, isDemo, onBegin, onPractice }: HomeProps) {
  const rec = progress.days[today] ?? {};
  const score = (k: Kind) => {
    const r = rec[k];
    if (!r?.done) return null;
    const vals = Object.values(r.res);
    return `${vals.filter((v) => v === 'k').length}/${vals.length}`;
  };
  const started = (k: Kind) => Boolean(rec[k] && !rec[k]!.done);

  const card = (k: Kind, title: string, help: string, done: boolean, ready: boolean) => (
    <div className={`daily-card ${done ? 'done' : ''}`} data-kind={k}>
      <div>
        <h3>{title}</h3>
        <p className="muted">{help}</p>
        <p className="state">
          {done ? `${t.done} · ${t.score}: ${score(k)}` : started(k) ? t.continueToday : t.notStarted}
        </p>
      </div>
      <button type="button" className={done ? 'btn secondary' : 'btn primary'} disabled={!ready} onClick={() => onBegin(k)} data-testid={`start-${k}`}>
        {done ? t.review : started(k) ? t.continueToday : t.start}
      </button>
    </div>
  );

  return (
    <div className="home">
      <div className="hero">
        <div>
          <p className="muted">{t.today} · {today}</p>
          <p className="streak">
            {t.streak}: <strong>{streak(progress, today)}</strong> {t.days}
          </p>
        </div>
        {nextKind ? (
          <button type="button" className="btn primary big" onClick={() => onBegin(nextKind)} data-testid="start-today">
            {rec[nextKind] ? t.continueToday : t.startToday}
          </button>
        ) : (
          <p className="all-done">{t.allDone}</p>
        )}
      </div>
      {card('definitions', t.definitionsTitle, t.definitionsHelp, defsDone, defsReady)}
      {card('synonyms', t.synonymsTitle, t.synonymsHelp, synsDone, synsReady)}
      <div className="daily-card practice-card">
        <div>
          <h3>{t.practice}</h3>
          <p className="muted">{t.practiceCardHelp}</p>
        </div>
        <button type="button" className="btn secondary" onClick={onPractice} data-testid="open-practice">
          {t.start}
        </button>
      </div>
      {isDemo && <p className="notice">{t.demoNotice}</p>}
    </div>
  );
}
