import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vocabtools import common  # noqa: E402
from vocabtools.build_definitions import build_entries, candidates_from_titles  # noqa: E402
from vocabtools.htmlparse import parse_html_entry  # noqa: E402
from vocabtools.wikitext import (  # noqa: E402
    Rejection, check_definition, parse_entry, parse_entry_ex, strip_markup,
)

THESAURUS = """UTF-8
parány|1
|testecske|korpuszkula|részecske|
cirill|1
|Erika|Alex|Donald|
befőz|2
(ige)|eltesz|tartósít
(ige)|bekebelez|elfoglal|megszerez
tündöklik|1
|ragyog|fénylik|csillog|
"""

WIKITEXT_OK = """{{egyért}}
== cirkalmas ({{hu}}) ==
=== Melléknév ===
{{hu-melléknév}}
# {{választékos}} Túlságosan [[díszes]], '''cikornyás''' stílusú.
#: ''Cirkalmas mondatokban beszélt.''
# Második jelentés, amely nem kell.
== cirkalmas ({{en}}) ==
# english definition here that must not be used
"""


class FrequencyTests(unittest.TestCase):
    def test_stems(self):
        self.assertEqual(common.stem_of("tüsténkedik"), "tüsténked")
        self.assertEqual(common.stem_of("cirkalmas"), "cirkalmas")  # consonant-final: whole word
        self.assertEqual(common.stem_of("alma"), "alma")  # a stem under 4 letters is not used

    def test_family_frequency_adds_inflected_forms(self):
        corpus = "prédikálás 13\nprédikálásról 700\nprédikálások 647\nprédikál 90\nzzz 5\n"
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "f.txt"
            p.write_text(corpus, encoding="utf-8")
            f = common.family_frequency(p, ["prédikálás", "hánytorgat"])
        self.assertEqual(f["prédikálás"], 13 + 700 + 647)  # 'prédikál' is not an extension of the stem
        self.assertEqual(f["hánytorgat"], 0)

    def test_compound_detection(self):
        lex = {"csúcs", "eredmény", "cafatos", "meg", "szelídül"}
        self.assertEqual(common.split_compound("csúcseredmény", lex), ("csúcs", "eredmény"))
        self.assertIsNone(common.split_compound("cafatos", lex))
        self.assertIsNone(common.split_compound("megszelídül", lex))  # prefix 'meg' is too short


class ThesaurusTests(unittest.TestCase):
    def test_parse_merges_senses_and_skips_pos(self):
        t = common.parse_thesaurus(THESAURUS)
        self.assertEqual(t["parány"], ["testecske", "korpuszkula", "részecske"])
        self.assertEqual(t["befőz"], ["eltesz", "tartósít", "bekebelez", "elfoglal", "megszerez"])

    def test_candidates_filter_names_band_and_compounds(self):
        t = common.parse_thesaurus(THESAURUS)
        freq = {"parány": 40, "tündöklik": 90_000, "befőz": 500, "cirill": 100}
        got = common.rare_candidates(t, freq, set(), min_freq=1, max_freq=5000, min_synonyms=3)
        # cirill: only capitalised (name) synonyms; tündöklik too frequent; rarest first
        self.assertEqual([w for w, _, _ in got], ["parány", "befőz"])
        t["csúcseredmény"] = ["rekord", "legjobb", "maximum"]
        freq["csúcseredmény"] = 30
        lex = {"csúcs", "eredmény"}
        kept = common.rare_candidates(t, freq, set(), min_freq=1, max_freq=5000, min_synonyms=3)
        dropped = common.rare_candidates(t, freq, set(), min_freq=1, max_freq=5000, min_synonyms=3, lexicon=lex)
        self.assertIn("csúcseredmény", [w for w, _, _ in kept])
        self.assertNotIn("csúcseredmény", [w for w, _, _ in dropped])  # transparent compound
        self.assertIn("parány", [w for w, _, _ in dropped])  # not a compound

    def test_noise_synonyms_are_dropped(self):
        for bad in ["-", "Erika", "(átv)", "12", "a/b", "három szavas kifejezés"]:
            self.assertIsNone(common.clean_synonym(bad), bad)
        self.assertEqual(common.clean_synonym(" kiskötőjel "), "kiskötőjel")

    def test_unseen_words_excluded_by_default(self):
        t = common.parse_thesaurus(THESAURUS)
        got = common.rare_candidates(t, {}, set(), min_freq=1, max_freq=5000, min_synonyms=3)
        self.assertEqual(got, [])

    def test_proper_names_from_dic(self):
        dic = "3\nMária/1\nmária/2\nOszkár/3\nparány/4\n"
        self.assertEqual(common.parse_proper_names(dic), {"oszkár"})


class WikitextTests(unittest.TestCase):
    def test_strip_markup(self):
        labels = []
        s = strip_markup("{{ritka}} [[díszes|díszített]] '''szó''' [[Kategória:x]]", labels)
        self.assertEqual(s, "díszített szó")
        self.assertEqual(labels, ["ritka"])

    def test_unknown_template_wrapping_a_definition_is_kept(self):
        self.assertEqual(strip_markup("{{ért|valamilyen régi, ritka szó|hu}}"), "valamilyen régi, ritka szó")
        self.assertEqual(strip_markup("{{ismeretlen}} szöveg"), "szöveg")

    def test_parse_modern_layout(self):
        e = parse_entry("cirkalmas", WIKITEXT_OK)
        self.assertIsNotNone(e)
        self.assertEqual(e.pos, "melléknév")
        self.assertEqual(e.definition, "Túlságosan díszes, cikornyás stílusú.")
        self.assertEqual(e.labels, ["választékos"])
        self.assertEqual(e.examples, ["Cirkalmas mondatokban beszélt."])

    def test_parse_plain_magyar_heading(self):
        txt = "== magyar ==\n=== Ige ===\n# Sürög-forog, sokat szaladgál valami körül.\n== angol ==\n# nope nope nope\n"
        e = parse_entry("tüsténkedik", txt)
        self.assertEqual((e.pos, e.definition), ("ige", "Sürög-forog, sokat szaladgál valami körül."))

    def test_parse_old_style_language_markers(self):
        txt = "{{-hu-}}\n==== Főnév ====\n# Szegénynek adott kisebb adomány, könyöradomány.\n{{-en-}}\n# nope nope nope nope\n"
        e = parse_entry("alamizsna", txt)
        self.assertEqual(e.definition, "Szegénynek adott kisebb adomány, könyöradomány.")

    def test_first_part_of_speech_without_usable_definition_is_skipped(self):
        txt = ("== x ({{hu}}) ==\n=== Főnév ===\n# a [[valaki]] ragozott alakja\n"
               "=== Ige ===\n# Valamit lassan, tétován csinál, halogat.\n#: Egész nap bíbelődött vele.\n")
        e = parse_entry("bíbelődik", txt)
        self.assertEqual(e.pos, "ige")
        self.assertEqual(e.examples, ["Egész nap bíbelődött vele."])

    def test_meaning_heading_with_star_list(self):
        txt = "== szó ({{hu}}) ==\n=== Jelentések ===\n* Nagyon kicsi, jelentéktelen mennyiség.\n"
        self.assertIsNotNone(parse_entry("parány", txt))

    def test_rejection_reasons(self):
        self.assertEqual(parse_entry_ex("x", "#REDIRECT [[y]]").reason, Rejection.REDIRECT)
        self.assertEqual(parse_entry_ex("word", "== word ({{en}}) ==\n# some english definition text\n").reason,
                         Rejection.NO_LANGUAGE_SECTION)
        self.assertEqual(parse_entry_ex("valami", "== v ({{hu}}) ==\n=== Főnév ===\nnincs lista\n").reason,
                         Rejection.NO_DEFINITION_LINES)
        txt = "== valami ({{hu}}) ==\n=== Főnév ===\n# a [[valaki]] ragozott alakja\n"
        self.assertEqual(parse_entry_ex("valami", txt).reason, Rejection.FORM_OF)

    def test_word_in_its_own_definition_is_masked_not_lost(self):
        d, reason = check_definition("cirkalmas", "Cirkalmas, túl díszes és cikornyás beszéd.")
        self.assertIsNone(reason)
        self.assertTrue(d.startswith("…,"))
        _, reason = check_definition("cirkalmas", "cirkalmas cirkalmasan cirkalmas")
        self.assertEqual(reason, Rejection.LEAKS_WORD)

    def test_short_synonym_style_definitions_are_accepted(self):
        d, reason = check_definition("rest", "lusta, munkakerülő")
        self.assertIsNone(reason)


class HtmlParseTests(unittest.TestCase):
    HTML = """<div class="mw-heading"><h2 id="Magyar">Magyar</h2></div>
    <div class="mw-heading"><h3 id="Melléknév">Melléknév</h3></div><p><b>cirkalmas</b></p>
    <ol><li>Túlságosan <a href="#">díszes</a>, cikornyás stílusú.<dl><dd><i>Cirkalmas mondatokban beszélt.</i></dd></dl></li></ol>
    <div class="mw-heading"><h2 id="Angol">Angol</h2></div><ol><li>english thing here for test</li></ol>"""

    def test_parses_rendered_page(self):
        r = parse_html_entry("cirkalmas", self.HTML)
        self.assertEqual(r.entry.definition, "Túlságosan díszes, cikornyás stílusú.")
        self.assertEqual(r.entry.pos, "melléknév")
        self.assertEqual(r.entry.examples, ["Cirkalmas mondatokban beszélt."])

    def test_no_hungarian_heading(self):
        r = parse_html_entry("x", '<h2 id="Angol">Angol</h2><ol><li>an english definition here</li></ol><h2>Német</h2>')
        self.assertEqual(r.reason, Rejection.NO_LANGUAGE_SECTION)


class BuildTests(unittest.TestCase):
    def test_candidates_from_titles(self):
        args = Namespace(any_title=False, min_freq=1, max_freq=5000, keep_compounds=False)
        titles = ["cirkalmas", "Budapest", "alma", "xyzzyx", "csúcseredmény", "ab"]
        thes = {"cirkalmas": ["cikornyás", "díszes"], "alma": ["gyümölcs"]}
        lex = {"cirkalmas", "alma", "csúcs", "eredmény", "csúcseredmény"}
        freq = {"cirkalmas": 3, "alma": 90_000, "xyzzyx": 5, "csúcseredmény": 7}
        got = candidates_from_titles(titles, thes, lex, set(), freq, args)
        # Budapest/ab fail the word test, alma is too frequent, xyzzyx is in no lexicon,
        # csúcseredmény is a compound
        self.assertEqual(got, [("cirkalmas", ["cikornyás", "díszes"], 3)])

    def test_build_entries_with_html_fallback_and_stats(self):
        cands = [("cirkalmas", ["cikornyás"], 20), ("nincsilyen", ["x"], 30), ("sablonos", [], 40),
                 ("hibás", [], 50)]
        pages = {
            "cirkalmas": WIKITEXT_OK,
            "nincsilyen": None,
            "sablonos": "== s ({{hu}}) ==\n=== Melléknév ===\n{{definíció-sablon}}\n",  # wikitext parser fails
            "hibás": "== h ({{hu}}) ==\n=== Melléknév ===\n# a [[valaki]] ragozott alakja\n",
        }
        html = {"sablonos": '<h2 id="Magyar">Magyar</h2><ol><li>Sablonból generált, hosszú meghatározás.</li></ol>'}
        out, stats = build_entries(
            cands, lambda titles: {t: pages.get(t) for t in titles}, target=10, max_pages=100, pause=0,
            fetch_html_page=lambda w: html.get(w), html_budget=5, log=lambda *_: None)
        self.assertEqual([e["word"] for e in out], ["cirkalmas", "sablonos"])
        self.assertEqual(out[0]["id"], "d:cirkalmas")
        self.assertEqual(out[0]["synonyms"], ["cikornyás"])
        self.assertEqual(out[0]["freq"], 20)
        self.assertEqual(stats.counts["accepted (wikitext)"], 1)
        self.assertEqual(stats.counts["accepted (html)"], 1)
        self.assertEqual(stats.counts["page_missing"], 1)
        self.assertEqual(stats.counts["inflected_form_definition"], 1)
        self.assertIn("inflected_form_definition", stats.samples)


if __name__ == "__main__":
    unittest.main()
