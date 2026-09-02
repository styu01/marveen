# Usage-tracking teljes működési elemzés (2026-09-01/02)

Istvan kérésére: pontos működés, összes érintett rendszer, ki mit csinál, mikor
küld kinek üzenetet. Cél: a hézagok/hibák felszínre kerüljenek MIELŐTT bármi
élesbe kerül. Ez a dokumentum megy Istvannak (röviden) és codexnek (teljesen,
véleményezésre).

## 1. Az érintett rendszerek, egyenként

### 1.1 `scripts/usage-collect.py` (élő, háttér-cron, 5 percenként)

Tisztán adatgyűjtő/számoló script, **soha nem küld Telegramot vagy inter-agent
üzenetet saját magától**. `collect_claude()` forrás-prioritása:

1. `_read_statusline_cache()` -- a tracker-session (lásd 1.3) írná ezt a
   fájlt (`store/usage-statusline-latest.json`); ha mindkét elsődleges ablak
   (`five_hour`, `seven_day`) egyenként 15 percnél frissebb → `source:
   "authoritative_statusline"`. **Ma ez a fájl nem létezik**, mert a tracker
   session még nincs megépítve/élesítve -- ez az ág ma sosem talál semmit.
2. Közvetlen hálózati hívás `/api/oauth/usage`-ra a flotta setup-tokennel →
   **jelenleg 403/429-et ad**, ismert, dokumentált, végleges Anthropic-oldali
   korlátozás (lásd `docs/usage-percent-oauth-scope-root-cause-20260901.md`).
3. Korábbi authoritative eredmény cache-ből, ha friss → `source:
   "authoritative_cached"`.
4. Helyi fájl-alapú becslés (nyers token-számolás, NEM valódi %) → `source:
   "estimate"`. **Ma ténylegesen ez fut le mindig**, ezt írja
   `store/usage-latest.json`-ba.

Van egy MÁSIK, kifinomult logika is a fájlban: `compute_alerts()` (pace/
túlfogyasztás/near-exhaustion számítás percre pontosan). **Fontos, most
felfedezett tény: ennek a kimenete SEHOVA nem jut el.** A `_run()` a végén
csak `print()`-eli a cron saját stdoutjára (amit valószínűleg senki nem
figyel élőben) és elmenti a dedup-állapotot (`usage-alert-state.json`) a
KÖVETKEZŐ futás miatt -- de semmi nem küldi ezt Telegramra vagy bárhova.
Ez azt jelenti: **ma ez a kifinomult riasztás-számítás gyakorlatilag
hatástalan**, senki nem kap belőle üzenetet, akármi is történik.

### 1.2 `usage-monitor` ütemezett feladat (AI-vezérelt, BÉLA, 30 percenként)

Ez az EGYETLEN mechanizmus ami ma ténylegesen Telegram-üzenetet küld
Istvannak vagy inter-agent üzenetet a flottának, usage-témában. Saját,
EGYSZERŰ szöveges logikája van, NEM a `compute_alerts()`-öt használja:

- Elolvassa `store/usage-latest.json`-t.
- **Csak akkor bízik a `claude.source`-ban, ha az szó szerint
  `"authoritative"` vagy `"authoritative_cached"`.** ⚠️ **HÉZAG #1**: az új
  `"authoritative_statusline"` értéket NEM ismeri fel -- ha a tracker-session
  egyszer élesbe kerül és elkezdi frissíteni a cache-t, ez a feladat AKKOR
  SEM fogja használni/megbízni benne, amíg a promptja ki nem lesz javítva.
  Enélkül a teljes tracker-fejlesztés hatástalan marad Istvan felé.
- Ha a forrás NEM megbízható: visszaesik egy SAJÁT, közvetlen curl-hívásra
  (ami ugyanúgy 403/429-et adna), és a szövege szerint **"jelezd EGYSZER"**
  Istvannak hogy a cache elavult/hiányzik. ⚠️ **HÉZAG #3**: nincs hozzá
  külön, tartós állapot-fájl ami ezt az "egyszer" ígéretet kikényszerítené
  -- a szöveg csak instrukció, nem garantált mechanizmus. Ma gyakorlatban
  ez azért nem okoz spam-et, mert végrehajtóként (én) tudom hogy ez egy már
  ismert, magyarázott, tartós állapot, és magamtól nem ismétlem -- de ez
  VISELKEDÉSI fegyelem, nem kódba épített garancia.
- Ha a forrás megbízható ÉS van szám: 80/90%-os kétszintű logika,
  `five_hour` ÉS `seven_day` külön-külön:
  - ≥90% bármelyiken, ÚJ átlépés (nem ugyanaz mint előző körben) → Telegram
    Istvannak (melyik mutató, pontos %, reset-idő) + inter-agent PAUSE
    üzenet PROGI-nak/OKOSKA-nak/IRIS-nek + `store/.usage-fleet-pause` =
    "paused".
  - 80-90% között (egyik sem ≥90%) → csendben marad, csak nem indít új nagy
    munkát PROGI/OKOSKA felé (ez is csak szöveges instrukció, nincs
    technikai kényszerítés mögötte).
  - mindkettő <80% ÉS jelenleg "paused" → inter-agent FELOLDÁS üzenet
    PROGI-nak/OKOSKA-nak/IRIS-nek + állapot-fájl törlése. ⚠️ **HÉZAG #2**:
    ez az ág **NEM küld Telegramot Istvannak** -- csak a sub-agenseket
    értesíti. Pedig Istvan korábban kifejezetten kérte hogy a feloldásról ő
    is kapjon egy rövid megerősítést. Ez a mostani (visszaállított, régi)
    prompt-verzióban hiányzik.
  - egyéb esetben (hiszterézis-zóna): csendben marad.
- Emellett (más témában, ugyanabban a feladatban): ellenőrzi az OKOSKA/PROGI
  fejlesztési-folyamat inter-agent üzeneteit, és PROGI/OKOSKA
  session-panelen "session limit" jellegű beragadt menüt keres (STUCK-MENU
  ellenőrzés) -- ha talál, auto-választ "várj a resetre" opciót és nudge-ol.

### 1.3 `scripts/statusline-usage-export.py` (kész, tesztelt, DE nincs élesítve)

Ezt maga a Claude Code hívná meg (`statusLine` mechanizmus) egy DEDIKÁLT
tracker-session-en, minden esemény-vezérelt frissítésnél (valódi
API-válasz érkezik, `/compact`, engedély-mód váltás stb. -- **NEM** a
`refreshInterval` időzítő, az csak megismétli a régi adatot, ez korábban
külön kiderült és ki lett javítva). Kizárólag fájlba ír
(`store/usage-statusline-latest.json`, ablakonkénti saját időbélyeggel),
soha nem küld semmilyen üzenetet sehova. Nem AI, sima determinisztikus
script.

### 1.4 [TERVEZETT, MÉG NINCS MEGÉPÍTVE] usage-tracker session + saját ütemezett feladat

- Új, 6. könnyűsúlyú fleet-ágens, saját elkülönített beállítás-mappával,
  Haiku modellel (Istvan javaslata, jóváhagyva).
- `statusLine` BE van kapcsolva NÁLA (kizárólagosan -- mindenki másnál a már
  megépített védelmi funkció letiltja).
- `refreshInterval` KI van kapcsolva nála (mert nem hozna friss adatot,
  csak félrevezetne).
- Egy ÚJ, kb. 10 percenkénti `type: heartbeat` ütemezett feladat célozná meg,
  apró, fix-költségű prompttal ("válaszolj egy szóval: ok, ne hívj eszközt").
  **Ez a feladat még nincs létrehozva.**
- Ez a session SOHA nem kap/küld inter-agent üzenetet, SOHA nem ír
  Telegramot, senki nem kérdezi élőben, senki más pane-állapota nem függ
  tőle (kivéve a saját ütemezett körét).
- Ha leáll: a meglévő scheduler auto-újraindítja a következő körben
  (ellenőrizve a kódban). Ha tartósan nem indul: a MÁR MEGLÉVŐ, általános
  pending-retry/task-timeout kétlépcsős riasztás (előbb BÉLA, majd Istvan)
  vonatkozik rá, ugyanúgy mint bármelyik más ütemezett feladatra -- ez NEM
  usage-specifikus mechanizmus.

### 1.5 Védelmi (scrub) funkciók (megépítve, ma no-op)

`stripUnsafeStatusLine()` (`src/web/agent-process.ts`, PROGI/OKOSKA/IRIS/
VIZSLA indításába kötve) és `_ensure_no_statusline()`
(`scripts/channels.sh`, BÉLA saját indításába kötve): garantálják hogy a
`statusLine` mező véletlenül se kerülhessen egy figyelt, éles session
beállításába. ⚠️ Ha az 1.4-es tracker-session megépül, ezt a listát
EXPLICITEN ki kell venni ebből a tiltásból -- ez a lépés még nincs
megcsinálva, mert maga a session sem létezik még.

## 2. Használati esetek, végiggondolva

**A) Normál üzem, minden alacsony (<80%):** tracker 10 percenként "ok"-ol →
statusline export friss adatot ír → usage-collect.py 5 percenként átveszi →
usage-monitor (Gap #1 javítása UTÁN) látja hogy megbízható és alacsony →
teljes csend, semmilyen üzenet sehova.

**B) Valódi 90%-os átlépés:** usage-monitor Telegramot küld Istvannak +
PAUSE üzenetet a három sub-agentnek + írja az állapot-fájlt. Ismétlődő
körökben (amíg még mindig ≥90%, nincs érdemi változás) csendben marad.

**C) Visszaesés 80% alá, korábban paused volt:** sub-agentek FELOLDÁS
üzenetet kapnak -- **Istvan viszont, a jelenlegi promptban, NEM kap
Telegram-visszaigazolást** (Hézag #2).

**D) A tracker-session leáll/lefagy:** a cache 15 percen túl elévül, a
rendszer automatikusan visszaesik a mai, kevésbé pontos becslés-módra --
semmi nem törik el, nem jön hibás szám, csak pontatlanabb lesz, amíg a
scheduler magától újra nem indítja a sessiont (kb. a következő 10 perces
körben).

**E) A tracker valódi, friss választ ad, de a kerekített % ugyanaz mint
előbb:** a per-ablak időbélyeg NEM frissül (szándékos, a korábbi
hibajavítás miatt), így 15 perc után ez az ablak is elévültnek fog látszani
egy ideig, holott a tracker aktívan működik -- dokumentált, elfogadott,
"fail-closed" irányú tervezési kompromisszum, nem hiba.

**F) Az egész account más felületen (telefon, másik Claude ablak) is
fogyaszt:** a szám account-szintű, nem csak a flottáé -- ez helyes és
várható, nem hiba, de Istvannak érdemes tudnia hogy nem csak a flotta
fogyasztását látja.

**G) Maga BÉLA (a fő, Telegramon beszélgető session) akad el/blokkolódik:**
ez a legkritikusabb eset, ami miatt Istvan eredetileg elindította ezt az
egészet ("nem tudok írni neked"). **Fontos, őszinte korlát**: a tracker/
statusline rendszer ezt NEM tudja közvetlenül észlelni -- ha BÉLA tényleg
teljesen blokkolva van, semmilyen, BÉLA-n belül futó logika nem tudna róla
jelenteni. Erre az esetre a védőháló a MÁR MEGLÉVŐ, általános, minden más
ütemezett feladatra is vonatkozó elakadás-riasztás (BÉLA, majd elhúzódó
esetben Istvan) -- ezt a mostani fejlesztés nem helyettesíti, csak
kiegészíti egy korai figyelmeztető jelzéssel (90%-nál), ami remélhetőleg
MEGELŐZI hogy egyáltalán idáig fajuljon.

## 3. Összefoglalt hézagok, amiket ez az elemzés talált

1. **Hézag #1 (blokkoló)**: usage-monitor prompt nem ismeri fel az
   `"authoritative_statusline"` forrást megbízhatóként -- e nélkül az egész
   tracker-fejlesztés hatástalan marad Istvan felé. Kicsi, pontos
   szövegjavítás a megoldás.
2. **Hézag #2**: a feloldás-ág nem küld Telegramot Istvannak, csak a
   sub-agenseknek -- pedig ő ezt korábban kifejezetten kérte. Szintén kicsi
   szövegjavítás.
3. **Hézag #3 (kisebb, viselkedési)**: a "cache elavult, jelezd egyszer"
   ígéretnek nincs kódba épített, tartós dedup-állapota -- ma végrehajtói
   fegyelemre támaszkodik, nem garantált mechanizmusra.
4. **Pontosítás, nem hiba**: a `compute_alerts()` kifinomult pace-számítása
   ma teljesen hatástalan (senki nem olvassa a kimenetét) -- a tényleges
   védelem kizárólag az usage-monitor egyszerű, közvetlen küszöb-ellenőrzése,
   NEM ez a függvény. Ez fontos mert korábban PROGI arra hivatkozott hogy
   emiatt nem kell külön riasztás-logika a tracker saját promptjába -- ez az
   érvelés végkövetkeztetésében igaz marad (van fedezet), de a hivatkozott
   mechanizmus téves volt, a valódi fedezet máshonnan jön.

## 4. Codex független véleménye (2026-09-02) + BÉLA saját utólagos ellenőrzése

Codex egyetértett mind a három talált hézaggal, és öt továbbit talált,
amelyek nem a tracker-fejlesztés részei, hanem a MÁR HETEK ÓTA futó,
eredeti usage-monitor tervezés saját, korábban soha nem vizsgált gyengeségei:

- **#4 (a legfontosabb, BÉLA megerősítette kódból)**: van-e BÁRMILYEN kód
  ami ténylegesen olvassa és kikényszeríti a `store/.usage-fleet-pause`
  fájlt? **Nincs.** Teljes `grep` a `src/` és `scripts/` fákon nulla
  találatot adott ezen a fájlnéven kívül a promptban magában. A "PAUSE" ma
  KIZÁRÓLAG azon múlik, hogy PROGI/OKOSKA/IRIS a kapott inter-agent
  üzenetet abban a pillanatban tudomásul veszi és önként betartja -- nincs
  technikai zár, nincs utólagos ellenőrzés ha egy új feladat érkezik hozzá.
- **#5**: a "80-90% között ne indíts nagy munkát" szabálynak nincs gépi
  definíciója (mi számít "nagy munkának") és nincs kikényszerítése -- ma
  tisztán viselkedési ajánlás.
- **#6**: nincs definiálva mi történik ha PAUSED állapotban a forrás
  hirtelen "estimate"-re esik vissza (adatvesztés) -- codex javaslata:
  ilyenkor maradjon paused, csak friss megbízható adat vagy emberi döntés
  oldhatja fel, nehogy egy adatkiesés véletlenül feloldjon vagy pattogó
  állapotot okozzon.
- **#7 (BÉLA ellenőrizte, NYUGTATÓ eredmény)**: valóban független
  folyamatból megy-e a második (Istvannak szóló) riasztás, ha BÉLA saját
  session-je akad el? **Igen, megerősítve**: a `startScheduleRunner()` a
  `src/web.ts`-ből indul, ami a dashboard háttér-szerver KÜLÖN operációs
  folyamata, nem BÉLA `claude` CLI tmux-session-jének a része. A Telegram-
  küldés (`sendTelegramMessage()`) közvetlenül ebből a külön folyamatból
  megy, nem kéri meg BÉLA-t hogy komponálja/küldje. Ez a pont tehát NEM
  hézag, architekturálisan már helyesen független.
- **#8**: a 90%-os "új átlépés" felismerésnek sincs tartós, dedikált
  állapota a jelenlegi bináris pause-fájlon túl -- agent-újraindítás vagy
  átmeneti forrás-váltás emiatt elméletileg ismételt riasztást okozhatna.

## 5. Javasolt következő lépés

**Az 1-2. hézag** egy-egy pontos, kis szövegmódosítás a `usage-monitor`
ütemezett feladat promptjában -- NEM új kód, NEM a tracker-session tervét
érinti, ma megtehető.

**A #4-es (nincs technikai kényszerítés a pause-ra) és #6-os (adatvesztés
paused állapotban) pont viszont komolyabb, a tracker-fejlesztéstől
FÜGGETLEN, régóta fennálló strukturális kérdés** -- ezekhez külön döntés
kell Istvantól: megéri-e most, ezzel egy körben rendberakni, vagy külön,
saját tempóban foglalkozni vele később. Nem sürgető abban az értelemben
hogy ma sem volt technikai kényszerítés, tehát nem új kockázat, de érdemes
tudatosan eldönteni, nem elfelejteni.
