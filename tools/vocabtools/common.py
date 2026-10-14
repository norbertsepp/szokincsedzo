"""Shared helpers: paths, downloads, thesaurus / frequency / name-list parsing."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Iterable

import requests

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "tools" / "cache"
DATA_DIR = ROOT / "web" / "public" / "data"

THESAURUS_URL = (
    "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/hu_HU/th_hu_HU_v2.dat"
)
HUNSPELL_DIC_URL = (
    "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/hu_HU/hu_HU.dic"
)
FREQ_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/hu/hu_full.txt"
)

# Wikimedia asks API clients to identify themselves with contact info.
CONTACT = os.environ.get("VOCAB_CONTACT", "https://github.com/OWNER/hu-vocab-trainer")
USER_AGENT = f"hu-vocab-trainer/1.1 (personal learning project; {CONTACT})"

# Plain lowercase Hungarian single word.
WORD_RE = re.compile(r"^[a-záéíóöőúüű]+$")
VOWELS = set("aeiouáéíóöőúüű")


def download(url: str, dest: Path, *, force: bool = False) -> Path:
    """Download `url` to `dest` (cached). Returns the path."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    print(f"  downloading {url}", file=sys.stderr)
    with requests.get(url, stream=True, timeout=120, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(dest)
    return dest


# ---------------------------------------------------------------- thesaurus

def parse_thesaurus(text: str) -> dict[str, list[str]]:
    """Parse a MyThes `.dat` file into {headword: [synonyms...]} (all senses merged).

    Format: first line is the encoding; then blocks of
        headword|N
        (pos)|syn|syn|...      <- N such lines
    """
    lines = text.split("\n")
    out: dict[str, list[str]] = {}
    i = 1  # line 0 = encoding name
    while i < len(lines):
        head = lines[i]
        i += 1
        if "|" not in head:
            continue
        word, _, count = head.rpartition("|")
        try:
            n = int(count)
        except ValueError:
            continue
        syns: list[str] = []
        for _ in range(n):
            if i >= len(lines):
                break
            parts = [p.strip() for p in lines[i].split("|")]
            i += 1
            syns.extend(p for p in parts if p and not p.startswith("("))
        bucket = out.setdefault(word.strip(), [])
        for s in syns:
            if s != word.strip() and s not in bucket:
                bucket.append(s)
    return out


def load_thesaurus(path: Path) -> dict[str, list[str]]:
    return parse_thesaurus(path.read_text(encoding="utf-8"))


def clean_synonym(s: str) -> str | None:
    """Keep plain words or short (<=2 word) phrases; drop anything with digits/brackets."""
    s = s.strip()
    if not s or not re.match(r"[a-záéíóöőúüű]", s) or re.search(r"[\d()\[\]{}/;:]", s):
        return None  # must start with a lowercase letter: capitalised = proper name, "-" etc. = noise
    if len(s.split()) > 2:
        return None
    return s


# ---------------------------------------------------------------- frequency

def stem_of(word: str) -> str:
    """Crude stem used to gather a word's inflected forms in the frequency list:
    -ik verbs lose 'ik', vowel-final words lose the vowel, others stay whole
    (suffixes simply follow the full form: erkölcsös -> erkölcsösen, erkölcsösség)."""
    if word.endswith("ik") and len(word) > 5:
        s = word[:-2]
    elif word[-1] in VOWELS:
        s = word[:-1]
    else:
        s = word
    return s if len(s) >= 4 else word


def family_frequency(path: Path, words: Iterable[str], *, max_suffix: int = 6) -> dict[str, int]:
    """How often a word *family* occurs in the corpus.

    Corpus frequency lists contain surface forms, so a lemma such as 'prédikálás'
    looks rare (13 hits) although its forms ('prédikálásról', 'prédikálások'...) are
    common (1 360 hits in total). For each word we therefore add up the counts of all
    forms that start with its stem and have at most `max_suffix` extra letters.
    A single streaming pass over the ~3M-line file; memory use stays small.
    """
    stems: dict[str, int] = {}
    for w in words:
        stems.setdefault(stem_of(w), 0)
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            form, _, c = line.rstrip("\n").partition(" ")
            try:
                count = int(c)
            except ValueError:
                continue
            n = len(form)
            for length in range(max(4, n - max_suffix), n + 1):
                s = form[:length]
                if s in stems:
                    stems[s] += count
    return {w: stems[stem_of(w)] for w in words}


# ---------------------------------------------------------------- name / lexicon lists

def parse_dic(dic_text: str) -> tuple[set[str], set[str]]:
    """(lowercase stems, lower-cased capitalised stems) from a hunspell .dic file."""
    low: set[str] = set()
    cap: set[str] = set()
    for line in dic_text.split("\n")[1:]:
        w = line.split("/", 1)[0].strip()
        if not w:
            continue
        (cap if w[0].isupper() else low).add(w.lower() if w[0].isupper() else w)
    return low, cap


def parse_proper_names(dic_text: str) -> set[str]:
    """Words the spell-checker lists only capitalised (first names, places...)."""
    low, cap = parse_dic(dic_text)
    return cap - low


def split_compound(word: str, lexicon: set[str]) -> tuple[str, str] | None:
    """A transparent noun compound (csúcs+eredmény): both halves (>=4 / >=3 letters)
    are ordinary dictionary words. Prefixed verbs (meg-, el-, fel-...) do not count."""
    n = len(word)
    for i in range(4, n - 2):
        a, b = word[:i], word[i:]
        if a in lexicon and b in lexicon:
            return a, b
    return None


# ---------------------------------------------------------------- candidates

Candidate = tuple[str, list[str], int]  # (word, synonyms, family frequency)


def rare_candidates(
    thesaurus: dict[str, list[str]],
    freq: dict[str, int],
    proper_names: set[str],
    *,
    min_freq: int,
    max_freq: int,
    min_synonyms: int,
    lexicon: set[str] | None = None,
    min_len: int = 4,
) -> list[Candidate]:
    """Thesaurus headwords that are 'rare but real', rarest first.

    A word qualifies when it is a plain lowercase single word, not a proper name,
    not a transparent compound (if a lexicon is given), has >= min_synonyms usable
    synonyms and its word-family frequency lies in [min_freq, max_freq].
    """
    out: list[Candidate] = []
    for word, raw in thesaurus.items():
        if len(word) < min_len or not WORD_RE.match(word) or word in proper_names:
            continue
        syns: list[str] = []
        for s in raw:
            c = clean_synonym(s)
            if c and c != word and c not in syns and c.replace(" ", "") not in proper_names:
                syns.append(c)
        if len(syns) < min_synonyms:
            continue
        f = freq.get(word, 0)
        if not (min_freq <= f <= max_freq):
            continue
        if lexicon is not None and split_compound(word, lexicon - {word}):
            continue
        out.append((word, syns, f))
    out.sort(key=lambda t: (t[2], t[0]))
    return out


def ensure_sources() -> dict[str, Path]:
    return {
        "thesaurus": download(THESAURUS_URL, CACHE_DIR / "th_hu_HU_v2.dat"),
        "dic": download(HUNSPELL_DIC_URL, CACHE_DIR / "hu_HU.dic"),
        "freq": download(FREQ_URL, CACHE_DIR / "hu_full.txt"),
    }


def add_band_args(ap) -> None:
    ap.add_argument("--min-freq", type=int, default=1,
                    help="skip words whose family occurs fewer times in the corpus (default 1: "
                         "0 = not seen at all, usually noise)")
    ap.add_argument("--max-freq", type=int, default=5000,
                    help="skip words more frequent than this (default 5000). The app can narrow "
                         "this further at play time (rarity levels)")
    ap.add_argument("--min-synonyms", type=int, default=3)
    ap.add_argument("--keep-compounds", action="store_true",
                    help="keep transparent compounds such as csúcseredmény (dropped by default)")


def load_candidates(args) -> list[Candidate]:
    paths = ensure_sources()
    thesaurus = load_thesaurus(paths["thesaurus"])
    dic_text = paths["dic"].read_text(encoding="utf-8", errors="replace")
    lexicon, _ = parse_dic(dic_text)
    names = parse_proper_names(dic_text)
    heads = [w for w in thesaurus if WORD_RE.match(w) and len(w) >= 4]
    freq = family_frequency(paths["freq"], heads)
    return rare_candidates(
        thesaurus, freq, names,
        min_freq=args.min_freq, max_freq=args.max_freq, min_synonyms=args.min_synonyms,
        lexicon=None if args.keep_compounds else lexicon,
    )
