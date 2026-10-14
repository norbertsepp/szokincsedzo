# Szókincs-edző – daily Hungarian vocabulary trainer

A small game you play for about five minutes a day, on a phone, tablet or computer:

1. **Words and definitions** – the daily challenge has 12–15 rare Hungarian words (your choice in Settings). Tap a word, then its definition: every pair gets its own colour and number (and, optionally, a connecting line). You can tap a connected card to release it and pair differently. Nothing is scored until you press **Submit**; then correct pairs turn green, wrong ones red, and the right answers are shown. Wrong or unpaired words are tagged **unknown**, correct ones **known**. Unknown words are explained with definition, examples and synonyms, and you can drill them again.
2. **Synonyms** – the same game with a word and a set of its synonyms.
3. **Extra practice** – any time, also after the daily challenge: pick definitions or synonyms, **12–30 words**, which words (mixed, new only, unknown only) and a **rarity level**, and whether the round **counts in your scorecard** (a switch; off by default). Counted rounds update known/unknown and the review dates; they never change the daily streak.

Unknown words come back sooner (a simple spaced-repetition ladder: 1, 2, 4, 8, 16, 32 days), known words come back rarely, and at most about 40% of a session is review - the rest is new words. Your scorecard, streak and word lists are kept on every device in sync.

```
 GitHub repo (public)                         GitHub repo (private, "vocab-progress")
 ├─ tools/   Python: builds the word banks    ├─ progress.json   <- the app writes this
 ├─ web/     React + TypeScript PWA           └─ reminder workflow  -> push via ntfy.sh
 └─ Actions: build data · deploy to Pages              ▲
        │                                               │ GitHub API, your token
        ▼                                               │
 https://<you>.github.io/<repo>/  ── installable web app on Mac, PC, iPhone, iPad
```

## What you should know first

* **Sources.** Synonyms come from the open Hungarian thesaurus in LibreOffice (Magyar Szinonimaszótár, GPL v2). Definitions come from **Hungarian Wiktionary** (CC BY-SA 4.0). szinonimaszotar.hu states that its database may not be used for software development, and ertelmezo.oszk.hu (Magyar Értelmező Kéziszótár) publishes no reuse terms, so neither is scraped. Details: `DATA-LICENSES.md`.
* **"Rare but real"** is measured by *word-family frequency*: how often a word and its inflected forms occur in a large Hungarian subtitle corpus. (Looking only at the word's own form misleads: "prédikálás" occurs 13 times but its forms 1 360 times.) Transparent compounds such as *csúcseredmény*, proper names and noise are filtered out. Each entry stores its `freq`, and the app offers three levels: **very rare** (≤ 60 occurrences, the default), **rare** (≤ 600) and **all**. The numbers in brackets in the settings and the practice screen show how many words each level has. If a level is too narrow to fill a session, it is topped up with the next-rarest words. A few oddities are inevitable, and the thesaurus merges all senses of a word, so a synonym set can blend two meanings.
* **The Wiktionary importer** was rewritten after the first run gave about 1 000 entries instead of 2 500. It now takes its candidates from Wiktionary's own list of existing pages (so every candidate has an entry), accepts several page layouts (language headings, `{{-hu-}}` markers, templates, numbered or starred meanings), retries pages through a second parser that reads the rendered HTML, and keeps definitions that mention their own word by masking it ("…"). **I could not reach hu.wiktionary.org from my build environment, so none of this has been run against the live site**; the parsers are tested on sample pages in the layouts I expect. Every run prints a table of *why* pages were rejected and saves examples (`reject-samples` download on the workflow run page). If the yield is still low, send me that table and file and the parser can be tuned from facts. It stays fail-safe: with fewer than 100 usable entries nothing is overwritten. Until a build succeeds the app uses a 30-word **demo** definitions set (written for this project; the home screen says so). The synonym bank (about 7 400 words) is real and included.
* **Daily selection runs inside the app**, not in Python, because it depends on your progress (what is unknown or due). It is seeded by the date, so every device picks the same words, and the chosen list is frozen for the day.

## Setup (about 20 minutes, once)

You need a GitHub account. No local tools are required – everything runs in GitHub.

**1. Publish the app.**
Create a **public** repository (free GitHub Pages requires it; it contains only code and CC/GPL word lists, never your progress) and upload the contents of this folder to the `main` branch. Then *Settings → Pages → Source: GitHub Actions*. The *Deploy app* workflow runs, and your app appears at `https://<your-user>.github.io/<repo>/` (the URL is shown in the workflow run).

**2. Build the real word data.**
*Actions → Build word data → Run workflow* (re-run it after updating the files; the first request lists all Wiktionary titles, then pages are fetched at one request per second, so allow 10–40 minutes). When it finishes it commits the data and *Deploy app* publishes it. In the run log, look at the statistics table; at the bottom of the run page you can download `reject-samples`. If the yield is below what you want, send me the table.

**3. Create the private progress repository.**
Create a **private** repository named `vocab-progress`. Upload everything inside `progress-repo-template/` to it (including the `.github` folder).

**4. Create an access token for the app.**
GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate*. Repository access: *Only select repositories → vocab-progress*. Permissions: *Contents → Read and write*. Copy the token. It can touch nothing else.

**5. Connect each device.**
Open the app → *Beállítások / Settings*. Owner = your GitHub username, repository = `vocab-progress`, file = `progress.json`, token = the one from step 4 → *Mentés*. The dot next to Settings turns green when syncing works. Repeat on every device (the token is stored only in that browser).
Install it as an app: **iPhone/iPad** – Safari → Share → *Add to Home Screen*; **Mac/PC** – Chrome or Edge → install icon in the address bar (Safari on Mac: File → *Add to Dock*).

**6. Daily reminder (push notification).**
Install the free **ntfy** app (iOS/Android) and subscribe to a topic with a long random name, e.g. `szokincs-7f3k9q2x`. Treat the name like a password. In the `vocab-progress` repo: *Settings → Secrets and variables → Actions* → add secret `NTFY_TOPIC` (the topic) and variable `APP_URL` (your app's URL). The reminder fires at about 08:30 and 19:00 Budapest time and is **skipped once you have finished both sessions that day**. Test it: *Actions → Daily reminder → Run workflow*. Times are UTC cron lines in `reminder.yml`; edit them if you want other hours.

## Using the app

* **Pairing.** Tap a word, then the definition or synonym set you think belongs to it (either order). The pair gets a colour and a number shown on both cards. Tap a connected card to release it; tap another card to connect it differently. **Lines** between paired cards are a switch (on by default on wide screens, off on phones, where colours and numbers are clearer).
* **Submit.** The *Submit* button is always at the bottom of the screen. You may submit with some words unpaired; they count as unknown. After submitting, the board is frozen: green = correct, red = wrong, and a wrong card says which numbered word it really belongs to (dashed green lines show the right pairs). Then continue to the review of the unknown words.
* **Daily challenge.** One per kind per day, 12–15 words (Settings), drawn at the chosen rarity level; the day's words are fixed once you start, on every device.
* **Extra practice.** *Extra gyakorlás / Extra practice* on the home screen: kind, **12–30 words** (scroll on small screens; Submit stays visible), focus (mixed / new only / unknown only), rarity level, and whether it counts in the scorecard. Your last choices are remembered. "Unknown only" with nothing unknown tells you so instead of starting.
* A finished daily session can be reopened from the home screen to review it. The **scorecard** lists unknown and known words and your streak.
* Settings: language, daily size and rarity, sync, progress export/import (a manual backup), reset.

## Tuning the vocabulary

Run these from the `tools/` folder (`pip install requests`), or let the workflow do it:

```bash
python -m vocabtools.build_synonyms --max-freq 600                         # only the rarer words
python -m vocabtools.build_synonyms --keep-compounds                        # keep csúcseredmény-type compounds
python -m vocabtools.build_definitions --target 4000                      # more definitions
python -m vocabtools.build_definitions --words-file my_words.txt          # your own word list
python -m vocabtools.build_definitions --dump-page cirkalmas              # raw page + both parsers' result
python -m vocabtools.build_definitions --any-title                        # also words outside the lexicon/thesaurus
python -m unittest discover -s tests                                      # tools tests
```

Locally for the web app (needs Node 20+): `cd web && npm install && npm run dev`, tests `npm test`, browser smoke test `python3 e2e/smoke.py` (needs Playwright for Python and a running `npm run preview`).

## Good to know / limits

* Sync merges by "newest record wins" per word, so using two devices at once is safe; the worst case is that a few answers from the older device are replaced.
* `progress.json` holds only word ids, statuses and dates (under about 1 MB even after a year of daily use). Detailed per-day records are kept for 30 days.
* GitHub stops scheduled workflows in a *public* repo after 60 days without activity. That is why the reminder lives in the private repo, where this does not apply.
* Example sentences exist only where Wiktionary has them. Words without any still show their definition and synonyms when you miss them.
* Offline: after the first load the app and word lists are cached and work without a connection; sync resumes when you are back online.
