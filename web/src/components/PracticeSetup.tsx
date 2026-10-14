import { useState } from 'react';
import type { PracticeConfig, PracticeMode, Rarity } from '../types';
import type { Strings } from '../i18n';

interface Props {
  t: Strings;
  initial: PracticeConfig;
  /** how many words each bank offers per rarity level */
  counts: Record<'definitions' | 'synonyms', Record<Rarity, number>>;
  onStart: (c: PracticeConfig) => void;
  onHome: () => void;
}

export function PracticeSetup({ t, initial, counts, onStart, onHome }: Props) {
  const [c, setC] = useState<PracticeConfig>(initial);
  const set = <K extends keyof PracticeConfig>(k: K, v: PracticeConfig[K]) => setC((cur) => ({ ...cur, [k]: v }));
  const avail = counts[c.kind];

  const modes: [PracticeMode, string, string][] = [
    ['mix', t.modeMix, t.modeMixHelp],
    ['new', t.modeNew, t.modeNewHelp],
    ['unknown', t.modeUnknown, t.modeUnknownHelp],
  ];
  const levels: [Rarity, string, string][] = [
    ['veryrare', t.rarityVeryRare, t.rarityVeryRareHelp],
    ['rare', t.rarityRare, t.rarityRareHelp],
    ['all', t.rarityAll, t.rarityAllHelp],
  ];

  return (
    <div className="practice">
      <header className="session-head">
        <button type="button" className="link" onClick={onHome}>
          ← {t.backHome}
        </button>
        <h2>{t.practiceTitle}</h2>
      </header>
      <p className="muted">{t.practiceHelp}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStart(c);
        }}
      >
        <fieldset>
          <legend>{t.practiceKind}</legend>
          <div className="choice-row">
            {(['definitions', 'synonyms'] as const).map((k) => (
              <label key={k} className={c.kind === k ? 'choice active' : 'choice'}>
                <input type="radio" name="kind" checked={c.kind === k} onChange={() => set('kind', k)} />
                <span>{k === 'definitions' ? t.definitionsTitle : t.synonymsTitle}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>
            {t.practiceSize}: <strong data-testid="practice-size-value">{c.size}</strong>
          </span>
          <input
            type="range"
            min={12}
            max={30}
            value={c.size}
            data-testid="practice-size"
            onChange={(e) => set('size', Number(e.target.value))}
          />
        </label>

        <fieldset>
          <legend>{t.practiceFocus}</legend>
          {modes.map(([m, label, help]) => (
            <label key={m} className={c.mode === m ? 'choice block active' : 'choice block'}>
              <input type="radio" name="mode" checked={c.mode === m} onChange={() => set('mode', m)} />
              <span>
                <strong>{label}</strong>
                <small>{help}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>{t.rarity}</legend>
          {levels.map(([l, label, help]) => (
            <label key={l} className={c.rarity === l ? 'choice block active' : 'choice block'}>
              <input type="radio" name="rarity" checked={c.rarity === l} onChange={() => set('rarity', l)} />
              <span>
                <strong>
                  {label} <span className="count">({avail[l]})</span>
                </strong>
                <small>{help}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label className={c.count ? 'switch on' : 'switch'}>
          <input
            type="checkbox"
            checked={c.count}
            data-testid="practice-count"
            onChange={(e) => set('count', e.target.checked)}
          />
          <span className="track" aria-hidden="true" />
          <span>
            <strong>{c.count ? t.countOn : t.countOff}</strong>
            <small>{t.countHelp}</small>
          </span>
        </label>

        <div className="actions">
          <button type="submit" className="btn primary big" data-testid="practice-start">
            {t.startPractice}
          </button>
        </div>
      </form>
    </div>
  );
}
