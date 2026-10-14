"""Fallback: read definitions from the *rendered* page (action=parse, prop=text).

Used for pages whose wikitext the wikitext parser could not use (for example when
definitions are produced by templates). The rendered HTML has no templates left, so
`<ol><li>` items are the definitions and nested `<dl>/<ul>` items are examples.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from .wikitext import POS_HEADINGS, Rejection, ParsedEntry, ParseResult, check_definition


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[dict] = []  # {'title': str, 'pos': str, 'items': [(def, [examples])]}
        self._h_tag: str | None = None
        self._h_text: list[str] = []
        self._ol_depth = 0
        self._li_stack: list[dict] = []
        self._skip = 0  # inside <sup>, <style>, <script>, edit sections

    # -- helpers
    def _flush_example(self) -> None:
        top = self._li_stack[-1]
        text = re.sub(r"\s+", " ", "".join(top["ex_buf"])).strip()
        top["ex_buf"] = []
        if text:
            top["examples"].append(text)

    def _current(self) -> dict | None:
        return self.sections[-1] if self.sections else None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "script", "sup") or "mw-editsection" in (a.get("class") or ""):
            self._skip += 1
            return
        if tag in ("h2", "h3", "h4", "h5"):
            self._h_tag, self._h_text = tag, []
        elif tag == "ol":
            self._ol_depth += 1
        elif tag == "li" and self._ol_depth >= 1:
            depth = len(self._li_stack)
            self._li_stack.append({"text": [], "examples": [], "ex_buf": [], "depth": depth, "nested": 0})
        elif tag in ("dl", "ul") and self._li_stack:
            self._li_stack[-1]["nested"] += 1

    def handle_endtag(self, tag):
        if tag in ("style", "script", "sup") and self._skip:
            self._skip -= 1
            return
        if tag == self._h_tag and self._h_tag:
            title = re.sub(r"\s+", " ", "".join(self._h_text)).strip()
            title = re.sub(r"\[.*?\]", "", title).strip()
            if tag == "h2":
                self.sections.append({"title": title, "pos": "", "items": []})
            elif self._current() is not None:
                self._current()["pos"] = POS_HEADINGS.get(title.lower(), self._current()["pos"])
            self._h_tag = None
        elif tag in ("dd", "dt") and self._li_stack:
            self._flush_example()
        elif tag in ("dl", "ul") and self._li_stack and self._li_stack[-1]["nested"]:
            self._flush_example()
            self._li_stack[-1]["nested"] -= 1
        elif tag == "li" and self._li_stack:
            li = self._li_stack.pop()
            text = re.sub(r"\s+", " ", "".join(li["text"])).strip()
            sec = self._current()
            if sec is None:
                return
            if li["depth"] == 0:
                if text:
                    sec["items"].append((text, li["examples"]))
            elif self._li_stack and text:  # nested <li> in a list inside a definition = example
                self._li_stack[-1]["examples"].append(text)
        elif tag == "ol" and self._ol_depth:
            self._ol_depth -= 1

    def handle_data(self, data):
        if self._skip:
            return
        if self._h_tag:
            self._h_text.append(data)
        elif self._li_stack:
            top = self._li_stack[-1]
            if top["nested"] == 0:
                top["text"].append(data)
            else:  # text inside nested <dl>/<ul> of this item: an example
                top["ex_buf"].append(data)


def parse_html_entry(word: str, html: str) -> ParseResult:
    c = _Collector()
    c.feed(html)
    secs = c.sections
    hu = [s for s in secs if re.search(r"magyar|^hu$", s["title"], re.I)]
    if not hu and len(secs) == 1:
        hu = secs
    if not hu:
        return ParseResult(None, Rejection.NO_LANGUAGE_SECTION)
    first: Rejection | None = None
    saw = False
    for sec in hu:
        for text, examples in sec["items"]:
            saw = True
            d, reason = check_definition(word, text)
            if reason is None:
                exs = []
                for e in examples:
                    e = re.sub(r"\s+", " ", e).strip()
                    if 8 <= len(e) <= 220 and e not in exs:
                        exs.append(e)
                return ParseResult(ParsedEntry(word, sec["pos"], d, exs[:3], []))
            first = first or reason
    return ParseResult(None, first if saw else Rejection.NO_DEFINITION_LINES)
