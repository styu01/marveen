# Marveen v1.28.2 -> v1.34.1 hibrid merge (Kanban e442c5c0)

## Kontextus

A production checkout (`production/marveen-v1.28.2-20260803-164414`, ahonnan a
`bela-dashboard.service` is fut) 165 commit-tel lemaradt a GitHub `origin/main`
mögött (v1.34.1, commit `1f13ff1`), UGYANAKKOR 25 saját commit-tal el is tért
tőle -- több saját commit (schedule-runner escalation, reauth-healer
megbízhatóság, channel-monitor stuck-input/parked-box kezelés) ugyanazokat a
problémákat oldotta meg, amiket origin/main FÜGGETLENÜL, más architektúrával
szintén megoldott.

Egyszerű `git pull`/branch-váltás ezért adatvesztéssel járt volna. István
2026-08-29 döntése (kanban e442c5c0, comment #144): **C opció, hibrid** --
vedd át origin/main saját megoldását ahol legalább egyenértékű/érettebb, és
CSAK azokat a 25 saját commitot tartsd meg / cherry-pick-eld át, amiknek
TÉNYLEG nincs megfelelője origin/main-ben. Fájlonként döntve, megállással ha
bármi nem egyértelmű.

Ez a dokumentum a 25 saját commit egyenkénti sorsát és indoklását rögzíti, a
`marveen-git-update-preserve` és `local-subagent-output-verify` skillek
módszertana szerint.

## Módszertan

1. Izolált munkaterület: `git worktree add /tmp/marveen-hybrid-merge -b
   main-hybrid-v1.34.1 origin/main` -- az éles checkout érintetlen marad amíg
   minden zöld nem lesz.
2. A 25 saját commitot (production branch `git log
   production/marveen-v1.28.2-20260803-164414
   ^$(git merge-base ... origin/main)`) időrendben, egyenként dolgoztam fel:
   - `git cherry-pick <hash>` a hibrid branch-re
   - konfliktus esetén fájlonként megnézve mindkét oldal ÉRVÉNYES, aktuális
     tartalmát (`git show origin/main:<path>`, teljes olvasás, nem csak
     commit-üzenet grep)
   - döntés: SKIP (funkcionálisan superseded) / PICK (tisztán vagy
     konfliktus-feloldással) / PARTIAL (csak egy fájl/hunk marad releváns) /
     HAND-MERGE (a két függetlenül fejlődött megoldást architekturálisan
     össze kell fésülni, mert ugyanazt a függvényt mindkét oldal bővítette)
   - minden cherry-pick/hand-merge UTÁN: `npx tsc --noEmit` (teljes fa) +
     célzott `npx vitest run <érintett tesztfájlok>`
3. Miután mind a 25 fel volt dolgozva: friss `npm install` (a lock-fájl
   összhangba hozása, superseding az `af04b3d` skip-elt lock-only commit-ot),
   `npm audit fix` (nem-force), teljes `npx tsc --noEmit`, teljes `npx vitest
   run`.

## A 25 commit sorsa

| # | Commit | Cím | Döntés | Eredmény commit(ek) a hibrid branchen |
|---|--------|-----|--------|----------------------------------------|
| 1 | `18cb7c9` | chore(local): migrate Bela customizations to Marveen 1.25.1 | HAND-MERGE | `c60e030` |
| 2 | `af04b3d` | fix(deps): update vulnerable transitive production packages | SKIP | -- (superseded: friss `npm install` + `npm audit fix` a merge végén) |
| 3 | `ff37455` | fix(platform): self-healing claude/tmux bin resolution + disable sub-agent auto-updater | PARTIAL | `ef1589c` (csak `scripts/bela-start.sh`, a többi 3 fájl superseded) |
| 4 | `21ce112` | chore(install): bump fleet claude-code pin 2.1.220 -> 2.1.222 | PICK | `4442e74` |
| 5 | `3019a34` | fix(watchdog): backfill safety env-vars into the fallback sub-agent spawn | PICK | `599162e` |
| 6 | `137e678` | fix(watchdog): serialize overlapping runs with a non-blocking flock | PICK | `ec8d280` |
| 7 | `22a797c` | fix(agent): re-validate the cached claude-agent-sdk bin path each call | SKIP | -- (superseded, origin/main-nek más/érettebb bin-resolution mechanizmusa van) |
| 8 | `ad5f419` | fix(restart): coordinate dashboard/watchdog respawns via a shared stamp | HAND-MERGE | `69d4076` (origin/main időközben async-osította `restartAgentProcess`-t) |
| 9 | `9809b72` | fix(google-api): mtime-invalidate the client-credentials cache | SKIP | -- (superseded) |
| 10 | `24a99d8` | test(contract): assert DISABLE_AUTOUPDATER=1 on every claude spawn path | SKIP | -- (superseded) |
| 11 | `c4725c5` | chore(gitignore): ignore the runtime logs/ directory | PICK | `3eba977` |
| 12 | `141ee8a` | fix(channels): recover the main session when its tmux pane is gone + de-race the recreate actors | PICK | `2d326bc` |
| 13 | `2f4e436` | feat(egress-gate): widen WebFetch to any https domain for the quarantine-reader only | HAND-MERGE | `75f80ef` -- lásd külön szakasz lent |
| 14 | `2375297` | fix(worker-liveness): proactively restart bela-worker/-fast on death | PICK | `fe9ecfe` |
| 15 | `e55eadb` | feat(kanban): human-readable project overview dashboard | PICK | `7858090` |
| 16 | `9d46ed4` | feat(kanban): add Done/In progress filter toggles to the Projects page | PICK | `2e97f2f` |
| 17 | `569a56f` | fix(channels): optional debug-log toggle; docs(quarantine-reader): clarify tier-2 SSRF guard | PICK | `ae0bbd4` |
| 18 | `ee7b49a` | fix(schedule-runner): don't drop a scheduled task when the main session is only transiently down | HAND-MERGE | `1d075f7` + `9c6186b` (típusjavítás, lásd Hibák szakasz) |
| 19 | `4f840b1` | diag(channel-monitor): temporarily log parked stuck-input text samples | SKIP | -- (szándékosan átmeneti diagnosztikai commit, a valódi fix-ek [`d417788`, `42de434`, `24aff14`, `9e47d68`] superseded-elik) |
| 20 | `d417788` | fix(channel-monitor): sent-text fallback for machine-origin detection | HAND-MERGE | `aa75a90` |
| 21 | `42de434` | feat(channel-monitor): sub-agent overdue-guard, alert-only level | PICK | `cae00f7` |
| 22 | `24aff14` | fix(reauth-healer): recent-task sanity check before main-agent force-restart | PICK | `642d969` |
| 23 | `9e47d68` | fix(channel-monitor): scheduled-task remedy classification via sent-text registry | HAND-MERGE | `047083e` -- lásd külön szakasz lent |
| 24 | `8fddef6` | feat(schedule-runner): two-stage escalation for pending-retry/task-timeout alerts | HAND-MERGE | `3ada407` -- lásd külön szakasz lent |
| 25 | `175b25b` | fix(reauth-healer): escalation delivery -- direct Telegram fetch, not notify.sh execFile | HAND-MERGE | `424f452` |

Összesen: 15 tiszta/egyszerű PICK, 6 HAND-MERGE (mélyebb, függvény-szintű
konfliktus-feloldás), 1 PARTIAL, 5 SKIP (superseded), + 1 önálló
típushiba-javító commit (`9c6186b`) ami nem egy adott forrás-commit
cherry-pick-je, hanem a hibrid-merge során keletkező hézag zárása.

## Kiemelt hand-merge-ek

### `egress-gate.mjs` -- quarantine-reader Tier-2 SSRF-guard (`75f80ef`)

Origin/main saját, érett tiered `egressDecision()`-t épített ki (audit
logging, `DASHBOARD_PORT` userinfo-injection védelem), de a quarantine-reader
policy-ja NÁLA fix domain-allowlist volt. A mi forkunk Tier-2 policy-ja (bármely
https + `isIP()`-alapú SSRF guard, NEM fix allowlist) egy dátumozott, István
által jóváhagyott, szándékos döntés (2026-08-06/19, ld. memória
`feedback_no_self_imposed_web_read_restraint`). Ez a döntés MEGMARADT: az
`isQuarantineFetchAllowed()` függvény és a hozzá tartozó `QUARANTINE_AGENT_TYPE`
ág bekerült origin/main tiered architektúrájába, a többi (audit logging,
port-validáció) origin/main-től változatlanul jött át. Ellenőrizve: a
`templates/sub-agents/quarantine-reader.md` sablon szó szerint egyezik az élő
production tartalommal.

### `channel-monitor.ts` + `pane-state.ts` + `sent-text-registry.ts` (`047083e`)

Origin/main saját, FÜGGETLEN fixet épített egy hasonló, de NEM ugyanazon
tünetre: a "FRONT-TRUNCATED" eset (a TUI levágja a doboz FEJÉT, a
`MACHINE_ORIGIN_TRUNCATED_MARKERS` heurisztika a `</scheduled-task>` záró tag
vagy két fix mondat jelenlétére támaszkodva ismeri fel). A mi
`sent-text-registry.ts`-ünk EGY MÁSIK, nem lefedett esetet céloz: amikor a
görgetett ablak SEM a nyitó fejlécet, SEM a záró taget nem mutatja (tiszta
középső fragmentum) -- ilyenkor semmilyen in-box horgony nem segít, csak a
ténylegesen KIKÜLDÖTT szöveg registry-alapú visszakeresése. A két mechanizmus
egymást KIEGÉSZÍTI, nem helyettesíti: mindkettő megmaradt, a
`parkedMainInputHasRemedy()` mindkét jelzést (`machineOrigin`,
`scheduledTaskBlock || extraScheduledTaskEvidence`) figyelembe veszi.

Hiba, amit a teszt-merge közben találtam és javítottam: a saját "BUG
REPRODUCTION" teszt-fixture-öm (`PARKED_SCHEDULED_SCROLLED_FRAGMENT`)
véletlenül tartalmazta a `</scheduled-task>` záró taget is -- ami azt
jelentette, hogy origin/main ÖNMAGÁBAN, a sent-text-registry fallback nélkül
IS felismerte volna a görgetett fragmentumot a saját
`MACHINE_ORIGIN_TRUNCATED_MARKERS` mintájával, és a teszt hamisan bukott
volna ("BUG REPRODUCTION" elvárás: nincs remedy; kapott: van remedy). A
fixture-t javítottam úgy, hogy SE a nyitó fejlécet, SE a záró taget ne
tartalmazza -- ez a valódi, még lefedetlen eset, amit a sent-text-registry
fallback céloz.

### `schedule-runner.ts` -- `TaskTimeoutDecision` + két-fázisú escalation (`3ada407`)

Ez volt a legmélyebb hand-merge. Két, EGYMÁSTÓL FÜGGETLENÜL, de UGYANAZOKRA a
függvényekre épülő fejlesztés futott össze:

- Origin/main saját `'lost'` decision-t vezetett be (2026-08-23 "csendes
  vesztés" incidens: egy 100%-os kontextusnál beragadt session elfogadja a
  billentyűzet-injektálást, de sosem indít új kört -- `paneState === 'idle'`
  önmagában NEM bizonyíték a befejezésre). `TaskInflightEntry` kapott egy
  `sawTurn: boolean` mezőt.
- A mi `8fddef6` commit-unk egy két-fázisú escalation-t vezetett be
  (`'escalate'` decision, `ownerAlerted: boolean` mező): az első riasztás
  BÉLÁ-nak megy (inter-agent), a MÁSODIK (a valódi Telegram-riasztás
  Istvannak) csak `OWNER_ESCALATION_EXTRA_MS` (75 perc) múlva, ha a helyzet
  addig nem oldódott meg -- 3 önmagától megoldódó helyzet (usage-monitor,
  reggeli-napindito, kanban-audit) felesleges riasztása után.

A `TaskTimeoutDecision` union mindkét oldal értékét megkapta (`'clear' |
'alert' | 'escalate' | 'hold' | 'lost'`), a `decideTaskTimeout()` törzsében
pedig egy régi, origin/main-es korai `if (entry.alerted) return 'hold'`
rövidzárlatot EL KELLETT TÁVOLÍTANI, mert az (a két-fázisú escalation
bevezetése előtt helyesen) minden már-riasztott bejegyzést azonnal 'hold'-ra
zárt volna, így az escalate ág SOSEM futott volna le. Ez NEM merge-konfliktus
volt (a sor konfliktusmentesen jött át HEAD-ről), hanem a két commit
szemantikájának összefésüléséhez szükséges önálló felismerés -- típus- vagy
tesztfutás nem jelezte volna, csak a logika végigolvasása.

## Hibák és javításuk a merge közben

- **`ff37455` kezdetben tévesen teljesen SKIP-elve**: csak 2 a 4 érintett
  fájlból lett ellenőrizve, a `scripts/bela-start.sh` flotta-specifikus
  hunkja (CLAUDE_PIN, `find_live_claude()`, flock) NEM superseded. Kiderült a
  KÖVETKEZŐ commit (`21ce112`) cherry-pick-jének konfliktusából (hiányzó
  előfeltétel-kontextus). Javítva: `git cherry-pick --abort`, majd célzott
  `git show ff37455:scripts/bela-start.sh > scripts/bela-start.sh`, önálló
  `ef1589c` commit indoklással.
- **`agent-process.ts` async/sync eltérés** (`ad5f419` hand-merge):
  origin/main időközben async-osította `restartAgentProcess`-t; a stamp-hívást
  az async függvénybe kellett beilleszteni.
- **`egress-gate.mjs` auto-merge egy törött teszt-importot hagyott hátra**:
  `prompt-injection-defense.test.ts` egy `shouldBlockWebFetch` exportot
  importált, amit a hand-merge-elt `egress-gate.mjs`-ben végül NEM tartottam
  meg (az `egressDecision`/`isEgressBlocked`-ba olvasztva). Javítva: a
  tesztfájl visszaállítva origin/main tiszta verziójára.
- **`schedule-runner.ts` `isMainAgent` scope-hiba** (`npx tsc --noEmit`
  fogta ki, TS2304): a cherry-pick-elt `ee7b49a` diff feltételezte, hogy
  `isMainAgent` helyi változó `attemptFireTask`-ban, de origin/main
  `resolveTaskTarget()` refaktorja kiszervezte ezt egy külön függvénybe, ami
  nem exponálja. Javítva önálló `9c6186b` commit-tal, helyi újraszámolással.
  **Tanulság: MINDEN cherry-pick UTÁN `npx tsc --noEmit`, nem csak a
  teszt-futás után** -- ez a hiba átment a vitest-en (a projekt konfigja nem
  típusellenőriz futás közben), csak később, külön tsc-futtatással derült ki.
- **`schedule-runner-main-agent-missing.test.ts` elavult fix-revert-guard**:
  origin/main saját, ÁTFOGÓBB fixe (a `'missing'`-törlés ág TELJES eltávolítása,
  nem csak a main-agent-specifikus kivétel) elavulttá tette az eredeti guard
  teszt pontos string-egyezését. Újraírva az erősebb invariáns szerint (csak
  `'fired'` töröl).
- **Teszt-ablak túl tág false-positive**: a fenti teszt újraírt verziója
  kezdetben egy 200-karakteres ablakot nézett a `deleteLine` után, ami
  véletlenül elkapta a `'missing'` szót egy SZOMSZÉDOS, magyarázó
  KOMMENTBEN is (nem kódban). Javítva: az ablak szűkítve a tényleges
  if-blokk törzsére.
- **`isTaskCompletionEvidence` szemantikai rés, saját magam vettem észre
  (nem build/teszt hiba jelezte)**: az eredeti 1-paraméteres
  `isTaskCompletionEvidence(paneState)` hamisan kezelte volna origin/main
  újonnan felfedezett `'lost'` esetét (idle pane, a feladat sosem futott,
  `sawTurn=false`) befejezés-bizonyítéknak -- pont az a hamis
  élet-jel, amit a reauth-healer sanity-check-nek NEM szabad megkapnia.
  Proaktívan javítva egy második `sawTurn: boolean` paraméterrel, MIELŐTT
  bármilyen teszt-futás felszínre hozta volna a rést.
- **`telegram.ts` `sendTelegramMessage` visszatérési típus konfliktus**:
  a `175b25b` cherry-pick konfliktusa csak a szignatúra körüli KONTEXTUS
  miatt jelentkezett (origin/main egy MÁSIK, korábbi fix -- a `message_id`
  visszaadása -- már `Promise<number | null>`-ra bővítette a típust); a
  `175b25b` saját diffje ezt a sort érintetlenül hagyta, csak a
  `resolveTelegramBotToken()` új függvényt szúrta be elé. Feloldás: HEAD
  szignatúrája + 175b25b új függvénye, mindkettő megtartva.
- **Görgetett-fragmentum teszt-fixture véletlen önmagát-superseded-elő
  tartalma** -- lásd fent, a channel-monitor hand-merge szakaszban.

## Ellenőrzés a hibrid branchen (`/tmp/marveen-hybrid-merge`, `main-hybrid-v1.34.1`)

- `npx tsc --noEmit`: 0 hiba (teljes fa)
- `npx vitest run` (teljes suite): **4035 zöld, 1 skip, 24 bukás**
  - Mind a 24 bukás UGYANAZ, a merge előtt is ismert kategória: `hook-path-guard.test.ts`,
    `hook-command-quoting.test.ts`, `email-send-gate.test.ts`,
    `governance-gates.test.ts`, `kanban-write-gate.test.ts` -- ezek a
    hook-injektáló tesztek a `isUnsafeHookCommand()` guard miatt buknak, ami
    SZÁNDÉKOSAN elutasít minden `/tmp`-gyökerű útvonalat (`join(PROJECT_ROOT,
    'scripts', '<hook>.mjs')` a worktree helyéről `/tmp/marveen-hybrid-merge/...`-ra
    oldódik fel) -- ez a guard MAGA a biztonsági funkció helyesen működik,
    csak a worktree-ből futtatott teszt kontextusában triggerelődik. Élő
    checkoutból (`/home/kisss/marveen`) futtatva ez a 23 teszt zöld lesz.
    Konkrétan ellenőrizve `src/web/agent-scaffold.ts:412-414`-nél.
  - A 24. (`memory-performance.test.ts`, timeout) ismert, párhuzamos
    suite-terhelés alatt flaky teszt (nem érinti egyik módosított fájlt sem).
  - NULLA átfedés bármelyik, a merge során módosított fájllal.
- `npm install` friss lock-fájllal (superseding `af04b3d`), majd
  `npm audit fix` (nem force): **5 production sérülékenység -> 0**
  (`@hono/node-server`, `body-parser`, `fast-uri`, `hono`, `ip-address` --
  utóbbi SSRF-bypass CVE-ket is tartalmazott, ironikusan pont az
  egress-gate SSRF-guard munka mellett, de nem érintette, mi a `node:net`
  `isIP()`-t használjuk, nem az `ip-address` csomagot).
  Maradék 5 sérülékenység (`esbuild`/`vite`/`vitest` lánc, 3 moderate + 1
  high + 1 critical) DEV-only (teszt-tooling, nem fut production-ben),
  javításuk `vitest@4.1.11`-re force-upgrade-et igényelne (breaking change)
  -- NEM végeztem el automatikusan, István/BÉLA döntésére vár.

## Nyitott pontok, amik Istvan/BÉLA döntésére várnak

1. **A dev-only esbuild/vite/vitest sérülékenység-lánc** -- force-upgrade
   (vitest 4.x) kockázatos a jelenlegi teszt-suite kompatibilitására nézve,
   külön kártyaként érdemes kezelni, nem ennek a merge-nek a része.
2. **Az éles checkout tényleges branch-váltása** (a kanban card eredeti 6.
   lépése) -- ez a dokumentum a worktree-beli, ELKÜLÖNÍTETT merge
   eredményét írja le. A production checkout (`/home/kisss/marveen`, ahonnan
   `bela-dashboard.service` fut) még NEM lett érintve.
