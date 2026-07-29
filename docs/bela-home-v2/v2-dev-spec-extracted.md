BÉLA HOME v2
Fejlesztői és rendszerarchitekturális specifikáció
Hordozható, hangvezérelt háztartási és konyhai asszisztens

Dokumentumverzió
1.1
Dátum
2026. július 24.
Állapot
Fejlesztési alapdokumentum – jóváhagyott funkcionális hatókör
Kapcsolódó dokumentum
Béla Home v2 – Felhasználói és funkcionális dokumentáció
Célkörnyezet
HP / WSL2, elkülönített "Ubuntu-BelaHome" disztribúció jelenlegi és aktív cél; Linux amd64 és ARM64 hordozhatóság megtartva; Raspberry Pi -- jövőbeli, jelenleg NEM aktív cél (lásd 34. szakasz, Jövőbeli mérföldkövek)
Elsődleges olvasók
BÉLA, Codex, fejlesztő, tesztelő, rendszerüzemeltető

Dokumentumhasználati szabály
Ez a dokumentum normatív fejlesztési alap. Új funkció, szolgáltató vagy architekturális eltérés csak külön döntés és dokumentált módosítás után kerülhet a megvalósításba. A mérföldköveket nem szabad összevonni pusztán a gyorsaság kedvéért.

Verziótörténet
1.0 (2026-07-23) – Első jóváhagyott alapdokumentum.
1.1 (2026-07-24) – Döntés: a Raspberry Pi mérföldkő (korábbi M15) kikerül az aktív tervből, jövőbeli/nem aktív fejezetbe kerül; a mérföldkő-számozás ennek megfelelően igazítva (korábbi M16 -> M15). Új szakasz: WSL2-izolációs architektúra (elkülönített "Ubuntu-BelaHome" disztribúció, kétirányban zárt hozzáférés a fő BÉLA-rendszertől). A hordozhatósági követelmény (6. szakasz) változatlan marad. Kizárólag dokumentáció-frissítés; kód vagy migráció ebben a verzióban nem történt.


0. Dokumentumirányítás, jelölések és változáskezelés
A specifikáció célja, hogy a jelenlegi gyors prototípusból fokozatosan, tesztelhetően és visszagörgethetően épüljön fel a Béla Home v2. A dokumentum nem egyszerű ötletlista: komponenseket, adatsémákat, API-szerződéseket, biztonsági szabályokat és mérföldkő-kapukat határoz meg.
0.1. Normatív kifejezések
Jelölés
Jelentés
MUST / KELL
Kötelező követelmény. Nem tekinthető késznek a mérföldkő, ha nem teljesül.
MUST NOT / TILOS
Kifejezetten tiltott megoldás vagy viselkedés.
SHOULD / AJÁNLOTT
Erősen javasolt; eltéréshez dokumentált indok szükséges.
MAY / LEHET
Opcionális, a magfunkciót nem blokkolja.
P0 / P1 / P2
Kritikus, fontos, illetve későbbi prioritás.

0.2. Módosítási folyamat
1. Az igény vagy probléma bekerül a döntési naplóba rövid indoklással.
2. Meg kell jelölni, hogy érinti-e az adatmodellt, API-t, biztonságot, kompatibilitást vagy mérföldkő-sorrendet.
3. Architekturális változásnál külön ADR (Architecture Decision Record) készül.
4. A módosítás csak elfogadási feltétellel és tesztesettel együtt kerülhet fejlesztésbe.
5. A dokumentum verziószáma és változásjegyzéke frissül.
0.3. Tartalomjegyzék
1. Vezetői műszaki összefoglaló
21. Receptkereső
2. Hatókör, alapelvek és nem célok
22. Tápérték- és makrómotor
3. Kiinduló v1 állapot és migrációs stratégia
23. Lépésenkénti főzési munkamenet
4. Architekturális döntések
24. YouTube, zene és reggeli briefing
5. Célarchitektúra és komponensek
25. Időjárás
6. Technológiai stack
26. PWA, offline és push
7. Repository és kódszerkezet
27. Adminisztrációs felület
8. Konfiguráció és titokkezelés
28. Biztonság és adatvédelem
9. Adatmodell és SQLite séma
29. Megfigyelhetőség, mentés és üzemeltetés
10. API-szabvány és hibamodell
30. Teljesítmény és erőforrás-keretek
11. Hitelesítés, jogosultság és eszközpárosítás
31. Tesztelési stratégia
12. SSE, események és kliensállapot
32. CI/CD és kiadási folyamat
13. Scheduler, heartbeat és háttérfeladatok
33. Telepítés és WSL2-izoláció (Raspberry Pi: lásd 34. szakasz, jövőbeli)
14. Hangkommunikáció
34. Mérföldkövek, apró fejlesztési lépések és jövőbeli (nem aktív) mérföldkövek
15. AI-orchestráció és tool calling
35. Kockázati nyilvántartás
16. Tartós családi memória
36. Definition of Done és végső elfogadás
17. Faliújság, időzítők és emlékeztetők
A. API-katalógus
18. Google Calendar
B. Eseménykatalógus
19. Gmail
C. Job-katalógus
20. Google Keep és bevásárlólista
D. Források és kutatási döntések

1. Vezetői műszaki összefoglaló
A Béla Home v2 nem mikroservice-rendszer és nem a fő BÉLA másolata. Egy helyben futó, moduláris monolit, amely a háztartási állapotot, háttérfeladatokat és integrációkat önállóan kezeli. A tabletes webalkalmazás a kezelőfelület; a szerver az állapot és a megbízható végrehajtás forrása.
Fő döntés
A v1 prototípus befagyasztandó és referenciaként megőrzendő. A v2 ugyanazon a WSL2 gépen, külön projektként és külön porton épül. Funkciónkénti migráció történik; nincs „egy hétvége alatt teljes átírás”.

ARCH-001
MUST
Moduláris monolit
Egyetlen telepíthető szerveralkalmazásban, világos modulhatárokkal kell megvalósítani a rendszert. Külső Redis, MongoDB vagy Kubernetes nem kerülhet az alapverzióba.

PORT-001
MUST
Platformfüggetlenség
Az alkalmazásmag nem hivatkozhat WSL-, Windows- vagy fő-BÉLA-specifikus fájlutakra és folyamatokra. Linux amd64 és ARM64 környezetben azonos kóddal kell futnia.

STATE-001
MUST
Szerveroldali igazságforrás
Memória, timer, emlékeztető, receptmunkamenet, shopping lista, integráció és beállítás szerveroldali SQLite-ban él. localStorage csak gyorsítótár lehet.

AI-001
MUST
Determinista műveletvégrehajtás
Az LLM nem hajthat végre közvetlenül műveletet és nem írhat nyers JSON alapján kliensoldali mellékhatást. Tool call → szervervalidáció → jogosultság → tranzakció → technikai visszaigazolás sorrend kötelező.

VOICE-001
MUST
Hang elsődleges prioritása
A fejlesztési sorrendben a stabil magyar hangkommunikáció megelőzi a látványos extra funkciókat.

1.1. Ajánlott magas szintű stack
Réteg
Ajánlott technológia
Indok
Backend
Node.js 24 LTS + TypeScript strict + Fastify 5
A jelenlegi Node-környezethez közel marad; Fastify sémakezelése és naplózása alkalmas moduláris API-ra.
Frontend
React + TypeScript + Vite + PWA
A komplex admin, élő kártyák és állapotgépek karbantarthatóbbak komponensalapon.
Adatbázis
SQLite 3 + Drizzle ORM + migrációk
Egy fájl, tranzakció, Raspberry Pi-kompatibilitás, nincs külön DB-szerver.
Valós idejű UI
SSE + REST; hanghoz WebRTC
SSE egyszerű és megbízható szerver→kliens frissítésre; WebRTC alacsony késleltetésű hangra.
Háttérmunka
Saját SQLite-alapú job runner + idempotens worker
Nem kell Redis; egyháztartásos környezetben elegendő és újraindításbiztos.
Keresés
Brave Search adapter + engedélyezett domainek
A Google Custom Search új ügyfeleknek lezárt; a provider interfész cserélhető marad. [S24][S25]
Tápérték
USDA FoodData Central API + cache
Hivatalos, REST API, közkinccsé tett adatok; magyar normalizáció külön rétegben. [S22][S23]


2. Hatókör, alapelvek és nem célok
A rendszer fő szerepe: hangvezérelt családi faliújság, napi asszisztens és forrásalapú főzési segéd. A hatókör tudatos korlátozása fontosabb, mint a funkciók számának növelése.
2.1. Kötelező funkcionális területek
Természetes magyar hangkommunikáció: push-to-talk → VAD → Realtime fokozatos bevezetés; megszakítható válasz.
Tartós családi memória: megtekinthető, kézzel szerkeszthető, visszavonható, forrással és módosítási előzménnyel.
Faliújság: naptár, emlékeztető, timer, családi üzenet, időjárás és napi állapot.
Google-integrációk: Calendar és Gmail közvetlen OAuth kapcsolattal; Keep képességfüggő exporttal.
Receptmód: csak ellenőrzött külső receptek, 3–6 variáció, megadott alapanyagok alapján.
Tápérték: teljes és adagonkénti kcal, fehérje, szénhidrát, zsír; bizonytalanság jelölése.
Főzési munkamenet: lépésenkénti hangos vezérlés, szerveroldali folytathatóság és timerkapcsolat.
Szórakozás: valódi YouTube-keresés, beszélgetés, AC/DC háttérzene a briefing alatt.
Hordozhatóság: jelenlegi WSL2 használat, későbbi Raspberry Pi / mini PC telepítés.
2.2. Kizárt funkciók
Vonalkódolvasó és teljes hűtőkészlet-nyilvántartás.
Notion-export, általános vállalati workflow és Kanban.
Okosotthon-platform és eszközvezérlés.
Kényszerített profilválasztó minden beszélgetés előtt.
AI által kitalált recept, link, mennyiség vagy tápérték.
Claude vagy DeepSeek hanglánc az alapverzióban; a szolgáltatói absztrakció maradhat, implementáció nem prioritás.
ElevenLabs hangklónozás a stabil rendszer előtt; csak utolsó fázis.
Többháztartásos SaaS, licencelés, központi felhős admin az otthoni pilot előtt.
Termékhatár
A „háztartási asszisztens” nem jelent korlátlan rendszerhozzáférést. Fájltörlés, kódfuttatás, pénzügyi művelet, vásárlás és önálló külső művelet tiltott.

3. Kiinduló v1 állapot és migrációs stratégia
A jelenlegi v1 értékes prototípus: igazolta a felületet és az igényeket, de a localStorage, megosztott JSON-fájlok, egyfájlos frontend, informális heartbeat és hitelesítés nélküli LAN API nem alkalmas végleges alapnak. [I02]
v1 elem
v2 döntés
Migráció
public/index.html (~1700 sor)
Komponensalapú React alkalmazás
A dizájn és UX minták újrahasznosíthatók; a globális JS nem másolandó át egyben.
server.js (~550 sor)
Moduláris Fastify backend
Az integrációs részletek referenciaértékűek, de útvonalanként új szerződéssel kerülnek át.
localStorage shopping/timers/chat
SQLite szerveroldali állapot
Egyszeri export/import segéd; localStorage csak cache.
store/kitchen-*.json
SQLite táblák + migráció
Import előtt felülvizsgálat, duplikáció- és kitalált adat-szűrés.
fő BÉLA heartbeat
saját scheduler és közvetlen API-k
A fő BÉLA csak opcionális connector marad.
plain HTTP, LAN auth nélkül
HTTPS + eszközpárosítás + admin session
A v2 már az első használható kiadás előtt védi a módosító végpontokat.
nyers modell-JSON a kliensnek
szerveroldali tool schema + domain command
Nincs kliensoldali AI-mellékhatás.

3.1. Párhuzamos v1/v2 működés
Javasolt átmeneti topológia
Béla Home v1: http://<host>:3421   # csak kritikus javításBéla Home v2: https://bela-home.local:3422Adatirány:v1 export -> ellenőrzött migráció -> v2 SQLitev2 adat soha nem szinkronizál vissza automatikusan a v1-be.

A v1 kapjon Git taget és írásvédett biztonsági mentést.
A v2 első mérföldkövei alatt a v1 tovább használható.
Funkciónként legyen cutover checklist és visszaállítási pont.
A végső átállás után a v1 legalább 30 napig read-only archívként maradjon meg.
4. Architekturális döntések (ADR összefoglaló)
ADR
Döntés
Indok
Állapot
ADR-001
Moduláris monolit
Kisebb üzemeltetési teher, egyetlen háztartás, Raspberry Pi erőforráskeret.
Elfogadva
ADR-002
SQLite mint elsődleges adatbázis
Tranzakciós, hordozható, egyfájlos backup, nincs külön szolgáltatás.
Elfogadva
ADR-003
SSE az alkalmazásfrissítésekhez
Egyirányú szerver→kliens eseményekre egyszerűbb a WebSocketnél. [S18]
Elfogadva
ADR-004
WebRTC a Realtime hanghoz
Alacsony késleltetés, böngészős audio, natív echo cancellation. [S01][S02]
Elfogadva
ADR-005
OpenAI az elsődleges hang- és AI-szolgáltató
Egy szolgáltatóval kevesebb késleltetés és hibapont; modellek konfigurálhatók.
Elfogadva
ADR-006
Saját persistent job runner
Redis nélküli újraindításbiztos háttérmunka.
Elfogadva
ADR-007
Közvetlen Google OAuth
Calendar/Gmail nem függhet a fő BÉLA heartbeatjétől. [S06–S14]
Elfogadva
ADR-008
Keep adapter + fallback
A Keep API vállalati fókuszú; személyes Gmailnél share/clipboard fallback kötelező. [S15–S17]
Elfogadva
ADR-009
Forrásalapú recept
Nincs generatív recept; JSON-LD Recipe kinyerés és ellenőrzött link. [S26]
Elfogadva
ADR-010
LLM csak orchestrátor
Strict tool schema, szervervalidáció, idempotens command. [S05]
Elfogadva

5. Célarchitektúra és komponenshatárok
A komponensek ugyanabban a szerverfolyamatban indulhatnak, de csak publikus interfészen keresztül kommunikálhatnak. Közvetlen adatbázis-hozzáférés a saját repository-rétegen kívül tilos.

Komponens
Felelősség
API Gateway
HTTP route-ok, auth, rate limit, request ID, hibamodell; üzleti logika nélkül.
Assistant Orchestrator
Beszélgetési kontextus, tool-katalógus, megerősítési politika, modelladapter.
Voice Module
STT/TTS fallback, Realtime session broker, voice state, barge-in események.
Household Module
Tagok, beállítások, faliújság, családi üzenetek.
Memory Module
Tartós tények, javaslat/confirm workflow, revízió és keresés.
Reminder/Timer Module
Persistens állapot, ütemezés, occurrence és értesítés.
Google Module
OAuth tokenek, Calendar sync, Gmail draft/send, Keep capability check.
Recipe Module
Keresőadapterek, fetch/extract, normalizálás, rangsorolás, cache.
Nutrition Module
FDC mapping, egységkonverzió, számítás, bizonytalanság.
Cooking Session Module
Kiválasztott recept, lépésállapot, timerkapcsolat és folytatás.
Event Hub
Domain event → transactional outbox → SSE/Web Push.
Scheduler
Job claim, lease, retry, dead-letter és rendszeres feladatok.
Admin Module
Konfiguráció, integrációs státusz, eszközök, mentés, audit.

BOUND-001
MUST NOT
Komponenshatár
Más modul tábláját közvetlen SQL-lel módosítani tilos. Minden írás domain service-en keresztül történik.

EVENT-001
MUST
Transactional outbox
Állapotváltozás és eseményközlés ugyanazon SQLite-tranzakcióban legyen rögzítve, hogy újraindításkor se vesszen el kliensfrissítés.

6. Technológiai stack és kompatibilitási szabályok
Terület
Választás
Szabály
Runtime
Node.js 24 LTS
A pontos patch verzió .nvmrc-ben és engines mezőben rögzítendő.
Nyelv
TypeScript, strict=true
noImplicitAny, exactOptionalPropertyTypes, noUncheckedIndexedAccess bekapcsolva.
Backend
Fastify 5
Route schema, pino log, plugin struktúra, /api/v1 prefix.
Validáció
Zod + generált OpenAPI
Ugyanaz a schema használható backendben és kliensben; LLM tool argumentum is ezen validálandó.
DB
SQLite WAL mode + Drizzle ORM
Foreign key ON, busy_timeout, migráció minden sémafrissítéshez.
Frontend
React + Vite + TypeScript
Komponenshatárok, route guard, responsive tablet UI.
Állapot
TanStack Query + kis UI store
Szerverállapot nem duplikálható tartósan kliens store-ban.
PWA
Manifest + Service Worker
Offline shell, push, verziózott cache; kritikus művelet nem csak SW timer.
Teszt
Vitest + Playwright
API Fastify inject, browser/device E2E, fixtures.
Kódminőség
ESLint + Prettier + typecheck
CI-ben kötelező; warning nem maradhat P0 modulban.

Verziószabály
A dokumentum major verziókat jelöl. A fejlesztés kezdetén a kompatibilis legfrissebb patch verziókat kell kiválasztani, majd package-lock.json-ban rögzíteni. Automatikus major frissítés tilos.

7. Repository- és kódszerkezet
Javasolt npm workspaces struktúra
bela-home-v2/├── apps/│   ├── api/                 # Fastify szerver│   │   └── src/│   │       ├── app.ts│   │       ├── config/│   │       ├── modules/│   │       │   ├── auth/│   │       │   ├── voice/│   │       │   ├── assistant/│   │       │   ├── memory/│   │       │   ├── reminders/│   │       │   ├── google/│   │       │   ├── recipes/│   │       │   └── admin/│   │       ├── infrastructure/│   │       │   ├── database/│   │       │   ├── jobs/│   │       │   ├── events/│   │       │   └── crypto/│   │       └── main.ts│   └── web/                 # React PWA│       └── src/│           ├── app/│           ├── features/│           ├── components/│           ├── api/│           └── service-worker/├── packages/│   ├── contracts/           # Zod sémák és API típusok│   ├── domain/              # közös domain típusok│   └── test-fixtures/├── migrations/├── deploy/│   ├── wsl/│   ├── raspberry-pi/│   └── docker/├── docs/├── package.json├── package-lock.json├── .env.example└── README.md

CODE-001
SHOULD
Fájlméret és felelősség
Új 500+ soros „mindent tudó” modul nem fogadható el. Egy fájl egy jól körülhatárolt felelősséget kapjon; kivételt dokumentálni kell.

CONTRACT-001
MUST
Megosztott szerződések
Kliens és szerver request/response sémái a packages/contracts csomagból származzanak; kézzel duplikált interfész tilos.

8. Konfiguráció, titkok és feature flag-ek
.env.example – titkok nélkül
NODE_ENV=developmentPORT=3422PUBLIC_BASE_URL=https://bela-home.local:3422DATA_DIR=./dataTIMEZONE=Europe/BudapestDEFAULT_LOCALE=hu-HUMASTER_KEY_FILE=./data/secrets/master.keyOPENAI_API_KEY=...OPENAI_TEXT_MODEL=gpt-4oOPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribeOPENAI_TTS_MODEL=gpt-4o-mini-ttsOPENAI_REALTIME_MODEL=gpt-realtimeBRAVE_SEARCH_API_KEY=...USDA_FDC_API_KEY=...GOOGLE_CLIENT_ID=...GOOGLE_CLIENT_SECRET=...FEATURE_REALTIME_VOICE=falseFEATURE_KEEP_API=falseFEATURE_ELEVENLABS=false

A `.env` nem kerülhet verziókezelésbe; az `.env.example` csak kulcsneveket tartalmaz.
A Google refresh token, API token és párosítási titok AES-256-GCM titkosítva tárolandó.
A master key külön fájlban, 0600 jogosultsággal vagy platform secret store-ban legyen.
Az admin felület csak „beállítva / nincs beállítva / utolsó ellenőrzés” állapotot mutat; teljes titkot soha.
Feature flag nélkül kísérleti funkció nem kapcsolható be az alap UI-ban.
SECRET-001
MUST NOT
Titok kliensre juttatása
Hosszú életű OpenAI-, Google-, Brave-, USDA- vagy ElevenLabs-kulcs nem kerülhet böngészőbe, localStorage-ba vagy logba.

9. Adatmodell és SQLite séma
Az adatmodell célja nem vállalati túltervezés, hanem a több eszközön egységes, újraindításbiztos és auditálható háztartási állapot. A táblák UUIDv7 vagy ULID azonosítót használjanak; Date.now() alapú ID tilos.

Tábla
Fő mezők
Szerep
households
id, name, timezone, locale, created_at
Egy telepítésben kezdetben egy aktív háztartás.
household_members
id, household_id, display_name, role, active
Személyhez kötött preferenciákhoz; nem kötelező mindig profilt választani.
settings
scope, scope_id, key, value_json, updated_at
Nem titkos konfiguráció; típusos kulcskatalógus.
devices
id, name, type, paired_at, last_seen_at, revoked_at
Tablet/telefon párosítás és push állapot.
sessions
id_hash, actor_type, actor_id, expires_at
Admin és eszköz session; nyers token nem tárolható.
integrations
provider, account_label, status, config_json, encrypted_tokens
OpenAI/Google/Search/Nutrition kapcsolatok.
memory_facts
id, subject_type, subject_id, category, value_json, status, source, confirmed_at
Szerkeszthető tartós családi memória.
memory_revisions
memory_id, old_value, new_value, actor, changed_at
Minden módosítás auditja és visszaállíthatósága.
conversations
id, device_id, member_id, status, summary, last_activity_at
Beszélgetési munkamenet.
messages
conversation_id, role, content, transcript, tool_refs, created_at
Utolsó üzenetek és összefoglalás.
reminders
id, text, schedule_type, schedule_json, status, owner_id
Egyszeri/ismétlődő emlékeztető definíció.
reminder_occurrences
reminder_id, due_at, state, delivered_at, acknowledged_at
Konkrét esedékességek.
timers
id, label, started_at, end_at, state, acknowledged_at
Persistens konyhai időzítő.
shopping_lists
id, name, status, keep_note_id
Alapértelmezett bevásárlólista.
shopping_items
list_id, text, normalized_name, quantity, unit, checked
Eszközök között azonnal szinkronizált tételek.
recipe_searches
id, input_json, status, created_at
Keresési munkamenet és paraméterek.
recipe_candidates
search_id, source_id, canonical_url, extracted_json, score, validation_state
3–6 valódi receptjelölt.
ingredient_mappings
normalized_name, fdc_id, confidence, reviewed
Magyar alapanyag → tápanyag rekord mapping.
nutrition_calculations
recipe_candidate_id, inputs_json, totals_json, confidence, calculated_at
Reprodukálható makrószámítás.
cooking_sessions
id, recipe_candidate_id, servings, current_step, state, overrides_json
Folytatható főzési munkamenet.
jobs
id, type, run_at, status, attempts, lease_until, payload_json
Persistens háttérfeladat.
outbox_events
id, type, aggregate_id, payload_json, created_at, published_at
Tranzakciós eseményközlés.
notifications
id, channel, target, payload_json, state, sent_at
Push/hang/email kézbesítés.
audit_log
actor, action, entity_type, entity_id, details_json, created_at
Biztonsági és admin audit.

9.1. SQLite üzemmód és integritás
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000.
Minden többlépéses domain művelet egy tranzakcióban fut.
Migráció sorszámozott, előre és – ahol biztonságos – visszafelé scriptet tartalmaz.
Adatbázisindításkor sémaellenőrzés; ismeretlen újabb séma esetén a szerver nem indul írható módban.
Napi online backup SQLite backup API-val vagy konzisztens checkpoint után készül.
DB-001
MUST
Nincs automatikus destruktív migráció
Oszlop/tábla törlés csak külön mentés, ellenőrzés és jóváhagyott migráció után történhet.

10. API-szabvány, verziózás és hibamodell
API alapkonvenció
GET /api/v1/healthPOST /api/v1/auth/pairing/startPOST /api/v1/auth/pairing/claimGET /api/v1/bootstrapGET /api/v1/events                 # SSEPOST /api/v1/assistant/turnsPOST /api/v1/voice/transcriptionsPOST /api/v1/voice/speechPOST /api/v1/voice/realtime/session...

Minden publikus route `/api/v1` alatt fut.
JSON request maximum alapértelmezésben 1 MB; audio külön multipart vagy stream útvonalon.
Minden válasz `X-Request-Id` azonosítót kap; a kliens hibajelentésben ezt mutatja.
Idempotens író route támogat `Idempotency-Key` fejlécet.
Időpontok UTC ISO-8601 formában tárolandók; UI a háztartás időzónájára konvertál.
Személyes adatok nem kerülhetnek URL query paraméterbe, ha body/header használható.
Egységes hibaformátum
{  "error": {    "code": "CALENDAR_CONFIRMATION_REQUIRED",    "message": "Az esemény időpontja nem egyértelmű.",    "retryable": false,    "requestId": "01J...",    "details": {      "candidates": ["2026-07-24T10:00:00+02:00"]    }  }}

HTTP
Használat
200/201
Sikeres olvasás/létrehozás.
202
Háttérben folytatódó, lekérdezhető művelet.
204
Sikeres törlés válaszbody nélkül.
400
Séma- vagy üzleti validációs hiba.
401/403
Nincs session / nincs jogosultság.
404
Nem található vagy nem hozzáférhető.
409
Idempotencia, verzióütközés, aktív állapotkonfliktus.
422
Értelmezett, de nem végrehajtható kérés.
429
Rate limit.
502/503/504
Külső szolgáltatás vagy timeout; retryable jelzéssel.

11. Hitelesítés, jogosultság és eszközpárosítás
A helyi hálózat nem tekinthető biztonsági határnak. A konyhai kliens korlátozott eszközsessiont kap; az admin felület külön admin sessiont igényel.
Szerep
Jogosultság
Admin
Minden beállítás, memória, integráció, eszköz, mentés és audit.
Háztartási eszköz
Chat, voice, faliújság, recept, timer, reminder, shopping; admin és titkok nélkül.
Gyerek/vendég mód
Olvasás, timer, időjárás, receptkeresés; Gmail send, memóriaírás és naptármódosítás korlátozott.
Main Béla connector
Opcionális gépi token, szűk belső API scope-okkal.

11.1. Párosítási folyamat
1. Admin a szerveren vagy már párosított admin eszközön 10 perces egyszer használatos kódot generál.
2. Az új tablet megadja a kódot és saját eszköznevet küld.
3. A szerver hosszú véletlen session tokent ad; csak hash kerül adatbázisba.
4. A session HttpOnly, Secure, SameSite=Strict cookie-ban vagy PWA biztonságos tokenstore-ban él.
5. Az admin oldalon bármely eszköz azonnal visszavonható.
AUTH-001
MUST
Adminjelszó
Adminjelszó Node crypto.scrypt használatával sózva és költségparaméterrel tárolandó. Egyszerű SHA hash tilos.

AUTH-002
MUST
CSRF
Cookie-alapú író route-ok origin ellenőrzést és CSRF tokent igényelnek.

12. SSE, eseményközpont és kliensállapot

A kliens induláskor `GET /api/v1/bootstrap` snapshotot kér.
Ezután `EventSource` kapcsolatot nyit `/api/v1/events` útvonalra. SSE lehetővé teszi, hogy a szerver oldalfrissítés nélkül küldjön új adatot. [S18]
Minden esemény kap monoton event ID-t és `stateVersion` értéket.
Újracsatlakozáskor a kliens `Last-Event-ID` alapján kérhet pótlást; ha a rés túl nagy, teljes bootstrap történik.
A komponensek csak saját slice-ukat frissítik; aktív hang vagy receptmunkamenet nem nullázódhat.
SSE eseményformátum
event: calendar.updatedid: 18452data: {  "stateVersion": 931,  "calendarId": "primary",  "changedEventIds": ["gcal_abc"]}# heartbeat komment 15 másodpercenként: keep-alive

SSE-001
MUST
Outbox publikálás
SSE esemény csak outbox rekordból publikálható. A sikeres kiküldés után `published_at` frissül.

13. Scheduler, „heartbeat” és háttérfeladatok
A független Béla Home-nak saját életciklus kell, de ez nem percenkénti LLM-hívás. A heartbeat determinisztikus scheduler, amely esedékességet, szinkront, retry-t és karbantartást végez.
Feladat
Stratégia
Cél
Timer dispatch
Következő end_at alapján in-memory timeout + 5 mp recovery sweep
Aktív kliensnél ±1 mp pontosság, restart után helyreállítás.
Reminder occurrence
5–15 mp sweep
Esedékes occurrence létrehozása/kézbesítése.
Calendar incremental sync
120 mp, syncToken
Napközbeni külső változás felismerése. [S10]
Google push channel renew
lejárat előtt
Későbbi publikus webhook módban; helyi-only telepítésnél polling.
Briefing generation
naponta 07:30 helyi idő
Időjárás + naptár + reminder + TTS cache.
Backup
naponta 03:00
DB + konfiguráció + checksum.
Outbox publish
1 mp vagy eseményjel
SSE/Web Push események kézbesítése.
Dead job retry
exponenciális backoff
Külső API átmeneti hibák.
Cleanup
naponta
lejárt session, cache, ideiglenes audio, régi log meta.

13.1. Job állapotgép
Persistens job lifecycle
pending -> running -> succeeded              |-> retry_wait -> pending              |-> dead_letterClaim feltétel:status IN ('pending','retry_wait')AND run_at <= nowAND (lease_until IS NULL OR lease_until < now)

Minden job típus idempotens vagy idempotency key-t használ.
A worker lease időt kap; process crash után másik ciklus visszaveheti.
Retry csak átmeneti hibára történik; validációs hiba azonnal dead-letter.
Admin oldalon látható a sikertelen job, hiba, próbálkozások és „újrapróbálás” gomb.
14. Hangkommunikáció – elsődleges termékfunkció
A hangmodul két szinten készül: először diagnosztizálható STT→text model→TTS pipeline, majd OpenAI Realtime/WebRTC. Az első szint fallbackként a Realtime után is megmarad.

14.1. Voice Stage A – stabil, turn-based pipeline
Fallback és diagnosztikai pipeline
MediaRecorder / Web Audio  -> VAD és max. felvételi idő  -> POST /voice/transcriptions  -> gpt-4o-transcribe (hu, glossary prompt) [S03]  -> Assistant Orchestrator / strict tools  -> gpt-4o-mini-tts stream [S04]  -> kliens AudioContext lejátszás

VAD 1,2–1,8 mp csend után zárja a turnt; adminban állítható.
Felvételi maximum alapérték 45 mp; hosszabb diktálás külön mód.
STT timeout 15 mp, egy retry csak hálózati/5xx hibára.
Az átirat mindig megjelenik, és egy érintéssel javítható újrafeldolgozás előtt.
TTS rövid, természetes magyar választ mond; hosszú tartalom képernyőn jelenik meg.
14.2. Voice Stage B – Realtime/WebRTC
A `gpt-realtime` modell valós idejű audio be- és kimenetet támogat WebRTC, WebSocket vagy SIP kapcsolaton. [S01]
A böngésző soha nem kap hosszú életű OpenAI API kulcsot. A backend rövid életű sessiont/call handshake-et hoz létre az aktuális OpenAI szerződés szerint. [S02]
A data channel eseményeit a kliens csak továbbítja; tool végrehajtás a backendben történik.
Barge-in esetén az aktuális TTS azonnal leáll, a szerver session state-je frissül.
WebRTC audio constraints: echoCancellation, noiseSuppression és autoGainControl képességdetektálással.
Realtime hibánál automatikus fallback Stage A-ra, a felhasználó egy rövid jelzést kap.
VOICE-010
MUST
Saját válasz visszahallása
A rendszer nem indíthat új turnt a saját TTS hangjára. Realtime AEC, TTS alatti wake pause és szerveroldali turn state együtt kötelező.

VOICE-011
MUST
iPad kompatibilitás
A push-to-talk és aktív beszélgetési mód iPad Air Safari/PWA környezetben is működjön. A wake word nem blokkolhatja az MVP elfogadását.

14.3. Hangminőségi mérőszámok
Metrika
Cél
Magyar átirat pontosság
20 előre definiált konyhai mondatból legalább 18 tartalmilag helyes csendes környezetben; legalább 16 elszívó mellett.
Turn latency – Stage A
beszédvég → első lejátszott hang p50 < 3,0 mp, p95 < 6,0 mp.
Turn latency – Realtime
beszédvég → első hang p50 < 1,5 mp, p95 < 3,0 mp.
Barge-in
közbeszólástól a TTS leállásáig < 350 ms célérték.
Helyreállás
hálózati hiba után UI < 2 mp alatt visszatér használható állapotba.

15. AI-orchestráció, promptok és tool calling
A modell feladata az értelmezés és a természetes válasz. A valós adatok és műveletek tulajdonosa a domain modul. A Realtime modell támogat function callingot, de structured outputs nem minden realtime útvonalon érhető el; ezért a backend validáció kötelező. [S01][S05]
Tool
Mellékhatás
Megerősítés
weather.get
nincs
nem kell
calendar.list
nincs
nem kell
calendar.create
külső írás
kell, ha dátum/címzett/ismétlődés nem teljesen egyértelmű
reminder.create
helyi írás
rövid visszaolvasás; explicit parancsnál nincs külön gomb
timer.create
helyi írás
nincs, azonnali visszajelzés
shopping.add
helyi írás
nincs
memory.propose
nincs közvetlen írás
mindig megerősítés vagy admin kézi mentés
gmail.createDraft
külső piszkozat
nincs, de címzett visszaolvasása
gmail.send
külső küldés
mindig explicit „küldd el” és engedélyezett címzett/prompt
recipe.search
külső olvasás
nincs
youtube.search
külső olvasás
nincs

Tool schema példa
{  "name": "timer.create",  "description": "Persistens háztartási időzítőt hoz létre.",  "strict": true,  "parameters": {    "type": "object",    "properties": {      "durationSeconds": {"type": "integer", "minimum": 1, "maximum": 86400},      "label": {"type": "string", "minLength": 1, "maxLength": 80}    },    "required": ["durationSeconds", "label"],    "additionalProperties": false  }}

A tool schema a contracts csomagból generálódik és a backend ugyanazzal a sémával validál.
A modell prompt nem tartalmazhat nyers OAuth tokent vagy API kulcsot.
A modell nem kaphat teljes családi memóriát minden turnben; csak releváns, jogosult tényeket.
A promptok verziózva legyenek `prompt_versions` vagy kódban konstans azonosítóval; logban csak verzió és tokenmennyiség jelenjen meg.
Költségkeret és modellnév adminból konfigurálható, de csak támogatott allowlist értékekkel.
16. Tartós családi memória
A memória nem „profilkitalálás”. Strukturált, látható és szerkeszthető ténykészlet, amely háztartásra vagy személyre vonatkozhat. A felhasználó kézzel hozzáadhat, módosíthat vagy törölhet minden elemet.
Mező
Leírás
subject_type
household vagy member.
subject_id
háztartás/tag azonosító.
category
food_like, food_dislike, ingredient_like, ingredient_avoid, allergy, diet, routine, preference, note.
value_json
típusos tartalom; például ingredient és strength.
status
proposed, confirmed, archived.
source
manual_admin, conversation_confirmed, imported_v1.
confidence
csak javaslatnál; megerősített tény nem pontszámként kezelendő.
valid_from / valid_to
időben változó preferenciákhoz.
created_by / updated_by
audit.

Memóriarekord példa
{  "subjectType": "household",  "category": "ingredient_avoid",  "value": {"ingredient": "gomba", "reason": "nem szeretik"},  "status": "confirmed",  "source": "manual_admin"}

Beszélgetésből a modell csak `memory.propose` javaslatot tehet.
Allergia, diéta és egészségre ható adat csak explicit admin mentéssel vagy egyértelmű megerősítéssel kerülhet be.
A „Mit tud rólunk Béla?” adminoldal kategória, személy, forrás és státusz szerint szűrhető.
Minden módosítás revision rekordot hoz létre; legalább 30 napig visszaállítható.
A chat retrieval első körben strukturált SQL-szűrés; vektoradatbázis nem szükséges.
Beszélgetési memória: utolsó N turn + szerveroldali összefoglaló; érzékeny üzenet retenció konfigurálható.
MEM-001
MUST NOT
Kitalált adat tiltása
Importált vagy modell által javasolt allergia/diéta nem válhat confirmed állapotúvá automatikusan.

17. Faliújság, időzítők és emlékeztetők
17.1. Faliújság snapshot
A `bootstrap` válasz tartalmazza a következő naptáreseményt, aktív timereket, mai emlékeztetőket, shopping összesítést, időjárást és aktív cooking sessiont.
A UI napszak szerint hangsúlyozhat, de elemet nem rejthet el teljesen admin beállítás nélkül.
A szerver minden változást SSE eseménnyel küld; a kliens nem pollolhat 60 másodpercenként teljes állapotot.
17.2. Timer követelmények
Timer szerveroldali `end_at` időponttal készül; a kliens csak visszaszámol.
Több párhuzamos timer, címke, pause/resume opcionális; pause esetén hátralévő idő tranzakcióban mentendő.
Lejáratkor outbox esemény, aktív klienshang és Web Push készül.
Nyugtázás idempotens; új eszközről is elvégezhető.
Restart után az elmúlt, nem nyugtázott timer azonnal riaszt „X perce lejárt” jelzéssel.
17.3. Emlékeztető követelmények
Egyszeri, napi, heti és iCalendar RRULE alapú ismétlődés támogatandó fokozatosan.
A reminder definíció és occurrence külön tábla; a múltbeli occurrence nem törlődik azonnal.
Snooze új occurrence-t hoz létre, nem írja át a történetet.
Kézbesítési csatorna: hang, PWA push, opcionális Gmail/Telegram fallback.
Csendes időszakban a nem sürgős hang elmarad, de kártya/push megmarad.
18. Google Calendar integráció
A Calendar közvetlenül a Béla Home-ból működik. A Google Calendar API eseményt `events.insert` hívással hoz létre; az eseményazonosító helyben tárolható a duplikáció elkerülésére. [S09]
Terület
Megoldás
OAuth
Web server authorization code flow, offline access és titkosított refresh token. [S06][S07]
Scope
`calendar.events` + szükség szerint `calendar.calendarlist.readonly`; a legszűkebb scope. [S08]
Naptárválasztás
Adminban olvasott naptárak és alapértelmezett írható naptár.
Létrehozás
Saját determinisztikus Google event ID/idempotency mapping.
Olvasás
Következő események helyi cache-be; időzóna helyesen.
Szinkron
Kezdeti full sync, majd `syncToken` inkrementális lekérés 2 percenként. [S10]
Push
Későbbi internetes HTTPS webhooknál `events.watch`; local-only eszközön polling. [S11]
Hibák
401 reauth, 410 sync token reset, 429/5xx backoff, conflict UI.

Eseménylétrehozás – kötelező tranzakciós sorrend
Felhasználó: „Vedd fel péntekre 10-re a fogorvost.”1. Parser: relatív dátum -> konkrét 2026-07-24 10:00 Europe/Budapest2. Orchestrátor visszaolvassa a konkrét dátumot.3. Ha nincs időtartam: alapérték vagy visszakérdezés.4. events.insert sikeres -> Google event ID mentése.5. Csak ezután: „Bekerült a naptárba.”6. SSE: calendar.updated.

GCAL-001
MUST NOT
Hamis siker tiltása
A rendszer nem mondhatja, hogy egy esemény bekerült, amíg a Google API nem adott sikeres választ és a helyi mapping nincs elmentve.

19. Gmail integráció
A Gmail API képes közvetlen küldésre és piszkozat létrehozására. A rendszer alapértelmezett biztonságos módja a piszkozat; közvetlen küldés csak explicit utasításra. [S12][S13]
Művelet
Scope
Szabály
Csak küldés
gmail.send
Érzékeny scope, de kisebb, mint teljes mailbox hozzáférés. [S14]
Piszkozat + küldés
gmail.compose
Szigorúbb/korlátozott scope; nyilvános terméknél ellenőrzési következmény lehet. [S14]
Bejövő levelek olvasása
nincs v2 alapban
Külön jóváhagyás nélkül nem kérünk readonly/full mailbox scope-ot.

MIME üzenet RFC-kompatibilis, base64URL kódolással kerül a Gmail API-hoz. [S12]
Engedélyezett címzettlista opcionális; ismeretlen címzettnél kötelező megerősítés.
Közvetlen küldés csak „küldd el” vagy egyenértékű explicit parancs után.
Audit log tartalmazza a címzettet, tárgyat, művelettípust és Gmail message/draft ID-t; levéltörzs nem szükséges teljesen az auditba.
Küldési hiba nem ismételhető vakon, ha a Google válasz státusza bizonytalan; idempotencia és message ID ellenőrzés kell.
20. Bevásárlólista és Google Keep
A bevásárlólista elsődleges példánya mindig a Béla Home SQLite-adatbázisa. A Google Keep export/szinkron adapter, nem az igazságforrás.
Keep mód
Feltétel
Viselkedés
Direct API
Az adott fiók/környezet ténylegesen támogatja és az OAuth scope engedélyezett.
`notes.create` list note vagy meglévő note frissítés; Keep API `https://www.googleapis.com/auth/keep` scope. [S16][S17]
Share sheet
Web Share API és Keep alkalmazás share target elérhető.
A lista strukturált szövegként megosztható; képességdetektálás.
Clipboard fallback
Mindig
Checklist szöveg másolása és Keep megnyitási útmutató.

Google Keep korlát
A hivatalos Keep API dokumentáció enterprise/admin környezetre fókuszál. A személyes Gmail támogatását nem szabad feltételezni; telepítéskor capability test dönt. [S15]

Lista CRUD szerveroldali; minden eszköz SSE-n kap frissítést.
Keep export egyirányú alapverzióban. Kétirányú szinkron csak külön mérföldkő és konfliktuskezelés után.
Export rekord tárolja a note ID-t, export időpontját, módot és hibát.
Receptből hiányzó hozzávaló egy gombbal/voice parancsal adható hozzá, duplikáció-összevonással.
21. Többforrásos receptkereső
A receptmotor nem generál receptet. Legalább 3, legfeljebb 6 valódi receptvariációt keres a felhasználó által megadott alapanyagokra, több jóváhagyott forrásból.

21.1. Forrás- és keresőstratégia
Adminban engedélyezett domain registry: Mindmegette, Nosalty, GastroHobbi, Street Kitchen és további jóváhagyott források.
Keresőprovider interfész: `search(query, domains, limit, locale)`; első adapter Brave Search API, amely támogat `site:` operátort. [S24]
A Google Custom Search JSON API új ügyfeleknek lezárt és 2027-es kivezetésre jelölt, ezért nem lehet alapfüggőség. [S25]
Minden találat canonical URL és host allowlist alapján validálandó.
Keresés domainenként és kombinált queryvel; az eredmények forrásdiverzitását rangsorolás garantálja.
21.2. Biztonságos oldalbetöltés és kinyerés
Csak HTTPS, engedélyezett host, max. 3 redirect, végső host újbóli ellenőrzése.
DNS feloldás után private/link-local/loopback IP tiltás (SSRF-védelem).
10 mp connect+read timeout, max. 2 MB HTML, csak text/html.
User-Agent azonosítja az alkalmazást; robots.txt és forrás felhasználási feltételek tiszteletben tartandók.
Elsődleges parser: `<script type="application/ld+json">` Schema.org `Recipe`; a szabvány tartalmazhat ingredient, instruction, yield, time és nutrition mezőket. [S26]
Ha nincs Recipe JSON-LD, csak jóváhagyott forrásspecifikus adapter használható; általános LLM „scraping” nem.
Headless browser alapból tiltott; külön feature flag és erőforrásteszt szükséges.
21.3. Normalizálás és rangsorolás
Pontszámrész
Súly / szabály
Megadott fő alapanyagok lefedettsége
0–45 pont; pantry staple nem számít fő egyezésnek.
Hiányzó fő hozzávaló
0…−25 pont; mennyiség és szerep alapján.
Családi preferencia
−30…+20 pont; allergia/kerülendő alapanyag kizáró szabály lehet.
Elkészítési idő
0–10 pont az igényhez való közelség szerint.
Táplálkozási cél
0–15 pont, csak kiszámított vagy forrásból hiteles adatnál.
Forrásminőség és teljesség
0–10 pont; ingredient, yield, steps, canonical link.
Diverzitás
azonos étel/forrás duplikáció levonás; legalább 2 külön forrás, ha lehetséges.

REC-001
MUST
Találati minimum/maximum
Sikeres kereséskor 3–6 validált receptkártya jelenjen meg. Kevesebb találatnál a rendszer őszintén jelzi a számot és nem generál pótlást.

REC-002
MUST
Forrásintegritás
A felhasználó által megnyitott URL pontosan az a canonical URL legyen, amelyből az adatok kinyerésre kerültek.

22. Tápérték- és makrószámító motor
A GPT nem számolhat bemondásra tápértéket. A motor a recept pontos hozzávalóit normalizálja, tömegre konvertálja, hiteles adatbázishoz mapeli és reprodukálható képlettel összegez.
22.1. Adatforrás és licenc
A FoodData Central REST API fejlesztői tápanyag-hozzáférést biztosít. [S22]
Az USDA FDC adatai public domain / CC0 jelleggel használhatók; a forrás feltüntetendő. [S23]
A FDC API-válaszok lokálisan cache-elhetők `fdc_id` és adatverzió szerint.
Magyar megnevezés → angol keresőkifejezés → FDC rekord mapping külön táblában, admin felülvizsgálattal.
22.2. Számítási képlet
Determinista képlet
ingredient_nutrient = edible_grams * nutrient_per_100g / 100recipe_total = sum(ingredient_nutrient)per_serving = recipe_total / servingsKötelező eredmények:- energy_kcal- protein_g- carbohydrate_g- fat_gOpcionális később:- fiber_g, sugar_g, saturated_fat_g, sodium_mg

22.3. Mennyiség- és bizonytalanságkezelés
Eset
Szabály
Pontos gramm/ml
Közvetlen konverzió sűrűség/egységtábla alapján.
Darab / fej / gerezd
Átlagos tömeg mapping, „becsült” jelzéssel; admin felülírható.
„ízlés szerint”
Nem számítható mennyiség; hiányként jelölni.
Olaj sütéshez
Felhasznált vs. elfogyasztott mennyiség bizonytalan; külön figyelmeztetés.
Nyers/főtt állapot
Eltérő FDC rekord; parsernek explicit állapotot kell keresnie.
Adag hiányzik
Felhasználói megerősítés nélkül csak teljes étel számítható.
Alacsony mapping confidence
UI kiválasztást kér; automatikus végleges számítás tilos.

Pontossági szint
Feltétel
UI
A – jó
≥95% kalória-hozzájárulás pontos mennyiséggel és reviewed mappinggel.
„Pontosabb számítás”
B – becsült
80–95% vagy darab/kanál konverzió.
„Becsült” + bizonytalan elemek
C – gyenge
<80%, több hiányzó mennyiség.
Nincs egyetlen pontos szám; tartomány vagy „nem számítható”

NUT-001
MUST
Reprodukálhatóság
A nutrition_calculation tárolja a bemeneteket, mapping IDs-t, tápanyagértékeket, adagszámot és motorverziót, hogy ugyanaz a számítás újra előállítható legyen.

Egészségügyi határ
A rendszer tájékoztató becslést ad, nem orvosi vagy dietetikusi tanácsot. „Egészséges” címke nem képezhető kizárólag kalóriából.

23. Lépésenkénti főzési munkamenet
A felhasználó kiválaszt egy validált recipe_candidate rekordot, beállítja az adagot és módosításokat.
A szerver snapshotot készít a felhasznált receptadatokról, hogy a forrásoldal változása ne törje meg az aktív főzést.
A cooking session tárolja az aktuális lépést, adagot, ingredient override-okat, aktív timereket és státuszt.
Hangparancsok: „következő”, „ismételd”, „előző”, „állj”, „mennyi van hátra?”, „indíts 12 percet”, „300 gramm csirkét használok”.
Mennyiségmódosítás új nutrition calculationt hoz létre; régi eredmény megmarad auditként.
Oldalbezárás vagy másik eszköz esetén a session folytatható; egyszerre egy aktív szerkesztő lease ajánlott.
A forrás recept szövegét nem szabad AI-val észrevétlenül átírni; módosítás külön „saját változtatás” mező.
Főzési állapotgép
cooking_session.state:selected -> active -> paused -> completed                   |-> abandonedstep transition:next csak current_step + 1previous csak current_step - 1clientVersion eltérésnél 409 SESSION_VERSION_CONFLICT

24. YouTube, zene és reggeli briefing
24.1. YouTube keresés
Elsődleges megoldás YouTube Data API `search.list`, `type=video`, `relevanceLanguage=hu`, `regionCode=HU`, safeSearch beállítással. [S27]
Találat: video ID, cím, csatorna, thumbnail, ellenőrzött watch URL.
API quota elfogyásakor egyszerű YouTube keresési URL fallback, de a rendszer nem állíthatja, hogy konkrét videót talált.
Autoplay alapból tiltott; felhasználói érintés indítja a videót.
24.2. Reggeli briefing AC/DC háttérzenével
Scheduler naponta 07:30-kor összeállítja: időjárás, mai naptár, emlékeztetők, fontos faliújság-tételek.
A szöveg generálásához LLM használható, de minden bemeneti adat strukturált és időbélyeges.
AC/DC „Back in Black” háttérzene megmarad, külön admin hangerővel és kikapcsolási lehetőséggel.
A beszéd alatt a zene automatikusan halkul (ducking), a beszéd végén fade-out.
YouTube embed korlát vagy offline esetén a briefing zene nélkül is lejátszódik.
A briefing 22:00-ig érvényes; később a UI „mai összefoglaló archív” jelzést mutat.
24.3. ElevenLabs – utolsó fázis
Provider interface előkészíthető, de API, UI és voice cloning csak M15 (családi pilot, korábban M16) utáni opcionális mérföldkő.
Csak bizonyítható hozzájárulással és jogszerű hangmintával engedélyezhető.
Fallback mindig marad OpenAI TTS-re.
25. Időjárás és napi információk
Provider adapter: elsődleges Open-Meteo vagy más engedélyezett szolgáltató; a korábbi wttr.in nem legyen egyetlen függőség.
Cache: aktuális állapot 10 perc, előrejelzés 30 perc; stale-while-revalidate.
Hiba esetén az utolsó ismert adat „frissítve: …” idővel jelenik meg.
Chat válasz ugyanazt a WeatherService adatot használja, mint a widget; nincs hardcoded Budapest a promptban.
Adminban város/geokoordináta és mértékegység beállítható.
26. PWA, offline működés és Web Push
Manifest: név, ikonok, display=standalone, theme color és stabil app ID. [S21]
Service Worker verziózott app shell cache-t biztosít; API-adatot nem cache-el korlátlanul.
Offline módban megnyitható a felület, látható az utolsó snapshot, shopping lista módosítás queue-zható; Calendar/Gmail/AI művelet egyértelműen nem elérhető.
Push API és Service Worker használható háttérértesítésre. [S19]
iOS/iPadOS web push csak Home Screenre telepített webappnál támogatott; onboarding ezt ellenőrzi és elmagyarázza. [S20]
Kritikus timer/reminder nem bízhat kizárólag böngésző JavaScript timerben; a szerver a forrás.
PWA-001
MUST
Cache frissítés
Új verzió csak akkor aktiválható, amikor nincs aktív hangfelvétel vagy főzési lépés mentetlen kliensállapottal. A UI „frissítés elérhető” jelzést ad.

27. Adminisztrációs felület
A független telepítéshez az admin nem extra. A rendszer konfigurálható kell legyen fájlszerkesztés és terminál nélkül, miközben a titkok nem jelennek meg a kliensnek.
Admin modul
Funkciók
Áttekintés
szerver, DB, scheduler, SSE, push, utolsó backup, API státusz
Háztartás
név, időzóna, nyelv, tagok, alapértelmezett város
Családi memória
lista, keresés, kézi hozzáadás, szerkesztés, törlés, revízió, import/export
Hang és AI
modellek allowlistből, hang, sebesség, VAD, Realtime flag, költségkeret
Google
OAuth connect/revoke, naptárak, default calendar, Gmail mód, Keep capability
Receptek
engedélyezett domainek, search provider, pantry staples, találatszám, cache
Táplálkozás
USDA key státusz, mapping review queue, mértékegységek, pontossági küszöbök
Értesítések
push eszközök, csendes időszak, fallback csatornák
Eszközök
párosított kliensek, last seen, push állapot, visszavonás
Biztonság
adminjelszó, sessionök, audit, token rotáció
Mentés és visszaállítás
kézi backup, letöltés, restore dry run, retention
Rendszer
verzió, frissítés, logok, dead jobs, diagnosztikai csomag

ADMIN-001
MUST
Titokmegjelenítés
Mentett titok értéke nem olvasható vissza az admin UI-n. Csak új érték megadása, státusz és törlés/rotáció engedélyezett.

ADMIN-002
MUST
Memória szerkesztés
A teljes tartós családi memória az adminban emberileg olvasható és szerkeszthető legyen; változásnaplóval.

28. Biztonság és adatvédelem
Terület
Követelmény
Transport
HTTPS kötelező LAN-on is; HSTS csak stabil cert után. Dev localhost lehet HTTP.
Headers
CSP, frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
XSS
React escape alapból; külső HTML nem renderelhető; markdown sanitization.
CSRF
SameSite cookie + CSRF token + Origin ellenőrzés.
Rate limit
voice/chat/search/email és auth route külön limit.
SSRF
recipe fetch DNS/IP ellenőrzés, host allowlist, redirect kontroll.
Secrets
AES-256-GCM, master key külön, log redaction.
OAuth
refresh token titkosítva, revoke/expiry kezelve; Google best practice szerint biztonságos hosszú távú tárolás. [S07]
Audit
admin, memória, Gmail send, Calendar write, device revoke, restore események.
Adatminimalizálás
csak szükséges Google scope; Gmail olvasás nincs alapban.
Remote access
alapból tiltott; internetre nyitás külön biztonsági terv nélkül tilos.
Gyerek/vendég
korlátozott műveletek és explicit send/memory tiltás.

Személyes adatok
A családi preferencia, rutin, naptár és beszélgetés érzékeny háztartási adat. Export, törlés, mentés és retention adminból kezelhető legyen.

29. Megfigyelhetőség, mentés és üzemeltetés
29.1. Health és log
Endpoint
Tartalom
/health/live
process él; külső API-t nem hív.
/health/ready
DB migráció, master key, scheduler, szükséges config.
/health/deps
OpenAI/Google/Search/FDC utolsó ellenőrzés és latencia; admin only.
/metrics
opcionális Prometheus formátum vagy belső aggregátum; admin only.

Strukturált pino JSON log: timestamp, level, requestId, module, event, durationMs, errorCode.
PII és token redaction; audio és teljes prompt alapból nem logolható.
Rendszerlog rotáció: systemd journald vagy max méret/nap retention.
Admin diagnosztikai csomag anonimizált configgal, health-snapshot és utolsó hibákkal.
29.2. Backup és restore
Napi automatikus backup: SQLite, titkosított integration tokenek, beállítások és manifest; ideiglenes audio/cache nem.
Backup fájl külön könyvtárba, checksum és verzió meta; alap retention 14 napi + 8 heti.
Opcionális második hely: NAS/USB/Drive – külön adapter.
Restore mindig dry-run ellenőrzéssel: fájl integritás, séma verzió, szabad hely.
Restore előtt automatikus pre-restore backup.
Negyedévente legalább egy tényleges visszaállítási teszt.
30. Teljesítmény- és erőforrás-keretek
Metrika
Cél / korlát
Cél hardver
Jelenlegi aktív cél: amd64 WSL2, elkülönített Ubuntu-BelaHome disztribúció (33. szakasz). Raspberry Pi 5 4 GB, SSD -- jövőbeli, jelenleg nem aktív cél (F1, 34. szakasz); a becslés az erőforrás-keretek távlati referenciájaként megmarad.
Idle memória
API + web + scheduler összesen cél < 450 MB.
Idle CPU
< 5% átlag Pi 5-ön, külső syncen kívül.
Bootstrap
< 500 ms helyi hálózaton 95. percentilis, külső frissítés nélkül.
SSE frissítés
domain commit → aktív kliens UI < 2 mp.
DB
tipikus háztartási méret < 1 GB többéves chatretention nélkül.
Külső fetch
recipe oldal 10 mp timeout, max 2 MB; párhuzamosság 3–5.
Voice
lásd 14.3 mérőszámok.
Backup
< 60 mp tipikus DB-nél, szolgáltatás leállítása nélkül.

31. Tesztelési stratégia
Szint
Kötelező tartalom
Unit
domain szabály, időzóna, RRULE, rangsorolás, unit conversion, nutrition formula, auth helpers.
Repository
SQLite in-memory/temp DB, migrációk, tranzakció és concurrency.
Contract/API
Zod séma, Fastify inject, auth/CSRF/rate limit, error codes.
Integration
OpenAI/Google/Brave/FDC mock server; retry, timeout, 401, 429, 5xx.
E2E
Playwright: pairing, chat, timer, reminder, memory edit, recipe search, cooking resume.
Device
Galaxy A17 és iPad Air; mikrofon, TTS, PWA, sleep/wake, push.
Audio corpus
magyar konyhai mondatok csendben, vízcsap és elszívó mellett; regressziós pontozás.
Security
SSRF, XSS, CSRF, brute force, revoked device, secret leakage.
Recovery
process kill timer közben, DB restore, token revoke, network outage.

31.1. Minimális tesztadat-készlet
Legalább 20 magyar hangmondat időzítő/naptár/recept/memória témában.
10 relatív dátum: ma, holnap, jövő péntek, két hét múlva, óraátállítás környéke.
20 recept ingredient string: gramm, ml, darab, kanál, „ízlés szerint”, tartomány.
5 családi memória konfliktus és visszavonás.
Google mock: token expiry, syncToken 410, quota 429, insert timeout utáni idempotencia.
TEST-001
MUST
Hibajavítás regresszió
Minden javított P0/P1 hiba kap automatikus regressziós tesztet vagy dokumentált device testet, ha automatizálás technikailag nem ésszerű.

32. CI/CD, verziózás és kiadási folyamat
Git main branch védett; minden változás pull request vagy dokumentált Codex branch.
CI: npm ci, lint, typecheck, unit, integration, web build, Playwright smoke.
ARM64 hordozhatóság (6. szakasz szerint kötelező, WSL/Windows-specifikus logika nélkül): build/QEMU CI változatlanul fut minden mérföldkőnél. Valódi Pi smoke teszt jelenleg NEM aktív elvárás -- a Raspberry Pi telepítés F1-ként (34. szakasz) elhalasztva; ha ismét aktívvá válik, a valódi Pi smoke visszakerül a mérföldkövenkénti kapuba.
Semantic versioning: v2.0.0 első stabil otthoni kiadás; prerelease `2.0.0-alpha.N`.
DB migráció release része; indulás előtt automatikus backup.
Rollback csak akkor, ha a régi bináris kompatibilis az új sémával; különben restore szükséges.
Kiadási jegyzet: funkció, adatváltozás, új engedély, ismert korlát, rollback mód.
Kötelező CI kapu
quality gate:1. npm ci2. npm run lint3. npm run typecheck4. npm run test5. npm run test:integration6. npm run build7. npm run test:e2e:smoke8. npm audit --production (kritikus/high értékelés)9. artifact + checksum

33. Telepítés és WSL2-izoláció
Döntés (v1.1, 2026-07-24): a jelenlegi és aktív telepítési cél egy külön, elszigetelt WSL2-disztribúció ("Ubuntu-BelaHome") a fő BÉLA-rendszertől (amely "Ubuntu-Bela" disztribúción fut). A Raspberry Pi telepítés jövőbeli, jelenleg NEM aktív cél -- részletei a 34. szakasz "Jövőbeli, jelenleg nem aktív mérföldkövek" alfejezetében találhatók, nem itt.
33.1. WSL2 fejlesztési telepítés (általános)
Külön `/home/kisss/bela-home-v2` repository és saját node_modules/lockfile.
API port 3422; Caddy vagy más reverse proxy HTTPS helyi domainnel.
Systemd WSL támogatás esetén service unit; egyébként fejlesztésben npm script, de háttérbe tett `node &` nem végleges.
Windows portproxy csak deployment adapter; appkód nem ismeri.
Data dir külön, verziókezelésen kívül; napi backup Windows/NAS mappára opcionális.
33.2. WSL2-izolációs architektúra ("Ubuntu-BelaHome" disztribúció)
Cél: a Béla Home v2 fusson egy, a fő BÉLA-rendszertől ("Ubuntu-Bela" disztribúció) teljesen elkülönített WSL2-disztribúcióban ("Ubuntu-BelaHome"), egyirányú hozzáféréssel -- a fő BÉLA fejlesztőként be tud lépni a Béla Home rendszerbe, de a Béla Home futó szolgáltatása semmilyen irányban nem érheti el a fő BÉLA rendszert, projektjeit, configját vagy adatbázisát.
Két különálló Linux felhasználó az Ubuntu-BelaHome disztribúción belül:
`beladev` -- fejlesztői felhasználó. A fő BÉLA (mint fejlesztő) ezzel a felhasználóval léphet be a disztribúcióba. Tulajdonolja a forráskódot, futtathat build/deploy műveleteket.
`belahome` -- korlátozott szolgáltatás-felhasználó. Ez alatt fut maga a Béla Home v2 alkalmazás (API-szerver, scheduler, háttérfeladatok). NINCS sudo jogosultsága, és NEM írhatja a forráskód-könyvtárat -- csak a neki dedikált adat/futásidejű könyvtárakat.
Könyvtárszerkezet (Ubuntu-BelaHome disztribúción belül):
`/srv/bela-home/app` -- forráskód, `beladev` tulajdonában (a `belahome` szolgáltatás csak olvashatja, ha egyáltalán szüksége van rá futáskor).
`/var/lib/bela-home` -- SQLite adatbázis és egyéb futásidejű állapot, `belahome` tulajdonában.
`/etc/bela-home` -- konfiguráció és titkok (master key, env fájl), `belahome` tulajdonában, szűk jogosultsággal.
`/var/log/bela-home` -- naplók, `belahome` tulajdonában.
`/var/backups/bela-home` -- mentések, `belahome` tulajdonában (vagy külön backup-felhasználó, ha a mentési folyamat ezt indokolja -- implementációkor eldöntendő).
33.3. WSL biztonsági konfiguráció (wsl.conf)
Az Ubuntu-BelaHome disztribúció `/etc/wsl.conf` fájljában a következő beállítások kötelezők az izoláció betartatásához:
`interop=false` -- ne engedje Windows-oldali futtatható fájlok (pl. `wsl.exe`, `.exe` binárisok) közvetlen hívását a disztribúción belülről.
`appendWindowsPath=false` -- a Windows PATH-bejegyzések ne kerüljenek be a Linux PATH-ba (ne legyen véletlen Windows-oldali eszköz elérhető).
`automount=false` -- a Windows-meghajtók (`C:` stb.) ne kerüljenek automatikusan csatolásra `/mnt/` alá.
Ezek a beállítások kifejezetten az Ubuntu-BelaHome disztribúcióra vonatkoznak -- a fő BÉLA disztribúciója (Ubuntu-Bela) saját, ettől független konfigurációt tarthat meg.
33.4. Nyitott, jelenleg függő pontok
A következő pontok Istvánnal egyeztetés alatt állnak (BÉLA már jelezte, a válasz még függőben van) -- itt szándékosan NINCS kitalált megoldás, csak a nyitott kérdés rögzítve:
Az új WSL2-disztribúció tényleges létrehozása (`wsl --import` vagy Microsoft Store telepítés) Windows-oldali művelet, amit sem a fő BÉLA, sem a Béla Home fejlesztő ágens nem tud elvégezni a jelenlegi WSL-en belülről -- ez emberi (István által végzett) lépést igényel.
A meglévő `/home/kisss/bela-home-v2` munka (M1-M10 mérföldkövek, teljes forráskód és git történet) tényleges migrálása az új Ubuntu-BelaHome disztribúcióba, `beladev`/`belahome` felhasználói szétválasztással és a fenti könyvtárszerkezetre való átállással -- ez a WSL2-disztribúció létrehozása UTÁNI, külön lépés, ebben a dokumentumverzióban még nem ütemezett feladat.
Amíg ezek a pontok nyitottak, a tényleges migráció NEM indul el -- csak a dokumentáció készül elő rá.
33.5. Izolációs tesztek (a migráció UTÁN futtatandó ellenőrzőlista)
A következő teszteket a migráció lezárása után, éles beüzemelés előtt kötelező lefuttatni és dokumentálni:
`belahome` felhasználó nem tud sudo-t használni (jelszóval vagy anélkül sem).
`belahome` felhasználó nem tud írni a `/srv/bela-home/app` forráskód-könyvtárba.
Az Ubuntu-BelaHome disztribúcióból nem érhető el a Windows `C:` meghajtó, a `wsl.exe`, sem másik WSL-disztribúció.
A Béla Home v2 (sem `belahome`, sem `beladev` felhasználóként) nem fér hozzá a fő BÉLA projektjeihez, konfigurációjához vagy adatbázisához.
A fő BÉLA (fejlesztőként) be tud lépni az Ubuntu-BelaHome disztribúcióba `beladev` felhasználóként.
A Béla Home v2 és a fő BÉLA szolgáltatásainak portjai nem ütköznek.

34. Mérföldkövek és kis lépésekre bontott végrehajtás
A becslések egy AI-val támogatott, de ellenőrzött fejlesztési folyamat nagyságrendjei. Nem határidőígéretek. Minden mérföldkő külön branch, adatmentés és elfogadási jegyzőkönyv után zárható.
Döntés (v1.1, 2026-07-24): a korábbi M15 (Raspberry Pi és production hardening) kikerült az aktív mérföldkő-sorból -- lásd a szakasz végén a "Jövőbeli, jelenleg nem aktív mérföldkövek" alfejezetet. Az aktív sorozat ezért M0-M14 után közvetlenül a korábbi M16-tal (családi pilot és stabilizáció) folytatódik, amely ebben a dokumentumverzióban M15-re lett átszámozva -- nincs kihagyott vagy duplikált sorszám az aktív terven belül.

M0. v1 befagyasztás és baseline
Cél
Megőrizni a működő prototípust, rögzíteni a kiinduló állapotot és megakadályozni a további kaotikus bővítést.

Mező
Tartalom
Függőségek
Nincs
Becsült fejlesztési idő
1–2 nap
Kockázati szint
Alacsony

Feladatok – kötelező sorrend
M0.1 Git és backup – v1 teljes commit/tag, store és localStorage export, screenshotok.
M0.2 Funkcióleltár – működik/részleges/álfunkció besorolás.
M0.3 Tesztmondatok – hang- és alapfolyamat baseline mérés.
M0.4 V2 backlog lock – csak a jóváhagyott hatókör kerülhet be.
Átadandó eredmények
v1 tag és offline backup
baseline riport
v2 issue/milestone struktúra
Elfogadási kapu
A v1 visszaállítható.
A jelenlegi funkciók és hibák dokumentáltak.
Új funkció nem került a v1-be.
M1. hordozható projektváz
Cél
Önálló v2 repository, build, config és alap health létrehozása ugyanabban a WSL-ben.

Mező
Tartalom
Függőségek
M0
Becsült fejlesztési idő
2–4 nap
Kockázati szint
Közepes

Feladatok – kötelező sorrend
M1.1 Workspace – api/web/contracts csomagok.
M1.2 TypeScript – strict config, lint, format.
M1.3 Fastify – health és config validation.
M1.4 React – alap layout és route-ok.
M1.5 CI – lint/type/test/build.
M1.6 Deploy adapter – WSL indító és külön 3422 port.
Átadandó eredmények
önálló npm ci + build
/health/live és /ready
üres PWA shell
Elfogadási kapu
A v2 fő Marveen node_modules nélkül indul.
A projekt amd64 Linuxon tiszta telepítésből buildel.
Hiányzó kötelező config esetén érthető hibával áll le.
M2. SQLite, migráció és auth alap
Cél
Megteremteni az egységes adatréteget, admin sessiont és eszközpárosítást.

Mező
Tartalom
Függőségek
M1
Becsült fejlesztési idő
4–7 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M2.1 SQLite config – WAL, FK, migration runner.
M2.2 Core tables – household, settings, devices, sessions, audit.
M2.3 Admin auth – scrypt password, secure cookie, CSRF.
M2.4 Pairing – one-time code, revoke.
M2.5 Secret crypto – master key + AES-GCM helper.
M2.6 Backup smoke – kézi backup/restore temp környezetben.
Átadandó eredmények
első migrációk
admin login
device pairing API és UI
titkosítási unit tesztek
Elfogadási kapu
Párosítatlan eszköz nem írhat adatot.
Titok nem jelenik meg logban vagy API-válaszban.
DB migráció és restore teszt sikeres.
M3. scheduler, outbox, SSE és bootstrap
Cél
Oldalfrissítés nélküli élő adatfolyam és újraindításbiztos háttérmotor.

Mező
Tartalom
Függőségek
M2
Becsült fejlesztési idő
4–7 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M3.1 Job runner – claim/lease/retry/dead-letter.
M3.2 Outbox – tranzakciós eseménytábla.
M3.3 SSE – event ID, reconnect, heartbeat.
M3.4 Bootstrap – verziózott household snapshot.
M3.5 Web client – slice frissítés teljes reload nélkül.
M3.6 Failure test – process kill és reconnect.
Átadandó eredmények
jobs admin nézet
SSE client
bootstrap contract
event fixtures
Elfogadási kapu
SSE megszakítás után automatikusan helyreáll.
Aktív kliensállapot nem törlődik naptárfrissítéskor.
Outbox esemény process crash után sem vész el.
M4. hang Stage A
Cél
Megbízható magyar push-to-talk + VAD + STT/TTS fallback megvalósítása.

Mező
Tartalom
Függőségek
M2–M3
Becsült fejlesztési idő
5–9 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M4.1 Recorder – audio format capability detection.
M4.2 VAD – auto-stop és max duration.
M4.3 STT adapter – gpt-4o-transcribe, timeout, glossary.
M4.4 Assistant turn – szöveges válasz minimális tool nélkül.
M4.5 TTS adapter – gpt-4o-mini-tts stream/cache.
M4.6 Voice UI – állapotgép, átirat, retry, cancel.
M4.7 Corpus test – A17 + iPad Air, zajos konyha.
Átadandó eredmények
voice feature flag
audio diagnostics
20 mondatos tesztriport
Elfogadási kapu
A mikrofon nem fagy be hiba után.
A pontossági és latency cél Stage A szinten mérve.
iPad Air és A17 használható push-to-talk módban.
M5. Realtime hang és barge-in
Cél
Természetes, megszakítható WebRTC beszélgetés, Stage A fallbackkel.

Mező
Tartalom
Függőségek
M4
Becsült fejlesztési idő
6–12 nap
Kockázati szint
Nagyon magas

Feladatok – kötelező sorrend
M5.1 Session broker – OpenAI Realtime call/session endpoint.
M5.2 WebRTC client – peer connection, data channel.
M5.3 Turn state – server/session correlation.
M5.4 Barge-in – audio cancel és state update.
M5.5 Tool forwarding – backend validation stub.
M5.6 Fallback – automatikus Stage A váltás.
M5.7 Device tests – hosszabb beszélgetés, echo, sleep/wake.
Átadandó eredmények
Realtime toggle
latency report
fallback telemetry
Elfogadási kapu
Közbeszólás < célérték és nem indul önmagára turn.
Realtime hiba nem teszi használhatatlanná az appot.
Legalább 30 perces session stabil A17-en és iPaden.
M6. tartós családi memória és admin
Cél
A felhasználó lássa, szerkessze és kézzel bővítse a memóriát; AI csak javasoljon.

Mező
Tartalom
Függőségek
M2–M5
Becsült fejlesztési idő
4–8 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M6.1 Memory schema – facts + revisions.
M6.2 CRUD API – filter, pagination, validation.
M6.3 Admin UI – list/edit/add/archive/history.
M6.4 Proposal tool – memory.propose, confirmation.
M6.5 Retrieval – relevant facts per turn.
M6.6 V1 import – review queue, kitalált allergia kiszűrése.
M6.7 Export – JSON backup.
Átadandó eredmények
memory admin
revision viewer
import report
Elfogadási kapu
Kézi memória azonnal megjelenik a következő releváns beszélgetésben.
AI-javaslat megerősítés nélkül nem válik aktívvá.
Módosítás visszaállítható.
M7. timer, reminder és faliújság
Cél
Megbízható napi asszisztens funkciók szerveroldali állapottal.

Mező
Tartalom
Függőségek
M3, M5
Becsült fejlesztési idő
5–9 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M7.1 Timer domain – persist, alarm, ack, recovery.
M7.2 Reminder domain – one-shot, recurrence alap.
M7.3 Notification – SSE + aktív hang.
M7.4 Dashboard – kártyák és kontextuális hangsúly.
M7.5 Snooze – occurrence modell.
M7.6 Recovery – restart és offline teszt.
Átadandó eredmények
faliújság v1
timer/reminder APIs
alarm test report
Elfogadási kapu
Restart alatt sem vész el timer/reminder.
Másik eszközön azonnal látszik a változás.
Duplikált hangparancs idempotens.
M8. Google Calendar és Gmail
Cél
Közvetlen, megbízható OAuth integráció és valós végrehajtási visszajelzés.

Mező
Tartalom
Függőségek
M2–M3, M7
Becsült fejlesztési idő
7–14 nap
Kockázati szint
Nagyon magas

Feladatok – kötelező sorrend
M8.1 Google Cloud setup – consent, redirect, test users.
M8.2 OAuth – connect/revoke/refresh encryption.
M8.3 Calendar list – calendar selection.
M8.4 Calendar sync – full + syncToken.
M8.5 Calendar write – idempotent insert, confirmation.
M8.6 Gmail draft – MIME és drafts.create.
M8.7 Gmail send – explicit confirmation és audit.
M8.8 Admin health – reauth és scope view.
Átadandó eredmények
Google integration admin
calendar sync cache
Gmail draft/send flow
Elfogadási kapu
Új külső esemény 3 percen belül megjelenik.
Calendar siker csak Google ID után hangzik el.
Email explicit send nélkül nem kerül elküldésre.
M9. bevásárlólista és Keep adapter
Cél
Többeszközös shopping lista, Keep export capability testtel.

Mező
Tartalom
Függőségek
M3, M8
Becsült fejlesztési idő
3–6 nap
Kockázati szint
Közepes

Feladatok – kötelező sorrend
M9.1 Shopping CRUD – server DB, merge.
M9.2 SSE sync – device cross-update.
M9.3 Recipe hook – missing ingredient add.
M9.4 Keep capability – API/share/clipboard modes.
M9.5 Export history – note ID, result.
M9.6 Admin settings – default mode és target.
Átadandó eredmények
shopping UI
Keep adapter
fallback UX
Elfogadási kapu
Lista cache törlés után is megmarad.
Két eszköz konzisztens.
Keep nem támogatott fióknál működő fallback van.
M10. többforrásos receptkeresés
Cél
3–6 valós recept megtalálása megadott alapanyagokból, kitalálás nélkül.

Mező
Tartalom
Függőségek
M2–M3, M6
Becsült fejlesztési idő
10–18 nap
Kockázati szint
Nagyon magas

Feladatok – kötelező sorrend
M10.1 Source registry – approved domains.
M10.2 Search adapter – Brave query és cache.
M10.3 Safe fetch – allowlist/SSRF/timeout.
M10.4 JSON-LD parser – Recipe extraction.
M10.5 Source adapters – csak szükséges oldalak.
M10.6 Normalizer – ingredient/yield/time/steps.
M10.7 Ranker – coverage, preference, diversity.
M10.8 UI – 3–6 cards, source/link/missing.
Átadandó eredmények
recipe search API
parser fixtures legalább 4 forrásra
search UI és audit log
Elfogadási kapu
Egyetlen kitalált URL vagy recept sem jelenik meg.
Legalább 3 valid találatnál 3–6 kártya készül.
Forráslink és kinyert tartalom megfelel.
M11. tápértékmotor
Cél
Teljes és adagonkénti kcal/protein/CH/fat számítás reprodukálható módon.

Mező
Tartalom
Függőségek
M10
Becsült fejlesztési idő
10–18 nap
Kockázati szint
Nagyon magas

Feladatok – kötelező sorrend
M11.1 FDC adapter – search/get/cache.
M11.2 Unit parser – g/ml/darab/kanál.
M11.3 Ingredient mapping – confidence + review queue.
M11.4 Calculation – formula és servings.
M11.5 Uncertainty – A/B/C szint.
M11.6 Admin mapping – review/override.
M11.7 Cross-check – source nutrition deviation.
M11.8 Test fixtures – legalább 20 receptösszetevő.
Átadandó eredmények
nutrition API
mapping admin
calculation report
Elfogadási kapu
Ugyanaz a bemenet ugyanazzal a motorverzióval ugyanazt az eredményt adja.
Bizonytalan mennyiség nem jelenik meg hamis pontossággal.
Módosított adag és mennyiség újraszámol.
M12. főzési munkamenet
Cél
Hangvezérelt, folytatható lépésenkénti receptmód.

Mező
Tartalom
Függőségek
M5, M7, M10–M11
Becsült fejlesztési idő
6–10 nap
Kockázati szint
Magas

Feladatok – kötelező sorrend
M12.1 Session domain – state/version/lease.
M12.2 Step UI – next/repeat/previous.
M12.3 Voice intents – cooking commands.
M12.4 Timer link – step timer.
M12.5 Overrides – quantity change + recalc.
M12.6 Resume – page/device restart.
M12.7 Completion – rating/save favorite.
Átadandó eredmények
cooking session API/UI
voice command tests
resume test
Elfogadási kapu
Oldalbezárás után ugyanazon lépés folytatható.
Közben naptár SSE nem szakítja meg a sessiont.
Mennyiségváltozás után makró frissül.
M13. YouTube, briefing és zene
Cél
Ellenőrzött zene/videó keresés és AC/DC-s reggeli összefoglaló.

Mező
Tartalom
Függőségek
M3, M5, M8
Becsült fejlesztési idő
4–8 nap
Kockázati szint
Közepes

Feladatok – kötelező sorrend
M13.1 YouTube adapter – search.list és quota.
M13.2 Video UI – verified link, no autoplay.
M13.3 Briefing job – daily data assembly.
M13.4 Briefing TTS – cache és playback.
M13.5 AC/DC player – ducking/fade/volume.
M13.6 Fallback – zene nélkül és live brief.
Átadandó eredmények
YouTube cards
briefing scheduler
audio mixing test
Elfogadási kapu
Konkrét videó csak API találatból jelenik meg.
Briefing BÉLA nélkül is létrejön a v2 schedulerből.
Zene nem nyomja el a beszédet.
M14. PWA, Web Push és offline shell
Cél
Alvó eszköz értesítése és kontrollált offline élmény.

Mező
Tartalom
Függőségek
M3, M7
Becsült fejlesztési idő
6–12 nap
Kockázati szint
Nagyon magas

Feladatok – kötelező sorrend
M14.1 Manifest – icons/id/display.
M14.2 Service worker – versioned cache.
M14.3 Push subscribe – device binding.
M14.4 Notification worker – VAPID és delivery.
M14.5 iOS onboarding – home screen/push guide.
M14.6 Offline UX – last state + queued safe ops.
M14.7 Update flow – no forced reload during session.
Átadandó eredmények
installable PWA
push admin
offline test matrix
Elfogadási kapu
iPad Home Screen app push fogad.
Frissítés nem szakít aktív cooking sessiont.
Offline UI nem állít külső műveletsikert.
M15. családi pilot és stabilizáció (korábban M16)
Cél
Valós napi használattal igazolni, hogy a rendszer nem csak demó.

Mező
Tartalom
Függőségek
M0–M14 stabil, aktív WSL2-izolált telepítés (33. szakasz)
Becsült fejlesztési idő
4–8 hét pilot
Kockázati szint
Magas

Feladatok – kötelező sorrend
M15.1 Pilot period – 4–8 hét napi használat.
M15.2 Issue triage – P0 azonnali, P1 sprint.
M15.3 Metrics – voice success, reminder delivery, recipe use.
M15.4 Family feedback – István, Erika, gyerekek külön.
M15.5 Data review – memory correctness és admin használhatóság.
M15.6 Go/no-go – termékesítési kutatás csak kapu után.
Átadandó eredmények
pilot napló
hibastatisztika
v2.0.0 acceptance report
Elfogadási kapu
Nincs elveszett kritikus reminder.
Nincs hamis naptár/Gmail siker.
A család más tagja segítség nélkül használja.
A receptmód legalább 10 valós főzésben működött.

Jövőbeli, jelenleg NEM aktív mérföldkövek
Az alábbi tétel nem része az aktív M0-M15 tervnek. Nem törölve, csak elhalasztva -- ha később ismét aktívvá válik, a normál M-sorszámozásba visszakerül a döntés időpontjában (nem feltétlenül M15 lesz ismét, mivel a szám időközben mást jelölhet). Az azonosító "F1" (future) jelöli, hogy szándékosan a normál M-sorozaton kívül áll, elkerülve bármilyen jövőbeli sorszám-ütközést.

F1. Raspberry Pi és production hardening (korábban M15, jelenleg nem aktív)
Cél
Azonos build futtatása ARM64-en, biztonságos service-szel és mentéssel -- Raspberry Pi hardveren, ha ez a cél a jövőben ismét aktívvá válik.

Mező
Tartalom
Függőségek
M0–M14 stabil (a WSL2-izolált telepítés helyett/mellett)
Becsült fejlesztési idő
7–14 nap
Kockázati szint
Nagyon magas
Állapot
Jövőbeli, jelenleg NEM aktív -- lásd 33. szakasz.

Feladatok – kötelező sorrend (ha aktiválódik)
F1.1 ARM install – Pi OS 64-bit, node, caddy.
F1.2 systemd – sandboxed unit.
F1.3 SSD data – permissions és backup.
F1.4 HTTPS onboarding – CA/device trust.
F1.5 Performance – CPU/RAM/latency benchmark.
F1.6 Upgrade – signed artifact/checksum/migration.
F1.7 Recovery drill – power loss + restore.
Átadandó eredmények
Pi install script
systemd/caddy config
benchmark és recovery report
Elfogadási kapu
Pi újraindítás után automatikusan működik.
Nincs adatvesztés áramkimaradás-szimuláció után.
A meghatározott erőforráskeret teljesül.
Példa systemd unit -- csak akkor releváns, ha ez a mérföldkő aktiválódik; végleges értékek implementációkor ellenőrzendők
[Unit]Description=Bela Home v2After=network-online.target[Service]User=bela-homeWorkingDirectory=/opt/bela-home/currentEnvironmentFile=/etc/bela-home/bela-home.envExecStart=/usr/bin/node apps/api/dist/main.jsRestart=on-failureRestartSec=5NoNewPrivileges=truePrivateTmp=trueProtectSystem=strictReadWritePaths=/var/lib/bela-home /var/log/bela-home[Install]WantedBy=multi-user.target

35. Kockázati nyilvántartás
ID
Kockázat
Szint
Kezelés
R-01
iOS/PWA audio és háttérkorlát
Magas
Stage A fallback, Home Screen onboarding, device test minden release előtt.
R-02
Konyhai zaj rontja STT-t
Magas
glossary, transcribe modell, VAD tuning, később külső mic/ReSpeaker.
R-03
Realtime API változás/költség
Magas
provider config, snapshot/model allowlist, fallback pipeline.
R-04
Google OAuth verification termékesítésnél
Magas
legszűkebb scope, személyes test users, későbbi review terv.
R-05
Keep személyes Gmail korlátozás
Magas
capability test + share/clipboard fallback.
R-06
Receptoldalak HTML változása
Magas
JSON-LD first, adapter fixtures, source health, graceful skip.
R-07
Scraping/ToS/jogi kockázat
Magas
approved source registry, robots/ToS, linkalapú megjelenítés, jogi review eladás előtt.
R-08
Tápérték hamis pontosság
Magas
confidence, mapping review, explicit uncertainty, reproducibility.
R-09
SQLite korrupció/áramkimaradás
Közepes
WAL, SSD, backup, integrity check, restore drill.
R-10
Feature creep
Magas
roadmap lock, ADR és jóváhagyás minden új funkcióhoz.
R-11
AI hibás tool call
Magas
strict schema, backend validation, confirmation, idempotency.
R-12
LAN illetéktelen hozzáférés
Magas
HTTPS, pairing, auth, rate limit, audit.
R-13
Raspberry Pi natív dependency build
Közepes
JELENLEG NEM AKTÍV kockázat (F1 elhalasztva, 34. szakasz) -- ha a Pi mérföldkő ismét aktívvá válik: ARM CI, build-essential install, package selection, real Pi test.
R-14
Web Push best-effort
Közepes
szerver source, retries, optional secondary channel kritikus reminderhez.
R-15
WSL2-izoláció megkerülhető hibás konfigurációval (pl. wsl.conf elmarad, jogosultság hiba)
Magas
33. szakasz szerinti kötelező wsl.conf beállítások, kétfelhasználós (beladev/belahome) szétválasztás, migráció utáni izolációs tesztlista (33.5) kötelező futtatása éles beüzemelés előtt.

36. Definition of Done és végső elfogadás
36.1. Feladatszintű DoD
A követelménykód és issue összekapcsolva.
Típusellenőrzés, lint és releváns tesztek sikeresek.
Input schema, auth és hibakezelés implementálva.
Nincs titok, PII vagy debug dump a kódban/logban.
Adatváltozás esetén migráció és rollback/restore terv készült.
Felhasználói UI-n loading, üres, hiba és siker állapot megvan.
Mobil/tablet layout ellenőrzött.
Dokumentáció és changelog frissült.
36.2. Mérföldkőszintű DoD
Minden feladatszintű DoD teljesült.
Automatikus CI és mérföldkő-specifikus E2E sikeres.
Valódi eszközteszt, ha hang/PWA/push érintett.
Backup készült és rollback pont rögzítve.
Elfogadási kaput a felhasználó vagy kijelölt reviewer jóváhagyta.
Nyitott P0 hiba nincs; P1 csak dokumentált kivétellel.
36.3. V2.0.0 végső kapu
Terület
Kötelező eredmény
Hang
Stage A stabil minden célkészüléken; Realtime használható és fallback működik.
Memória
adminból teljes CRUD és revízió; nincs automatikus kitalált érzékeny adat.
Napi asszisztens
timer/reminder persistens, élő frissítés, push és restart recovery.
Google
Calendar/Gmail valós API sikerrel és biztonságos OAuth tokenkezeléssel.
Recept
3–6 forrásalapú találat, valid link, nincs generatív recept.
Tápérték
reprodukálható számítás, bizonytalansági címke, adag újraszámítás.
Főzés
lépésenkénti session másik eszközön/restart után folytatható.
Biztonság
HTTPS, pairing, admin auth, CSRF, SSRF, audit és secret encryption.
Hordozhatóság
Az izolált WSL2 (Ubuntu-BelaHome) telepítés a release artifactból működik, a 33. szakasz izolációs tesztjei (33.5) sikeresek. Raspberry Pi ARM64 kompatibilitás build/QEMU szinten fenntartva (6. szakasz hordozhatósági szabálya), de a tényleges Pi-telepítés jelenleg nem része a v2.0.0 kapunak -- F1 mérföldkő, elhalasztva.
Pilot
4–8 hetes családi használat eredménye elfogadott.

A. API-katalógus – tervezett v1 szerződés
Method
Path
Auth
Cél
GET
/health/live
public/local
liveness
GET
/health/ready
public/local
readiness
POST
/auth/admin/login
public
admin session
POST
/auth/pairing/start
admin
pair code
POST
/auth/pairing/claim
pair code
device session
POST
/auth/logout
session
logout
GET
/bootstrap
device
full UI snapshot
GET
/events
device
SSE stream
POST
/assistant/turns
device
text/voice turn orchestration
POST
/voice/transcriptions
device
Stage A STT
POST
/voice/speech
device
Stage A TTS
POST
/voice/realtime/session
device
Realtime handshake/session
GET
/memory
admin/device read
filtered memory
POST
/memory
admin
manual memory
PATCH
/memory/:id
admin
edit/archive
POST
/memory/proposals/:id/confirm
admin/device explicit
confirm AI proposal
GET
/timers
device
active/history
POST
/timers
device
create
POST
/timers/:id/ack
device
acknowledge
DELETE
/timers/:id
device
cancel
GET
/reminders
device
list
POST
/reminders
device
create
PATCH
/reminders/:id
device
edit
POST
/reminder-occurrences/:id/snooze
device
snooze
POST
/reminder-occurrences/:id/ack
device
ack
GET
/calendar/events
device
local synced calendar
POST
/calendar/events
device
confirmed create
GET
/integrations/google/connect
admin
OAuth start
GET
/integrations/google/callback
OAuth
callback
POST
/integrations/google/revoke
admin
disconnect
POST
/gmail/drafts
device
create draft
POST
/gmail/messages/send
device explicit
send
GET
/shopping/items
device
list
POST
/shopping/items
device
add
PATCH
/shopping/items/:id
device
update/check
POST
/shopping/export/keep
device
Keep/share export
POST
/recipes/searches
device
start recipe search
GET
/recipes/searches/:id
device
status/results
POST
/recipes/:candidateId/select
device
select recipe
POST
/nutrition/calculate
device
calculate/recalculate
POST
/cooking-sessions
device
start
PATCH
/cooking-sessions/:id
device
step/override/pause
GET
/youtube/search
device
verified videos
GET
/weather
device
cached weather
GET
/admin/system/status
admin
system health
POST
/admin/backups
admin
manual backup
POST
/admin/restore/validate
admin
restore dry run

B. Eseménykatalógus
Event type
Payload célja
system.status.changed
dependency/online/offline state
calendar.updated
local calendar cache changed
timer.created
new timer
timer.updated
pause/resume/cancel
timer.expired
alarm
timer.acknowledged
alarm cleared
reminder.updated
definition changed
reminder.due
occurrence due
reminder.acknowledged
occurrence done
shopping.updated
list delta
memory.updated
fact/revision changed
recipe.search.updated
search status/results
cooking.session.updated
step/state/override
briefing.ready
daily briefing generated
notification.failed
delivery failed
integration.status.changed
OAuth/provider health
app.update.available
new PWA/server version

C. Job-katalógus
Job
Ütem
Retry
Feladat
timer.recovery_sweep
5 mp
nem
expired timers recovery
reminder.dispatch
10 mp
igen
occurrences and delivery
calendar.incremental_sync
120 mp
igen
syncToken changes
calendar.channel_renew
napi
igen
push channel renewal
briefing.generate
07:30
igen
daily briefing
outbox.publish
1 mp/event
igen
SSE/push publish
notification.send
on demand
igen
web push/email
recipe.fetch
on demand
igen
safe page extraction
nutrition.resolve
on demand
igen
FDC mapping/calc
backup.create
03:00
igen
daily backup
cleanup.retention
naponta
igen
sessions/cache/log metadata
integration.health
5 perc
igen
provider status

D. Források, API-kutatás és belső kiinduló dokumentumok
Az API- és platformdöntések 2026. július 23-i állapotot tükröznek. A megvalósítás megkezdésekor a forrásokat újra ellenőrizni kell, mert modellek, scope-ok, kvóták és támogatási feltételek változhatnak.
[S01] OpenAI GPT-Realtime model – audio/text realtime, WebRTC/WebSocket/SIP, function calling – https://developers.openai.com/api/docs/models/gpt-realtime
[S02] OpenAI Realtime API reference – https://platform.openai.com/docs/api-reference/realtime?lang=javascript
[S03] OpenAI GPT-4o Transcribe model – https://developers.openai.com/api/docs/models/gpt-4o-transcribe
[S04] OpenAI GPT-4o mini TTS model – https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
[S05] OpenAI Function Calling és Structured Outputs – https://help.openai.com/en/articles/8555517
[S06] Google OAuth 2.0 Web Server Applications – https://developers.google.com/identity/protocols/oauth2/web-server
[S07] Google OAuth best practices és token storage – https://developers.google.com/identity/protocols/oauth2/resources/best-practices
[S08] Google Calendar API scopes – https://developers.google.com/workspace/calendar/api/auth
[S09] Google Calendar – create events – https://developers.google.com/workspace/calendar/api/guides/create-events
[S10] Google Calendar incremental synchronization – https://developers.google.com/workspace/calendar/api/guides/sync
[S11] Google Calendar push notifications – https://developers.google.com/workspace/calendar/api/guides/push
[S12] Gmail – create and send messages – https://developers.google.com/workspace/gmail/api/guides/sending
[S13] Gmail – create and send drafts – https://developers.google.com/workspace/gmail/api/guides/drafts
[S14] Gmail API scopes – https://developers.google.com/workspace/gmail/api/auth/scopes
[S15] Google Keep API overview – enterprise focus – https://developers.google.com/workspace/keep/api/guides
[S16] Google Keep – create notes – https://developers.google.com/workspace/keep/api/guides/create-notes
[S17] Google Keep notes resource and list items – https://developers.google.com/workspace/keep/api/reference/rest/v1/notes
[S18] MDN – Server-sent events – https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
[S19] MDN – Push API – https://developer.mozilla.org/en-US/docs/Web/API/Push_API
[S20] WebKit – Web Push for iOS/iPadOS Home Screen apps – https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
[S21] MDN – Service Worker API és PWA manifest – https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
[S22] USDA FoodData Central API Guide – https://fdc.nal.usda.gov/api-guide
[S23] USDA FoodData Central – licensing/public domain – https://fdc.nal.usda.gov/
[S24] Brave Search API – Web Search – https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
[S25] Google Custom Search JSON API – new customers closed, transition note – https://developers.google.com/custom-search/v1/overview
[S26] Schema.org Recipe structured data – https://schema.org/Recipe
[S27] YouTube Data API – search.list – https://developers.google.com/youtube/v3/docs/search/list
D.1. Belső kiinduló dokumentumok
[I01] Béla Home v2 – Felhasználói és funkcionális dokumentáció.
[I02] DEV-SPEC.md – a jelenlegi v1 rendszer technikai auditja.
[I03] bela-home-spec.html – v1 felhasználói/termékdokumentum.
Jóváhagyási összefoglaló
Fejlesztési utasítás
A v1 új funkciófejlesztése leáll. A v2 M0 mérföldkővel indul, ugyanazon a WSL2 gépen. Minden további mérföldkő csak az előző elfogadási kapu után kezdődhet. A cél nem a gyors demó, hanem a napi családi használatban megbízható rendszer, amely (v1.1 döntés, 2026-07-24) elkülönített WSL2-disztribúcióban (Ubuntu-BelaHome) fut, és a kód hordozhatósága miatt később -- ha ismét aktív céllá válik -- Raspberry Pi-re is telepíthető marad (lásd F1, 34. szakasz).

Döntési pont
Elfogadott irány
Alkalmazásforma
moduláris monolit, külön v2 repository
Elsődleges adat
SQLite szerveroldalon
Hang
OpenAI Stage A + Realtime, fallbackkel
AI
OpenAI elsődleges; Claude/DeepSeek nincs baseline-ban
Memória
teljes admin CRUD és megerősítés
Google
közvetlen Calendar/Gmail OAuth
Keep
adapter + capability fallback
Recept
Brave Search + jóváhagyott források + JSON-LD
Tápérték
USDA FDC, reprodukálható számítás
Kliensfrissítés
SSE + Web Push, nincs teljes auto-refresh
Jelenlegi futtatás
WSL2, elkülönített Ubuntu-BelaHome disztribúció (33. szakasz)
Cél hardver (aktív)
amd64 WSL2 -- Raspberry Pi 5 / Linux ARM64 jövőbeli, jelenleg nem aktív (F1)
