import type { DefinitionEntry, GameItem, Kind, Result, SynonymEntry } from '../types';
import type { Strings } from '../i18n';

interface Props {
  kind: Kind;
  items: GameItem[];
  results: Record<string, Result>;
  t: Strings;
}

/** After a round: the words that were not matched on the first try, with explanations. */
export function ReviewPanel({ kind, items, results, t }: Props) {
  const total = items.length;
  const known = items.filter((i) => results[i.id] === 'k');
  const unknown = items.filter((i) => results[i.id] === 'u');

  return (
    <section className="review" aria-label="review">
      <div className="score">
        <span className="score-num">
          {known.length}/{total}
        </span>
        <span className="score-label">{t.score}</span>
      </div>

      {unknown.length === 0 ? (
        <p className="ok-note">{t.nothingUnknown}</p>
      ) : (
        <>
          <h3>{t.unknownWords}</h3>
          <ul className="explain-list">
            {unknown.map((it) => (
              <li key={it.id} className="explain unknown" data-id={it.id}>
                <h4>
                  {it.word}
                  {kind === 'definitions' && (it.entry as DefinitionEntry).pos && (
                    <span className="pos">{(it.entry as DefinitionEntry).pos}</span>
                  )}
                </h4>
                {kind === 'definitions' ? <DefinitionBody e={it.entry as DefinitionEntry} t={t} /> : <SynonymBody e={it.entry as SynonymEntry} t={t} />}
              </li>
            ))}
          </ul>
        </>
      )}

      {known.length > 0 && (
        <details className="known-details">
          <summary>
            {t.knownWords} ({known.length})
          </summary>
          <ul className="known-list">
            {known.map((it) => (
              <li key={it.id}>
                <strong>{it.word}</strong> — {it.clue}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DefinitionBody({ e, t }: { e: DefinitionEntry; t: Strings }) {
  return (
    <>
      <p className="def">{e.definition}</p>
      {e.labels.length > 0 && <p className="labels">{e.labels.join(' · ')}</p>}
      {e.examples.length > 0 && (
        <>
          <p className="sub">{t.examples}</p>
          <ul className="examples">
            {e.examples.map((x, i) => (
              <li key={i}>„{x}”</li>
            ))}
          </ul>
        </>
      )}
      {e.synonyms.length > 0 && (
        <p className="syns">
          <span className="sub">{t.synonymsLabel}: </span>
          {e.synonyms.join(', ')}
        </p>
      )}
      {e.url && (
        <p className="src">
          <a href={e.url} target="_blank" rel="noreferrer noopener">
            {t.source}: Wikiszótár
          </a>
        </p>
      )}
    </>
  );
}

function SynonymBody({ e, t }: { e: SynonymEntry; t: Strings }) {
  return (
    <p className="syns">
      <span className="sub">{t.synonymsLabel}: </span>
      {e.synonyms.join(', ')}
    </p>
  );
}
