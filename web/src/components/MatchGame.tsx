import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameItem, Result } from '../types';
import type { Strings } from '../i18n';
import { shuffle } from '../lib/util';

interface Props {
  items: GameItem[];
  rightLabel: string;
  hint: string;
  t: Strings;
  /** called once, when the user submits; results are final from here on */
  onSubmit: (results: Record<string, Result>) => void;
  /** called when the user leaves the corrected board */
  onContinue: () => void;
  continueLabel: string;
}

interface Line {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: string;
  hue: number;
}

const hueOf = (row: number) => Math.round((row * 137.508) % 360);

/**
 * Pairing board. Tap a word and then a definition / synonym set (in either order) to
 * connect them; the pair gets its own colour, number and a connecting line. Tap a connected
 * card to release it and connect it differently. Nothing is scored until "Submit":
 * then correct pairs turn green, wrong ones red, and the right answers are shown.
 */
export function MatchGame({ items, rightLabel, hint, t, onSubmit, onContinue, continueLabel }: Props) {
  const left = useMemo(() => shuffle(items), [items]);
  const right = useMemo(() => shuffle(items), [items]);
  const rowOf = useMemo(() => new Map(left.map((it, i) => [it.id, i])), [left]);

  const [pairs, setPairs] = useState<Record<string, string>>({}); // word id -> clue id
  const [selWord, setSelWord] = useState<string | null>(null);
  const [selClue, setSelClue] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showLines, setShowLines] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 700);
  const [lines, setLines] = useState<Line[]>([]);
  const [tick, setTick] = useState(0);

  const gridRef = useRef<HTMLDivElement>(null);
  const wordEls = useRef(new Map<string, HTMLButtonElement>());
  const clueEls = useRef(new Map<string, HTMLButtonElement>());

  const ownerOf = useCallback(
    (clueId: string): string | undefined => Object.keys(pairs).find((w) => pairs[w] === clueId),
    [pairs],
  );

  const connect = (wordId: string, clueId: string) => {
    const next = { ...pairs };
    for (const k of Object.keys(next)) if (next[k] === clueId) delete next[k]; // clue was taken
    next[wordId] = clueId;
    setPairs(next);
    setSelWord(null);
    setSelClue(null);
  };

  const tapWord = (w: string) => {
    if (submitted) return;
    if (selClue) return connect(w, selClue);
    if (pairs[w]) {
      const next = { ...pairs };
      delete next[w]; // release and select again
      setPairs(next);
      setSelWord(w);
      return;
    }
    setSelWord(selWord === w ? null : w);
  };

  const tapClue = (c: string) => {
    if (submitted) return;
    if (selWord) return connect(selWord, c);
    const owner = ownerOf(c);
    if (owner) {
      const next = { ...pairs };
      delete next[owner];
      setPairs(next);
      setSelClue(c);
      return;
    }
    setSelClue(selClue === c ? null : c);
  };

  const pairedCount = Object.keys(pairs).length;
  const unpaired = items.length - pairedCount;
  const correct = items.filter((it) => pairs[it.id] === it.id).length;

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    setSelWord(null);
    setSelClue(null);
    const results: Record<string, Result> = {};
    for (const it of items) results[it.id] = pairs[it.id] === it.id ? 'k' : 'u';
    onSubmit(results);
  };

  // ---- connecting lines, measured from the real card positions
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const bump = () => setTick((n) => n + 1);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    ro?.observe(el);
    window.addEventListener('resize', bump);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, []);

  useLayoutEffect(() => {
    const out: Line[] = [];
    const mk = (w: string, c: string, cls: string, hue: number) => {
      const a = wordEls.current.get(w);
      const b = clueEls.current.get(c);
      if (!a || !b) return;
      out.push({
        key: `${w}>${c}>${cls}`,
        x1: a.offsetLeft + a.offsetWidth,
        y1: a.offsetTop + a.offsetHeight / 2,
        x2: b.offsetLeft,
        y2: b.offsetTop + b.offsetHeight / 2,
        cls,
        hue,
      });
    };
    for (const [w, c] of Object.entries(pairs)) {
      const row = rowOf.get(w) ?? 0;
      if (!submitted) mk(w, c, 'line', hueOf(row));
      else mk(w, c, w === c ? 'line ok' : 'line bad', hueOf(row));
    }
    if (submitted) for (const it of items) if (pairs[it.id] !== it.id) mk(it.id, it.id, 'line answer', 140);
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [pairs, submitted, rowOf, items, tick, showLines]);

  const register = (map: Map<string, HTMLButtonElement>, id: string) => (el: HTMLButtonElement | null) => {
    if (el) map.set(id, el);
    else map.delete(id);
  };

  return (
    <section aria-label="match game" className={['board', submitted && 'submitted', showLines ? 'with-lines' : 'no-lines'].filter(Boolean).join(' ')}>
      <div className="progressbar" role="status">
        <span>
          {pairedCount}/{items.length} {t.paired}
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
          {t.showLines}
        </label>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${(pairedCount / Math.max(1, items.length)) * 100}%` }} />
        </div>
      </div>
      <p className="hint">{submitted ? t.checkedHint : hint}</p>

      <div className="match-grid" ref={gridRef}>
        {showLines && (
          <svg className="lines" aria-hidden="true">
            {lines.map((l) => (
              <path
                key={l.key}
                className={l.cls}
                d={`M ${l.x1} ${l.y1} C ${l.x1 + (l.x2 - l.x1) * 0.6} ${l.y1}, ${l.x2 - (l.x2 - l.x1) * 0.6} ${l.y2}, ${l.x2} ${l.y2}`}
                fill="none"
                style={{ ['--h' as string]: l.hue }}
              />
            ))}
          </svg>
        )}
        <div className="col">
          <h3 className="col-title">{t.wordsLeft}</h3>
          {left.map((it, row) => {
            const paired = pairs[it.id] !== undefined;
            const state = submitted ? (pairs[it.id] === it.id ? 'ok' : 'bad') : '';
            const cls = ['card', 'card-word', it.word.length > 12 && 'long', paired && 'paired', selWord === it.id && 'selected', state]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={it.id}
                ref={register(wordEls.current, it.id)}
                type="button"
                className={cls}
                style={{ ['--h' as string]: hueOf(row) }}
                data-id={it.id}
                data-side="word"
                data-row={row + 1}
                aria-pressed={selWord === it.id}
                onClick={() => tapWord(it.id)}
              >
                <span className="num">{row + 1}</span>
                <span className="txt">{it.word}</span>
              </button>
            );
          })}
        </div>
        <div className="col">
          <h3 className="col-title">{rightLabel}</h3>
          {right.map((it) => {
            const owner = ownerOf(it.id);
            const ownerRow = owner !== undefined ? rowOf.get(owner) ?? 0 : 0;
            const state = submitted && owner !== undefined ? (owner === it.id ? 'ok' : 'bad') : '';
            const cls = ['card', 'card-clue', owner !== undefined && 'paired', selClue === it.id && 'selected', state]
              .filter(Boolean)
              .join(' ');
            const trueRow = (rowOf.get(it.id) ?? 0) + 1;
            return (
              <button
                key={it.id}
                ref={register(clueEls.current, it.id)}
                type="button"
                className={cls}
                style={{ ['--h' as string]: hueOf(ownerRow) }}
                data-id={it.id}
                data-side="clue"
                data-owner={owner ?? ''}
                aria-pressed={selClue === it.id}
                onClick={() => tapClue(it.id)}
              >
                {owner !== undefined && <span className="num">{ownerRow + 1}</span>}
                <span className="txt">{it.clue}</span>
                {submitted && owner !== it.id && (
                  <span className="answer" data-testid="answer">
                    {t.correctFor} {trueRow}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="submitbar">
        {!submitted ? (
          <>
            <span className="muted">{unpaired > 0 ? `${unpaired} ${t.unpairedLeft}` : t.allPaired}</span>
            <button type="button" className="btn primary" data-testid="submit" onClick={submit}>
              {unpaired > 0 ? `${t.submit} (${unpaired} ${t.unpaired})` : t.submit}
            </button>
          </>
        ) : (
          <>
            <span className="score-inline" data-testid="score-inline">
              {correct}/{items.length} {t.correct}
            </span>
            <button type="button" className="btn primary" data-testid="continue" onClick={onContinue}>
              {continueLabel}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
