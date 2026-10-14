"""Writes web/public/data/definitions.json with a small hand-written DEMO set.

The demo set only exists so the app works before the real Wiktionary data has been
built (GitHub Actions -> "Build word data"). The real build overwrites this file.
Definitions and example sentences below are original, written for this project.
"""
import json
from datetime import date
from pathlib import Path

DEMO = [
 ("cirkalmas","melléknév","Túlságosan díszes, cikornyás, körülményesen kicifrázott.","Cirkalmas mondatokkal köszöntötte a vendégeket."),
 ("fennkölt","melléknév","Emelkedett, magasztos hangulatú vagy stílusú.","Fennkölt szavakkal beszélt a hazaszeretetről."),
 ("fortély","főnév","Ügyes fogás, csel, amellyel valaki elér valamit.","Minden fortélyt bevetett, hogy meggyőzze a bírákat."),
 ("gyarló","melléknév","Erkölcsileg vagy jellemében gyenge, hibákkal teli.","Gyarló ember vagyok, nem tagadom."),
 ("hánytorgat","ige","Szemrehányóan, újra meg újra felemlegeti a múltbéli dolgokat.","Ne hánytorgasd már folyton a régi sérelmeket!"),
 ("hepciás","melléknév","Kötekedő, akaratos, könnyen sértődő természetű.","Hepciás kamaszként minden szóba beleállt."),
 ("lagymatag","melléknév","Langyos; erőtlen, szenvedélytelen, közömbös.","Lagymatag tapssal fogadták az előadást."),
 ("míves","melléknév","Gondosan, művészi igényességgel kidolgozott.","Míves faragású szekrény állt a sarokban."),
 ("pajzán","melléknév","Enyhén szabados, tréfásan kihívó, szemérmetlenül játékos.","Pajzán történeteket mesélt a lakodalomban."),
 ("csapodár","melléknév","Állhatatlan, hűtlen, könnyen váltogatja szerelmeit.","Csapodár fiúnak tartották a faluban."),
 ("tüsténkedik","ige","Sürög-forog, buzgólkodik, sokat szaladgál valami körül.","A konyhában tüsténkedett egész délután."),
 ("zsémbes","melléknév","Folyton morgolódó, mogorván kötekedő.","A zsémbes szomszédasszony mindenbe belekötött."),
 ("szilaj","melléknév","Vad, féktelen, nehezen megfékezhető.","Szilaj mén vágtatott a pusztán."),
 ("tunya","melléknév","Lusta, nehézkes mozgású, tétlen.","Tunya délutánokon csak hevert a kanapén."),
 ("ügyefogyott","melléknév","Ügyetlen, tehetetlen, akinek semmi sem megy kézre.","Ügyefogyott módon próbálta megjavítani a biciklit."),
 ("zord","melléknév","Barátságtalan, ridegen szigorú, kegyetlenül kemény (például időjárás vagy arc).","Zord télre számítottak a hegyekben."),
 ("tétova","melléknév","Bizonytalan, habozó, határozatlan.","Tétova léptekkel indult az ajtó felé."),
 ("hitvány","melléknév","Értéktelen, silány; becstelen, aljas.","Hitvány kis ruhában járt télen is."),
 ("enyészik","ige","Pusztulóban van, lassan elmúlik, semmivé válik.","A régi kastély lassan enyészik a lombok alatt."),
 ("eszmél","ige","Öntudatra ébred; rádöbben valamire, felfogja, mi történik körülötte.","Csak a kórházban eszmélt rá, mi történt vele."),
 ("alamizsna","főnév","Szegénynek, koldusnak adott kisebb adomány.","Alamizsnát osztottak a templom előtt."),
 ("fösvény","melléknév","Zsugori, pénzéhez görcsösen ragaszkodó, kapzsi.","A fösvény gazda egy fillért sem adott."),
 ("kajla","melléknév","Félrecsapott, lelógó, ferdén álló (például fül, kalap).","Kajla fülű kutyakölyök ugrált a kertben."),
 ("nyavalyás","melléknév","Beteges, nyomorult, szerencsétlen sorsú.","Nyavalyás kis kunyhóban lakott."),
 ("rest","melléknév","Lusta, munkakerülő.","A rest inas sosem lett mester."),
 ("ámbár","kötőszó","Jóllehet, noha; engedő, ellentétes viszonyt kifejező szó.","Ámbár fáradt volt, elvégezte a munkát."),
 ("vérmes","melléknév","Heves természetű; túlzottan, megalapozatlanul bizakodó.","Vérmes reményekkel indult az útra."),
 ("sután","határozószó","Ügyetlenül, esetlenül, mereven.","Sután hajolt meg a közönség előtt."),
 ("kelletlen","melléknév","Vonakodó, rosszkedvű, nem szívesen végzett.","Kelletlen arccal fogott a munkához."),
 ("csökönyös","melléknév","Makacs, nem engedő, nehezen győzhető meg.","Csökönyös szamárként ragaszkodott a véleményéhez."),
]
entries = [{
    "id": f"d:{w}", "word": w, "pos": pos, "definition": d, "examples": [ex],
    "labels": [], "synonyms": [], "freq": None, "source": "demo", "url": "",
} for w, pos, d, ex in DEMO]
out = Path(__file__).resolve().parents[1] / "web/public/data/definitions.json"
out.write_text(json.dumps({
    "version": 1, "generated": date.today().isoformat(),
    "source": "DEMO set written for this project (replaced by the Wiktionary build)",
    "entries": entries}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("wrote", len(entries), "demo entries")
