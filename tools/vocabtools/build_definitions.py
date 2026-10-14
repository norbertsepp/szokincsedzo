"""Build web/public/data/definitions.json from Hungarian Wiktionary (CC BY-SA 4.0).

    python -m vocabtools.build_definitions [--target 2500]
    python -m vocabtools.build_definitions --words-file mywords.txt
    python -m vocabtools.build_definitions --dump-page cirkalmas     (debug a single page)

How candidates are chosen (this is what makes the yield high):
  1. Wiktionary's own list of existing pages (dump file, or the API as a fallback), so every
     candidate is known to have an entry - no guessing from the thesaurus.
  2. Keep plain lowercase words that are also in the Hungarian spell-checker lexicon or the
     thesaurus, are not proper names or transparent compounds, and whose word-family
     frequency lies in the "rare but real" band (see common.rare_candidates).
  3. Fetch wikitext in batches of 50 (one request per second), parse it; pages the wikitext
     parser cannot use are retried through the rendered HTML (a second, independent parser).

A statistics table with the reason for every rejection is printed, and samples of rejected
pages are written to tools/cache/reject_samples.json, so the parser can be tuned from facts.
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import random
import sys
import time
from collections import Counter
from datetime import date
from typing import Callable
from urllib.parse import quote

import requests

from . import common
from .htmlparse import parse_html_entry
from .wikitext import ParseResult, Rejection, parse_entry_ex

API = "https://hu.wiktionary.org/w/api.php"
TITLES_URL = "https://dumps.wikimedia.org/huwiktionary/latest/huwiktionary-latest-all-titles-in-ns0.gz"
BATCH = 50
SAMPLES_PER_REASON = 6
# reasons that point at the parser (not at an unusable page): worth a second try via HTML
PARSER_LIMITED = {Rejection.NO_LANGUAGE_SECTION, Rejection.NO_DEFINITION_LINES, Rejection.MARKUP_LEFT}

Fetcher = Callable[[list[str]], dict[str, str | None]]
HtmlFetcher = Callable[[str], str | None]


# ------------------------------------------------------------------ network

def _get(session: requests.Session, params: dict, *, retries: int = 5) -> dict:
    for attempt in range(retries):
        r = session.get(API, params=params, timeout=60, headers={"User-Agent": common.USER_AGENT})
        if r.status_code in (429, 503):
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            if data["error"].get("code") == "maxlag":
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"MediaWiki API error: {data['error']}")
        return data
    raise RuntimeError("Wiktionary API kept refusing; try again later")


def fetch_pages(titles: list[str], session: requests.Session | None = None) -> dict[str, str | None]:
    """Wikitext for up to 50 titles. Missing pages map to None."""
    data = _get(session or requests.Session(), {
        "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
        "format": "json", "formatversion": 2, "maxlag": 5, "titles": "|".join(titles),
    })
    out: dict[str, str | None] = {t: None for t in titles}
    for page in data.get("query", {}).get("pages", []):
        if page.get("missing"):
            continue
        try:
            out[page["title"]] = page["revisions"][0]["slots"]["main"]["content"]
        except (KeyError, IndexError):
            pass
    return out


def fetch_html(title: str, session: requests.Session | None = None) -> str | None:
    data = _get(session or requests.Session(), {
        "action": "parse", "page": title, "prop": "text", "format": "json", "formatversion": 2,
        "disableeditsection": 1, "disablelimitreport": 1, "maxlag": 5,
    })
    return (data.get("parse") or {}).get("text")


def fetch_titles(session: requests.Session | None = None, log=print) -> list[str]:
    """All main-namespace page titles of hu.wiktionary (cached)."""
    cache = common.CACHE_DIR / "hu_wiktionary_titles.txt"
    if cache.exists() and cache.stat().st_size > 0:
        return cache.read_text(encoding="utf-8").split("\n")
    s = session or requests.Session()
    titles: list[str] = []
    try:
        log("  downloading title list from the Wikimedia dump ...")
        r = s.get(TITLES_URL, timeout=300, headers={"User-Agent": common.USER_AGENT})
        r.raise_for_status()
        text = gzip.GzipFile(fileobj=io.BytesIO(r.content)).read().decode("utf-8")
        titles = [ln.replace("_", " ") for ln in text.split("\n")[1:] if ln]  # first line = header
    except Exception as e:  # noqa: BLE001 - fall back to the API whatever went wrong
        log(f"  dump not available ({e}); listing pages through the API instead (slower) ...")
        params = {"action": "query", "list": "allpages", "apnamespace": 0, "aplimit": 500,
                  "apfilterredir": "nonredirects", "format": "json", "formatversion": 2, "maxlag": 5}
        while True:
            data = _get(s, params)
            titles.extend(p["title"] for p in data["query"]["allpages"])
            nxt = data.get("continue", {}).get("apcontinue")
            if not nxt:
                break
            params["apcontinue"] = nxt
            time.sleep(0.3)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("\n".join(titles), encoding="utf-8")
    return titles


# ------------------------------------------------------------------ candidates

def candidates_from_titles(titles, thesaurus, lexicon, names, freq, args) -> list[common.Candidate]:
    out: list[common.Candidate] = []
    for w in titles:
        if not (4 <= len(w) <= 22) or not common.WORD_RE.match(w) or w in names:
            continue
        if not args.any_title and w not in thesaurus and w not in lexicon:
            continue
        f = freq.get(w, 0)
        if not (args.min_freq <= f <= args.max_freq):
            continue
        if not args.keep_compounds and common.split_compound(w, lexicon - {w}):
            continue
        syns = [c for c in (common.clean_synonym(x) for x in thesaurus.get(w, [])) if c and c != w][:6]
        out.append((w, syns, f))
    return out


# ------------------------------------------------------------------ build

class Stats:
    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self.samples: dict[str, list[dict]] = {}

    def reject(self, reason: str, title: str, text: str | None) -> None:
        self.counts[reason] += 1
        bucket = self.samples.setdefault(reason, [])
        if text and len(bucket) < SAMPLES_PER_REASON:
            bucket.append({"title": title, "excerpt": text[:700]})

    def report(self) -> str:
        total = sum(self.counts.values())
        lines = ["outcome                              pages     share"]
        for k, v in self.counts.most_common():
            lines.append(f"{k:<34}{v:>7}   {100 * v / max(1, total):5.1f}%")
        return "\n".join(lines)


def build_entries(candidates, fetch: Fetcher, *, target: int, max_pages: int, pause: float = 1.0,
                  fetch_html_page: HtmlFetcher | None = None, html_budget: int = 0,
                  log=print) -> tuple[list[dict], Stats]:
    """candidates: [(word, synonyms, freq)] in the order they should be tried."""
    entries: list[dict] = []
    stats = Stats()
    tried = 0
    html_used = 0
    for start in range(0, min(len(candidates), max_pages), BATCH):
        batch = candidates[start:start + BATCH]
        pages = fetch([w for w, _, _ in batch])
        for word, syns, freq in batch:
            tried += 1
            text = pages.get(word)
            if not text:
                stats.reject("page_missing", word, None)
                continue
            result: ParseResult = parse_entry_ex(word, text)
            how = "wikitext"
            if (result.entry is None and result.reason in PARSER_LIMITED
                    and fetch_html_page and html_used < html_budget):
                html_used += 1
                html = fetch_html_page(word)
                if html:
                    alt = parse_html_entry(word, html)
                    if alt.entry:
                        result, how = alt, "html"
                time.sleep(pause / 2)
            if result.entry is None:
                stats.reject(result.reason.value if result.reason else "unknown", word, text)
                continue
            stats.counts[f"accepted ({how})"] += 1
            e = result.entry
            entries.append({
                "id": f"d:{word}", "word": word, "pos": e.pos, "definition": e.definition,
                "examples": e.examples, "labels": e.labels, "synonyms": syns, "freq": freq,
                "source": "hu.wiktionary", "url": f"https://hu.wiktionary.org/wiki/{quote(word)}",
            })
        log(f"  tried {tried}, kept {len(entries)}")
        if len(entries) >= target:
            break
        time.sleep(pause)
    entries.sort(key=lambda e: (e["freq"], e["word"]))
    return entries[:target], stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common.add_band_args(ap)
    ap.add_argument("--target", type=int, default=2500, help="stop after this many usable entries")
    ap.add_argument("--max-pages", type=int, default=40_000, help="max Wiktionary pages to look up")
    ap.add_argument("--html-budget", type=int, default=800,
                    help="max pages to retry through the rendered-HTML parser (default 800)")
    ap.add_argument("--any-title", action="store_true",
                    help="also use Wiktionary titles that are in neither the lexicon nor the thesaurus")
    ap.add_argument("--words-file", help="text file with one word per line instead of the rarity band")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--min-entries", type=int, default=100,
                    help="exit with an error (and write nothing) if fewer usable entries are found")
    ap.add_argument("--dump-page", metavar="WORD", help="print wikitext + both parse results for one word")
    ap.add_argument("--out", default=str(common.DATA_DIR / "definitions.json"))
    args = ap.parse_args()

    if args.dump_page:
        w = args.dump_page
        text = fetch_pages([w]).get(w)
        print(text or "(page not found)")
        print("---- wikitext parse ----")
        print(parse_entry_ex(w, text or ""))
        html = fetch_html(w)
        print("---- html parse ----")
        print(parse_html_entry(w, html) if html else "(no html)")
        return

    if args.words_file:
        with open(args.words_file, encoding="utf-8") as f:
            words = [w.strip() for w in f if w.strip() and not w.startswith("#")]
        candidates = [(w, [], 0) for w in words]
    else:
        paths = common.ensure_sources()
        thesaurus = common.load_thesaurus(paths["thesaurus"])
        lexicon, _ = common.parse_dic(paths["dic"].read_text(encoding="utf-8", errors="replace"))
        names = common.parse_proper_names(paths["dic"].read_text(encoding="utf-8", errors="replace"))
        titles = [t for t in fetch_titles() if common.WORD_RE.match(t) and len(t) >= 4]
        print(f"{len(titles)} plain lowercase Wiktionary titles", file=sys.stderr)
        freq = common.family_frequency(paths["freq"], titles)
        candidates = candidates_from_titles(titles, thesaurus, lexicon, names, freq, args)
        random.Random(args.seed).shuffle(candidates)  # sample across the whole band
    print(f"{len(candidates)} candidate words", file=sys.stderr)

    entries, stats = build_entries(
        candidates, fetch_pages, target=args.target, max_pages=args.max_pages,
        fetch_html_page=fetch_html, html_budget=args.html_budget,
    )
    print("\n" + stats.report(), flush=True)
    samples_path = common.CACHE_DIR / "reject_samples.json"
    samples_path.parent.mkdir(parents=True, exist_ok=True)
    samples_path.write_text(json.dumps(stats.samples, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nrejected-page samples saved to {samples_path}")

    if len(entries) < args.min_entries:
        raise SystemExit(
            f"only {len(entries)} usable entries (< {args.min_entries}); nothing written. "
            "See the statistics above and reject_samples.json."
        )
    doc = {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": "Hungarian Wiktionary (hu.wiktionary.org), CC BY-SA 4.0",
        "entries": entries,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(entries)} definition entries to {args.out}")


if __name__ == "__main__":
    main()
