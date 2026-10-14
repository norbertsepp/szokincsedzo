"""Build web/public/data/synonyms.json from the Hungarian LibreOffice thesaurus.

    python -m vocabtools.build_synonyms            (run from the tools/ directory)

Source: Magyar Szinonimaszótár (László Németh, GPL v2) as shipped in LibreOffice's
hu_HU dictionary; frequency list from hermitdave/FrequencyWords (used only to
decide which words are rare; each entry stores `freq`, the corpus count of the word's
family, which the app uses for its rarity levels).
"""
from __future__ import annotations

import argparse
import json
from datetime import date

from . import common

MAX_SYNONYMS = 8


def build(candidates, max_entries: int | None) -> dict:
    entries = []
    for word, syns, freq in candidates:  # rarest first
        entries.append({
            "id": f"s:{word}",
            "word": word,
            "synonyms": syns[:MAX_SYNONYMS],
            "freq": freq,
        })
    if max_entries:
        entries = entries[:max_entries]
    return {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": "Magyar Szinonimaszótár (Németh László, GPL v2; LibreOffice hu_HU)",
        "entries": entries,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    common.add_band_args(ap)
    ap.add_argument("--max-entries", type=int, default=12000)
    ap.add_argument("--out", default=str(common.DATA_DIR / "synonyms.json"))
    args = ap.parse_args()

    candidates = common.load_candidates(args)
    doc = build(candidates, args.max_entries)
    if len(doc["entries"]) < 50:
        raise SystemExit(f"only {len(doc['entries'])} entries - refusing to write; check the band settings")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(doc['entries'])} synonym entries to {args.out}")


if __name__ == "__main__":
    main()
