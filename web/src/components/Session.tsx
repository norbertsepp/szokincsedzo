import { useCallback, useState } from 'react';
import type { GameItem, Kind, Result } from '../types';
import type { Strings } from '../i18n';
import { MatchGame } from './MatchGame';
import { ReviewPanel } from './ReviewPanel';

interface Props {
  kind: Kind;
  items: GameItem[];
  t: Strings;
  /** called once, when the user submits the board, with the first-try results */
  onComplete: (results: Record<string, Result>) => void;
  /** label + action of the button that leaves the review (next session or back home) */
  nextLabel: string;
  onNext: () => void;
  onHome: () => void;
  /** open an already-completed session straight in the review */
  initialResults?: Record<string, Result>;
  /** heading override (practice sessions) */
  title?: string;
  /** note shown above the review, e.g. whether a practice round counted */
  note?: string;
  /** optional extra button in the review (e.g. "new practice") */
  extra?: { label: string; onClick: () => void };
}

type Phase = 'play' | 'review' | 'drill';

export function Session({ kind, items, t, onComplete, nextLabel, onNext, onHome, initialResults, title, note, extra }: Props) {
  const [phase, setPhase] = useState<Phase>(initialResults ? 'review' : 'play');
  const [results, setResults] = useState<Record<string, Result>>(initialResults ?? {});
  const [drillRound, setDrillRound] = useState(0);

  const submit = useCallback(
    (r: Record<string, Result>) => {
      setResults(r);
      onComplete(r);
    },
    [onComplete],
  );
  const toReview = useCallback(() => setPhase('review'), []);
  const noop = useCallback(() => undefined, []);

  const unknownItems = items.filter((i) => results[i.id] === 'u');
  const heading = title ?? (kind === 'definitions' ? t.definitionsTitle : t.synonymsTitle);
  const rightLabel = kind === 'definitions' ? t.clueLeft : t.clueSyn;
  const help = kind === 'definitions' ? t.definitionsHelp : t.synonymsHelp;

  return (
    <div className="session">
      <header className="session-head">
        <button type="button" className="link" onClick={onHome}>
          ← {t.backHome}
        </button>
        <h2>{heading}</h2>
      </header>

      {phase === 'play' && (
        <MatchGame
          items={items}
          rightLabel={rightLabel}
          hint={`${help} ${t.tapHint}`}
          t={t}
          onSubmit={submit}
          onContinue={toReview}
          continueLabel={t.toReview}
        />
      )}

      {phase === 'drill' && (
        <MatchGame
          key={drillRound}
          items={unknownItems}
          rightLabel={rightLabel}
          hint={`${t.tryAgain}. ${t.tapHint}`}
          t={t}
          onSubmit={noop}
          onContinue={toReview}
          continueLabel={t.toReview}
        />
      )}

      {phase === 'review' && (
        <>
          {note && <p className="notice">{note}</p>}
          <ReviewPanel kind={kind} items={items} results={results} t={t} />
          <div className="actions">
            {unknownItems.length > 1 && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setDrillRound((n) => n + 1);
                  setPhase('drill');
                }}
              >
                {t.tryAgain}
              </button>
            )}
            {extra && (
              <button type="button" className="btn secondary" onClick={extra.onClick}>
                {extra.label}
              </button>
            )}
            <button type="button" className="btn primary" onClick={onNext}>
              {nextLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
