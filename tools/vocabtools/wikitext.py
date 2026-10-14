"""Tolerant parser for Hungarian Wiktionary (hu.wiktionary.org) wikitext.

Nothing here can assume the exact page layout, so the parser accepts several
conventions and reports *why* a page was rejected (see `Rejection`). That reason
is what `build_definitions` prints in its statistics, which makes it possible to
tune the parser from a real run instead of guessing.

Accepted conventions (all of them are common on Wiktionaries):
  * language sections:  == szó ({{hu}}) ==, == magyar ==, =={{hu}}==, {{-hu-}}, {{nyelv|hu}}
  * part-of-speech sub-headings at any depth (=== Főnév ===, ==== melléknév ====, {{fnév}} ...)
  * definitions:  "# text" lines (numbered list), or "* text" lines under a "jelentés" heading
  * examples:     "#: text", "#* text", "{{példa|text}}", "{{idézet|text}}"
  * templates inside definitions: labels ({{ritka}}) are collected, link-like templates keep
    their text, and an unknown template that wraps a sentence keeps that sentence.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

LABEL_TEMPLATES = {
    "ritka", "régies", "választékos", "irodalmi", "szépirodalmi", "költői", "népies",
    "nyelvjárási", "bizalmas", "durva", "tájszó", "elavult", "archaikus", "ritkán",
    "átvitt", "átv", "szleng", "vulgáris", "gúnyos", "tréfás", "pejoratív", "hivatalos",
    "régi", "régiesen", "szaknyelvi", "ünnepélyes", "kissé", "közhasználatú", "idegen",
}
TEXT_TEMPLATES = {"l", "link", "hivatkozás", "m", "mention", "w", "wikipedia", "ts", "pl", "példa", "idézet"}

POS_HEADINGS = {
    "főnév": "főnév", "melléknév": "melléknév", "ige": "ige", "határozószó": "határozószó",
    "névmás": "névmás", "számnév": "számnév", "kötőszó": "kötőszó", "névutó": "névutó",
    "igekötő": "igekötő", "indulatszó": "indulatszó", "módosítószó": "módosítószó",
    "mondatszó": "mondatszó", "kifejezés": "kifejezés", "mondás": "mondás",
    "közmondás": "közmondás", "szólás": "szólás", "fnév": "főnév", "mnév": "melléknév",
    "hsz": "határozószó", "fn": "főnév", "mn": "melléknév",
}
POS_TEMPLATE_RE = re.compile(r"\{\{\s*(főnév|melléknév|ige|határozószó|névmás|számnév|kötőszó|névutó|igekötő|indulatszó|fnév|mnév|hsz)\b", re.I)

# Definitions that merely describe an inflected / derived form are useless for the game.
FORM_OF_RE = re.compile(
    r"(alakja|ragozott|többes száma|származéka|kicsinyítő|képzős|birtokos|felszólító módja|"
    r"múlt ideje|igenév|\bl\.\s|\blásd\b|v\.\s?ö\.|elírása|változata|rövidítése)",
    re.IGNORECASE,
)

HEADING_RE = re.compile(r"^(={1,6})\s*(.+?)\s*\1\s*$")
# {{hu}}, {{nyelv|hu}}, {{-hu-}}, {{hu-...}} or a heading that is literally "magyar" / "... (magyar)"
LANG_MARK_RE = re.compile(
    r"\{\{\s*(?:nyelv\s*\|\s*)?-?hu-?\s*(?:[|}])|\{\{\s*-hu-\s*\}\}|^\s*magyar\s*$|\(\s*magyar\s*\)",
    re.IGNORECASE,
)
ANY_LANG_MARK_RE = re.compile(r"\{\{\s*(?:nyelv\s*\|\s*)?-?[a-z]{2,3}-?\s*(?:[|}])|\{\{\s*-[a-z]{2,3}-\s*\}\}", re.IGNORECASE)


class Rejection(str, Enum):
    REDIRECT = "redirect"
    NO_LANGUAGE_SECTION = "no_hungarian_section"
    NO_DEFINITION_LINES = "no_definition_lines"
    TOO_SHORT = "definition_too_short"
    FORM_OF = "inflected_form_definition"
    LEAKS_WORD = "definition_contains_the_word"
    MARKUP_LEFT = "template_markup_left_over"


@dataclass
class ParsedEntry:
    word: str
    pos: str
    definition: str
    examples: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)


@dataclass
class ParseResult:
    entry: ParsedEntry | None
    reason: Rejection | None = None


# ------------------------------------------------------------------ markup

def _template(match: re.Match, labels: list[str]) -> str:
    parts = [p.strip() for p in match.group(1).split("|")]
    name = parts[0].lower().strip("-")
    if name in LABEL_TEMPLATES:
        labels.append(name)
        return ""
    positional = [p for p in parts[1:] if p and "=" not in p[:20]]
    if name in TEXT_TEMPLATES:
        return positional[-1] if positional else ""
    # unknown template: keep an argument that looks like a sentence/definition
    for p in positional:
        if len(p) >= 12 and " " in p:
            return p
    return ""


def strip_markup(text: str, labels: list[str] | None = None) -> str:
    labels = labels if labels is not None else []
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*?/>|<ref[^>]*?>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"</?[a-zA-Z][^>]*>", "", text)
    for _ in range(10):  # innermost-first template removal
        new = re.sub(r"\{\{([^{}]*)\}\}", lambda m: _template(m, labels), text)
        if new == text:
            break
        text = new
    text = re.sub(r"\[\[(?:Kategória|Category|Fájl|File|Kép|Image):[^\]]*\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[(?:https?://\S+)\s+([^\]]*)\]", r"\1", text)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"\s+", " ", text).strip(" \t:;*#")
    text = re.sub(r"\(\s*\)", "", text)  # parentheses emptied by label removal
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


# ------------------------------------------------------------------ structure

def hungarian_section(wikitext: str) -> str | None:
    """Text of the Hungarian language section (None if the page has none)."""
    lines = wikitext.split("\n")
    marks: list[tuple[int, bool]] = []  # (line index, is_hungarian) of language-section starts
    for i, ln in enumerate(lines):
        h = HEADING_RE.match(ln)
        if h and len(h.group(1)) <= 2:
            marks.append((i, bool(LANG_MARK_RE.search(h.group(2)))))
        elif re.match(r"^\s*\{\{\s*-[a-z]{2,3}-\s*\}\}\s*$", ln):  # old-style {{-hu-}} line
            marks.append((i, bool(re.match(r"^\s*\{\{\s*-hu-\s*\}\}", ln))))
    for idx, (i, is_hu) in enumerate(marks):
        if is_hu:
            end = marks[idx + 1][0] if idx + 1 < len(marks) else len(lines)
            return "\n".join(lines[i + 1:end])
    if not marks and not ANY_LANG_MARK_RE.search(wikitext):
        return wikitext  # page without language markers: assume it is Hungarian
    return None


def check_definition(word: str, definition: str) -> tuple[str, Rejection | None]:
    """Returns (possibly cleaned definition, rejection reason or None).

    Words that appear inside their own definition are masked ("…") instead of rejecting the
    whole entry, unless that would leave the definition meaningless."""
    d = definition.strip()
    if "{{" in d or "}}" in d or "[[" in d:
        return d, Rejection.MARKUP_LEFT
    if FORM_OF_RE.search(d):
        return d, Rejection.FORM_OF
    stem = word[: max(4, len(word) - 2)]
    pattern = re.compile(rf"\b{re.escape(stem)}\w*", re.IGNORECASE)
    hits = pattern.findall(d)
    if hits:
        d = pattern.sub("…", d)
        if len(hits) > 1 or len(re.sub(r"[…\s,;.()]", "", d)) < 6:
            return d, Rejection.LEAKS_WORD
    if len(d) < 8:
        return d, Rejection.TOO_SHORT
    return d, None


def is_good_definition(word: str, definition: str) -> bool:
    return check_definition(word, definition)[1] is None


def parse_entry_ex(word: str, wikitext: str) -> ParseResult:
    if re.match(r"\s*#\s*(redirect|átirányítás)", wikitext, re.I):
        return ParseResult(None, Rejection.REDIRECT)
    section = hungarian_section(wikitext)
    if not section:
        return ParseResult(None, Rejection.NO_LANGUAGE_SECTION)

    current_pos = ""
    in_meaning_heading = False
    found: ParsedEntry | None = None
    first_rejection: Rejection | None = None
    saw_definition_line = False

    for line in section.split("\n"):
        h = HEADING_RE.match(line)
        if h:
            if found:
                break  # only the first part of speech that yields a usable definition
            name = strip_markup(h.group(2)).lower()
            current_pos = POS_HEADINGS.get(name, current_pos)
            in_meaning_heading = "jelentés" in name
            continue
        pm = POS_TEMPLATE_RE.match(line.strip())
        if pm and not found:
            current_pos = POS_HEADINGS.get(pm.group(1).lower(), current_pos)

        if re.match(r"^#[:*]", line):  # example lines
            if found is not None and len(found.examples) < 3:
                ex = strip_markup(line)
                if 8 <= len(ex) <= 220 and "{{" not in ex:
                    found.examples.append(ex)
            continue
        if found is not None:
            m_ex = re.match(r"^\s*\{\{\s*(?:példa|idézet)\s*\|", line, re.I)
            if m_ex and len(found.examples) < 3:
                ex = strip_markup(line)
                if 8 <= len(ex) <= 220:
                    found.examples.append(ex)
            continue

        m = re.match(r"^#(?![:*#])\s*(.+)$", line)
        if not m and in_meaning_heading:
            m = re.match(r"^[*]\s*(.+)$", line)
        if not m:
            continue
        saw_definition_line = True
        labels: list[str] = []
        d, reason = check_definition(word, strip_markup(m.group(1), labels))
        if reason is None:
            found = ParsedEntry(word=word, pos=current_pos, definition=d, labels=sorted(set(labels)))
        elif first_rejection is None:
            first_rejection = reason

    if found:
        return ParseResult(found)
    return ParseResult(None, first_rejection if saw_definition_line else Rejection.NO_DEFINITION_LINES)


def parse_entry(word: str, wikitext: str) -> ParsedEntry | None:
    return parse_entry_ex(word, wikitext).entry
