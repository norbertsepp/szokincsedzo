# Data sources and licences

The application code in this repository is yours to license as you like. The word
data in `web/public/data/` is derived from third-party sources and carries their terms:

| File | Source | Licence |
|------|--------|---------|
| `definitions.json` (real build) | Hungarian Wiktionary, hu.wiktionary.org, via the MediaWiki API | CC BY-SA 4.0 - attribution and share-alike. Each entry stores a link to its Wiktionary page. |
| `synonyms.json` | Magyar Szinonimaszótár, Németh László, as shipped in LibreOffice's `hu_HU` dictionary | GNU GPL v2 |
| word-family frequencies (used to choose rare words, stored as `freq`) | hermitdave/FrequencyWords (OpenSubtitles-based) | CC BY-SA 4.0 |
| name filter (not redistributed) | `hu_HU.dic` from LibreOffice dictionaries | see that repository |

The bundled demo definitions (`"source": "demo"`) were written for this project.

If you keep this repository public (needed for free GitHub Pages), the published word
lists are redistributed under the licences above. The app shows the attribution in
Settings. szinonimaszotar.hu and ertelmezo.oszk.hu are deliberately *not* used: the
first states its database is not available for software development, and the second
publishes no reuse terms.
