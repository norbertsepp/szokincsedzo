"""End-to-end smoke test in headless Chromium on a phone-sized viewport.

Covers: daily challenge with re-pairing + Submit + correct/wrong colouring, review of
unknown words, GitHub sync (mocked), persistence, practice sessions (size 12-30, counted /
not counted in the scorecard), rarity levels, settings, English UI.

    cd web && npm run build && (npx vite preview --port 4173 &) && python3 e2e/smoke.py [url] [shots-dir]
"""
import base64, json, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp"


def word_ids(page):
    page.wait_for_selector('[data-side="word"]')
    return [b.get_attribute("data-id") for b in page.query_selector_all('[data-side="word"]')]


def pair(page, w, c):
    page.click(f'[data-side="word"][data-id="{w}"]')
    page.click(f'[data-side="clue"][data-id="{c}"]')


def owner_of(page, clue):
    return page.get_attribute(f'[data-side="clue"][data-id="{clue}"]', "data-owner")


def play(page, wrong=0):
    """Pair everything correctly except `wrong` words, which are swapped in pairs. Returns (ids, wrong ids)."""
    ids = word_ids(page)
    swapped = []
    # swap the first 2*k words' clues with each other (k pairs of mistakes)
    k = wrong // 2
    for i in range(k):
        a, b = ids[2 * i], ids[2 * i + 1]
        pair(page, a, b)
        pair(page, b, a)
        swapped += [a, b]
    for i in ids:
        if i not in swapped:
            pair(page, i, i)
    return ids, swapped


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="hu-HU")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # the mocked "progress.json does not exist yet" 404 is expected and logged by the browser
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "api.github.com" not in m.location.get("url", "") else None)

    puts = []
    def gh(route):
        req = route.request
        if req.method == "PUT":
            puts.append(json.loads(req.post_data))
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"content": {"sha": "abc"}}))
        elif "/contents/" in req.url:
            route.fulfill(status=404, content_type="application/json", body=json.dumps({"message": "Not Found"}))
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"full_name": "me/vocab-progress"}))
    page.route("https://api.github.com/**", gh)

    page.goto(URL)
    page.wait_for_selector('[data-testid="start-today"]')
    page.screenshot(path=f"{SHOTS}/1_home.png")

    # ---- settings: daily size is limited to 12..15, rarity defaults to the rarest level; sync on
    page.click("text=Beállítások")
    rng = page.query_selector('input[type="range"]')
    assert (rng.get_attribute("min"), rng.get_attribute("max")) == ("12", "15")
    assert page.is_checked('input[name="daily-rarity"] >> nth=0')  # very rare
    page.fill("label:has-text('Tulajdonos') input", "me")
    page.fill("label:has-text('Tároló neve') input", "vocab-progress")
    page.fill("label:has-text('Hozzáférési token') input", "ghp_fake")
    page.click("button:has-text('Mentés')")
    page.wait_for_selector(".sync-status.ok")
    page.screenshot(path=f"{SHOTS}/2_settings.png", full_page=True)
    page.click("text=Vissza a főoldalra")

    # ---- daily definitions: re-pair before submitting, leave one unpaired, submit, check colours
    page.click('[data-testid="start-today"]')
    ids = word_ids(page)
    assert 12 <= len(ids) <= 15, len(ids)
    a, b2, c = ids[0], ids[1], ids[2]
    pair(page, a, b2)                       # wrong on purpose
    assert owner_of(page, b2) == a
    pair(page, a, a)                        # re-pair the same word to its own clue: replaces the old pair
    assert owner_of(page, a) == a and owner_of(page, b2) == ""
    page.click(f'[data-side="clue"][data-id="{a}"]')   # tap a connected card: releases it (and selects it)
    assert owner_of(page, a) == ""
    page.click(f'[data-side="word"][data-id="{a}"]')   # clue-then-word order connects them again
    assert owner_of(page, a) == a
    pair(page, b2, c)                       # swap b2 <-> c (both wrong)
    pair(page, c, b2)
    for i in ids[3:-1]:                     # pair all but the very last word -> one unpaired
        pair(page, i, i)
    page.wait_for_timeout(100)
    page.screenshot(path=f"{SHOTS}/3_board_before_submit.png")
    unpaired_text = page.inner_text(".submitbar")
    assert "1" in unpaired_text and "párosítatlan" in unpaired_text, unpaired_text
    assert page.query_selector("svg.lines") is None, "lines should be off by default on a phone"
    page.screenshot(path=f"{SHOTS}/3a_board_phone_numbers_only.png")
    page.click("label.toggle")
    page.wait_for_selector("svg.lines path")
    assert len(page.query_selector_all("svg.lines path")) == len(ids) - 1
    # nothing is scored before the submission:
    assert page.query_selector(".card.ok, .card.bad") is None
    page.click('[data-testid="submit"]')
    page.wait_for_selector(".card.bad")
    n = len(ids)
    ok_cards = page.query_selector_all('[data-side="word"].ok')
    bad_cards = page.query_selector_all('[data-side="word"].bad')
    assert (len(ok_cards), len(bad_cards)) == (n - 3, 3), (len(ok_cards), len(bad_cards))  # b2, c and the unpaired one
    assert len(page.query_selector_all('[data-testid="answer"]')) >= 3
    assert page.query_selector("svg.lines path.answer"), "correct answers not shown for wrong pairs"
    assert page.inner_text('[data-testid="score-inline"]').startswith(f"{n-3}/{n}")
    page.screenshot(path=f"{SHOTS}/4_board_checked.png", full_page=True)
    # the board is frozen after submitting
    page.click(f'[data-side="word"][data-id="{ids[3]}"]', force=True)
    assert len(page.query_selector_all('[data-side="word"].ok')) == n - 3
    page.click('[data-testid="continue"]')
    page.wait_for_selector(".review")
    unknown = {e.get_attribute("data-id") for e in page.query_selector_all(".explain.unknown")}
    assert unknown == {b2, c, ids[-1]}, unknown
    assert page.inner_text(".score-num") == f"{n-3}/{n}"
    page.screenshot(path=f"{SHOTS}/5_review_defs.png", full_page=True)

    # drill the unknown words (>1 unknown): same board, not recorded
    page.click("button:has-text('Gyakorold újra')")
    ids_drill = word_ids(page)
    assert set(ids_drill) == unknown
    for i in ids_drill:
        pair(page, i, i)
    page.click('[data-testid="submit"]')
    page.click('[data-testid="continue"]')
    page.wait_for_selector(".review")

    # ---- daily synonyms, all correct
    page.click("button:has-text('Tovább a szinonimákra')")
    ids2 = word_ids(page)
    for i in ids2:
        pair(page, i, i)
    page.click('[data-testid="submit"]')
    page.wait_for_selector('[data-testid="continue"]')
    page.click('[data-testid="continue"]')
    page.wait_for_selector(".review")
    assert page.inner_text(".score-num") == f"{len(ids2)}/{len(ids2)}"
    page.click("button:has-text('Befejezés')")
    page.wait_for_selector(".all-done")
    assert "1" in page.inner_text(".streak")
    page.screenshot(path=f"{SHOTS}/6_home_done.png")

    page.wait_for_timeout(300)
    saved = json.loads(base64.b64decode(puts[-1]["content"]).decode("utf-8"))
    assert saved["done"], saved
    assert saved["words"][b2]["s"] == "u" and saved["words"][b2]["w"] == 1
    assert saved["words"][a]["s"] == "k"
    n_words_after_daily = len(saved["words"])

    # ---- practice (not counted): 30 words, scorecard must not change
    puts_before = len(puts)
    page.click('[data-testid="open-practice"]')
    page.wait_for_selector('[data-testid="practice-start"]')
    sl = page.query_selector('[data-testid="practice-size"]')
    assert (sl.get_attribute("min"), sl.get_attribute("max")) == ("12", "30")
    assert not page.is_checked('[data-testid="practice-count"]')   # off by default
    page.fill('[data-testid="practice-size"]', "30")
    page.screenshot(path=f"{SHOTS}/7_practice_setup.png", full_page=True)
    page.click('[data-testid="practice-start"]')
    pids = word_ids(page)
    demo_pool = 30
    assert len(pids) == min(30, 30 if demo_pool >= 30 else demo_pool), len(pids)
    assert len(pids) >= 25
    page.screenshot(path=f"{SHOTS}/8_practice_board.png")
    for i in pids:
        pair(page, i, i)
    page.screenshot(path=f"{SHOTS}/9_practice_board_30.png", full_page=True)
    page.click('[data-testid="submit"]')
    page.click('[data-testid="continue"]')
    page.wait_for_selector(".review")
    assert "nem számított bele" in page.inner_text(".notice")
    page.click("text=Eredménylap")
    page.wait_for_selector(".tile")
    page.click("text=Vissza a főoldalra")
    stored = page.evaluate("JSON.parse(localStorage.getItem('hvt.progress.v1'))")
    assert len(stored["words"]) == n_words_after_daily, "uncounted practice changed the progress"
    assert len(puts) == puts_before, "uncounted practice must not trigger a sync write"

    # ---- practice (counted), unknown-only focus
    page.click('[data-testid="open-practice"]')
    page.check('input[name="mode"] >> nth=2')          # unknown only
    page.click('label.switch')  # the switch is a label around a visually-hidden checkbox
    page.click('[data-testid="practice-start"]')
    uids = word_ids(page)
    assert set(uids) <= {b2, c, ids[-1], *[w for w in saved["words"] if saved["words"][w]["s"] == "u"]}
    for i in uids:
        pair(page, i, i)
    page.click('[data-testid="submit"]')
    page.click('[data-testid="continue"]')
    page.wait_for_selector(".review")
    assert "beleszámított" in page.inner_text(".notice")
    stored = page.evaluate("JSON.parse(localStorage.getItem('hvt.progress.v1'))")
    assert all(stored["words"][u]["s"] == "k" for u in uids), "counted practice did not update the words"
    assert stored["words"][b2]["w"] == 1 and stored["words"][b2]["r"] >= 1
    page.click("button:has-text('Új gyakorlás')")
    page.wait_for_selector('[data-testid="practice-start"]')
    # the previous choices are remembered
    assert page.is_checked('[data-testid="practice-count"]')
    page.click("text=Vissza a főoldalra")

    # ---- unknown-only with nothing unknown -> clear message, no crash
    page.click("text=Beállítások")
    page.once("dialog", lambda d: d.accept())
    page.click("button:has-text('Helyi haladás törlése')")
    page.click("text=Vissza a főoldalra")
    page.click('[data-testid="open-practice"]')
    page.check('input[name="mode"] >> nth=2')
    page.click('[data-testid="practice-start"]')
    page.wait_for_selector(".error")
    assert "nincs elég szó" in page.inner_text(".error")

    # ---- persistence + English UI
    page.click("text=Vissza a főoldalra")
    page.click("text=Beállítások")
    page.select_option("label:has-text('Nyelv') select", "en")
    page.click("button:has-text('Mentés')")
    page.wait_for_selector("text=Settings")

    real_errors = [e for e in errors if "api.github.com" not in e and "favicon" not in e.lower()]
    assert not real_errors, real_errors
    print("E2E OK: daily", len(ids), "+", len(ids2), "pairs; practice", len(pids), "pairs; PUTs:", len(puts))
    b.close()
