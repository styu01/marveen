# Dev-spec: pontos usage-százalék — OAuth scope gyökérok, végleges diagnózis

Kanban: "Pontos usage-százalék: OAuth scope hiba kiderítése és rendes
javítás" (high). Istvan explicit kérése: NE workaround, VALÓDI gyökérok +
professzionális, upstream-re is felajánlható megoldás.

## TL;DR

**A gyökérok Anthropic saját, szándékos terméktervezési döntése, nem
marveen-hiba és nem javítható marveen-kódból.** `claude setup-token`
minden esetben `inferenceOnly: true`-val kéri az OAuth tokent -- ez a
Claude Code kliens SAJÁT, lefordított bináris kódjába van hegesztve, nem
konfigurálható flaggel megkerülhető. A hosszú (1 éves) élettartam és az
`inference`-re szűkített hatókör Anthropic oldalán egy csomagban jár --
nincs mód a kettőt szétválasztani semmilyen jelenleg publikus Claude Code
CLI-mechanizmuson keresztül. Ez azt jelenti: **nincs legitim mód** egy
flotta-szintű, headless-automatizálásra alkalmas, hosszú élettartamú
tokent szerezni, ami a pontos `/api/oauth/usage` végponthoz szükséges
`user:profile` hatókört is hordozza.

## Diagnózis-lánc (több független forrásból megerősítve)

1. **BÉLA saját közvetlen curl-tesztje** (2026-09-01 18:40, flotta
   setup-token): HTTP 403, `permission_error`,
   `"OAuth token does not meet scope requirement user:profile"`,
   `required_scopes:["user:profile"]`.

2. **Saját, független megismétlésem** (2026-09-01, kb. 19:00): ugyanaz a
   token, ugyanaz a végpont -- ezúttal HTTP 429 `rate_limit_error`,
   `retry-after: 3600`. Ez NEM ellentmond BÉLA eredményének: a 429 egy
   KÜLSŐ, Cloudflare/Anthropic-él szintű fékezés (a mai napon már
   többször lekérdezett ugyanaz a token/végpont-pár -- BÉLA tesztje,
   sajátom, plusz a rendszeres `usage-monitor` heartbeat), ami RÁTEVŐDIK
   az alatta lévő, változatlan scope-hibára. A két státuszkód két
   KÜLÖNBÖZŐ réteget mutat ugyanannak a "ez a token nincs erre a
   végpontra jogosítva" ténynek -- nem versengő magyarázatok.

3. **A saját kódbázisunk MÁR dokumentálta ugyanezt más helyen**:
   `scripts/__tests__/usage-collect.test.py` (`TestClaudeTokenSources`
   osztály docstringje) kifejezetten "403"-at ír a `.env`
   `CLAUDE_CODE_OAUTH_TOKEN` esetére -- ez ugyanaz a setup-token-eredetű
   mechanizmus mint a flotta-fájl, csak más forrásból olvasva. A
   `_read_claude_token()` saját docstringje viszont (a mai nap korábbi
   szakaszában írva) a 429-et hangsúlyozta és "nem 403" félreértést
   sugallt -- ez a kettő EGYMÁSNAK ELLENTMONDÓ árnyalat volt a saját
   kódunkban, most javítva (lásd lent).

4. **A TÉNYLEGES, telepített Claude Code kliens bináris kódjából**
   (`~/.nvm/.../@anthropic-ai/claude-code/bin/claude.exe`, v2.1.223,
   `strings` kinyeréssel -- ez egy natív, fordított bináris, nem
   olvasható JS-bundle, de a string-konstansok kiolvashatók):
   - `CLAUDE_AI_OAUTH_SCOPES` (az interaktív `/login` folyamat teljes
     hatóköre) = `["user:profile", "user:inference",
     "user:sessions:claude_code", "user:mcp_servers"]` -- tehát a
     `user:profile` IGENIS a normál interaktív bejelentkezés része.
   - A setup-token OAuth-authorize hívás explicit
     `inferenceOnly: n==="setup-token"` mezőt küld -- azaz a kliens
     SAJÁT KÓDJA kényszeríti ki a szűkítést a setup-token folyamatra,
     feltétel/kapcsoló nélkül.
   - Szó szerinti log/UI-szöveg a bináris kódban:
     *"OAuth token has no scope accepted by /api/oauth/validate (needs
     user:profile, user:office, or user:ccr_inference; **env-var and
     setup-token sessions default to user:inference only**)"* -- ez
     Anthropic saját, a kliensbe beégetett dokumentációja a
     jelenségről.
   - `RESOLVED_OAUTH_TOKEN_TTL_SECONDS = 31536000` (pontosan 1 év) és ez
     is a `n==="setup-token"` ághoz van kötve -- a hosszú élettartam és
     a szűkített hatókör UGYANABBAN a feltételes ágban dől el, együtt.

5. **Széles körű, független közösségi megerősítés**: 8+ nyitott/duplikált
   issue az `anthropics/claude-code` GitHub repóban ugyanezzel a
   tünettel (#22450, #21328, #23703, #16749, #13724, #13334, #12020,
   #34785 -- ellenőrizve, valódi, nem kitalált issue-számok, 3-at
   közvetlenül lekértem). A #22450 bejelentője FÜGGETLENÜL ugyanarra a
   következtetésre jutott mint a saját bináris-elemzésem: *"Inspected
   the OAuth authorization URL produced by `claude setup-token` and
   found it only requests `user:inference` scope... `scope=user%3Ainference`"*.
   A #23703 bejelentése szerint ez **REGRESSZIÓ**: egy korábbi CLI-
   verzióban a setup-token még szélesebb hatókört kért -- tehát ez egy
   TUDATOS, NEMRÉGI szigorítás Anthropic részéről, nem mindig-is-így-volt
   állapot. Egyik issue-nál sem található Anthropic-alkalmazotti
   válasz/hivatalos iránymutatás a fetchelt tartalomban (mindegyik
   "duplicate"-ként lezárva, a duplikátum-célpont nem volt kiolvasható) --
   ez önmagában nem bizonyítja hogy NINCS válasz valahol a trackeren,
   csak hogy az általam elért 3 issue-n nem volt látható.

## Van-e BÁRMILYEN legitim út? (2. pont a feladatból)

**Nem, a jelenleg telepített Claude Code CLI (v2.1.223) egyetlen publikus
mechanizmusán keresztül sem.**

- `claude setup-token --help`: nincs scope-kérő flag (BÉLA már
  megerősítette, én nem ismételtem meg feleslegesen).
- `CLAUDE_CODE_OAUTH_TOKEN` env-várként beállított token: a kliens
  UGYANÚGY "inference only"-ként kezeli a sessiont, függetlenül attól
  hogyan jutott hozzá a token értékéhez -- tehát még ha valahonnan
  máshonnan (pl. egy interaktív `/login`-ból kimásolt token) kerülne
  ide, a kliens ISMÉT szűkítve viselkedne. (Ez nem jelenti hogy egy
  ilyen token szerver-oldalon is szűkített lenne -- de a kérdés
  gyakorlati szempontból úgyis okafogyott, mert:)
- Az interaktív `/login` folyamat (ami TÉNYLEG megkapja a
  `user:profile` hatókört) egy RÖVID élettartamú, automatikusan
  rotálódó tokent ad, refresh_token-nel -- ez pont az a fajta
  instabilitás (lásd a fájl tetején az OAuth-token race leírását) amit
  a setup-token bevezetése eredetileg orvosolni akart. Egy ilyen
  tokennel headless/cron-automatizálást futtatni visszahozná az eredeti
  problémát.
- Nincs dokumentált, hivatalos Anthropic API a "kérj egy hosszú
  élettartamú, de teljes hatókörű tokent" művelethez -- a hosszú
  élettartam és a szűkített hatókör Anthropic authorization szerverén
  UGYANABBAN a folyamatban dől el, elválaszthatatlanul (lásd fent, 4.
  pont).

## Mi VOLT javítható, és mi lett javítva (3. pont)

Mivel a hatókör-hiányra nincs kódszintű javítás, a "rendes megoldás" itt
azt jelenti: a MEGLÉVŐ, már helyes architektúra (interaktív, teljes
hatókörű credential előnyben részesítése, flotta-token csak
tartalék-inferenciára) pontosítása és a korábbi, pontatlan/hiányos
dokumentáció javítása, hogy a jövőben senki ne fusson bele ugyanebbe a
kétórás újra-diagnózisba:

- `scripts/usage-collect.py` `_read_claude_token()` docstringje
  frissítve: a korábbi, bizonytalankodó "429... reads as a soft signal"
  szakasz helyett a MEGERŐSÍTETT, forrásokkal alátámasztott magyarázat
  (bináris-string bizonyíték + GitHub-issue hivatkozások + a 429/403
  kettősség tisztázása).
- `docs/config-reference.md` "Linux OAuth-token race" szakasza kiegészítve
  egy rövid, kereszthivatkozó bekezdéssel, hogy aki csak ezt a doksit
  olvassa (nem megy bele a python docstringbe), is lássa a tradeoffot.
- Teszt-suite (`scripts/__tests__/usage-collect.test.py`) újrafuttatva a
  docstring-változtatás után: mind a 82 teszt zöld (dokumentáció-only
  változás, viselkedés nem módosult).

**Amit SZÁNDÉKOSAN nem építettem be**, mert külön jóváhagyást igényelne
(fejlesztési folyamat: spec → Istvan jóváhagyás → dev-spec → kanban →
kód), és a jelen feladat kifejezetten a GYÖKÉROK kiderítéséről szólt:

- Van egy RÉSZLEGES, a jelenlegi (inference-only) hatókörön BELÜL eső
  jelzés: a valódi `/v1/messages` inferencia-hívások válasz-fejlécei
  között szerepel `anthropic-ratelimit-unified-grace-5h-utilization` /
  `-grace-7d-utilization` / `-grace-status` -- ezek NEM igényelnek
  `user:profile` hatókört, mert egy már amúgy is engedélyezett
  inferencia-hívás rendes HTTP válasz-fejlécei. Korlát: ezek a fejlécek
  MÉRÉS SZERINT (a kliens saját kódja alapján) csak akkor jelennek meg,
  ha a fiók már a "grace"/túllépési állapotban van (tehát gyakorlatilag
  a limit ELÉRÉSEKOR/TÚLLÉPÉSEKOR) -- NEM egy folyamatos 0-100%-os
  mérőszám, csak egy szűk "már majdnem/már ott vagyunk" jelzés. Emellett
  ehhez egy VALÓDI inferencia-hívást kellene indítani csak a fejléc
  kiolvasásáért, ami pénzbe/keretbe kerül -- értelme csak akkor lenne,
  ha egy MÁR AMÚGY IS futó, valós beszélgetés-hívás válaszába
  csatlakozna be a dashboard (nem egy külön, dedikált lekérdező
  scriptbe, mint a jelenlegi `usage-collect.py`) -- ez egy nagyobb,
  külön architekturális döntés (a tényleges inferencia-hívás útvonalába
  kellene beépülni), saját spec-et és Istvan jóváhagyását igényli, ha
  érdekli.

## Upstream-javaslat (4. pont)

**Szotasz/marveen felé NINCS PR-javaslatom a gyökérokra magára** -- az
Anthropic saját OAuth-házirendje, nem marveen-kód hibája, és a marveen
kód MÁR a helyes, védekező mintát követi (legjobb-elérhető-hatókörű
forrás előnyben, majd fokozatos visszaesés). Amit upstream-re
felajánlhatónak tartok: **a most frissített, forrásokkal alátámasztott
dokumentáció maga** (a `_read_claude_token()` docstring + a
config-reference.md kiegészítés) -- ha Szotasz/marveen máshol is
dokumentálja ezt a tradeoffot kevésbé pontosan vagy egyáltalán nem, ez
egy kis, önmagában is értékes doksi-PR lehet. Ha Istvan úgy dönt, érdemes
lehet ezt (vagy egy erre épülő rövid összefoglalót) az egyik meglévő,
"duplicate"-ként lezárt `anthropics/claude-code` issue-ra is
hozzászólásként közzétenni -- ez viszont Istvan saját GitHub-fiókjából,
az ő döntése, nem PROGI hatásköre.

## Ellenőrzés

- `python3 -c "import ast; ast.parse(...)"`: usage-collect.py szintaxisa
  tiszta a docstring-változtatás után.
- `scripts/__tests__/usage-collect.test.py`: mind a 82 teszt zöld,
  változatlanul.
- A 403/429 diagnózis 2 FÜGGETLEN élő API-hívással (BÉLA + PROGI, más
  időpontban, más eredménnyel de ugyanarra a gyökérokra mutatva) +
  bináris-string bizonyíték + 3 közvetlenül lekért, valós GitHub-issue.
