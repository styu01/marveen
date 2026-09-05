> **ELAVULT / OBSOLETE (2026-09-02):** Ezt a doksit 2026-09-01-en teljes
> egeszeben feldolgoztak es 3 PR-t nyitottak belole a Szotasz/marveen repon:
> #1136 (infra-robustness-fixes, TIER1 osszes eleme, meg OPEN), #1138
> (kanban-projects-page, TIER3 kanban elemei, meg OPEN), #1137
> (channel-monitor-resilience -- TIER2 aa75a90/047083e/3ada407/1d075f7/
> 9c6186b/cae00f7 temaja mas fajlnevvel bekotve -- MAR MERGELT). A jelen
> doksi alapjan 2026-09-02-en ujra delegalt PROGI-munka duplikatumot epitett,
> le lett allitva mielott barmit pusholt volna a fork remote-ra. Lasd
> `[[project_upstream_pr_ready_20260901]]` es a `bela` agent SQLite memoriajat
> ("upstream" kulcsszo) a teljes tortenetert. NE hasznald ujra ezt a doksit
> forrasnak PR-epiteshez -- ha marad ujra-ellenorzendo tetel, azt a #1136/
> #1137/#1138 tenyleges tartalma ellen kell frissen leellenorizni, nem ez
> ellen a lista ellen.

# Upstream (Szotasz/marveen) contribution candidate triage -- 2026-08-30

Forrás: a 2026-08-29-i hibrid-merge dev-spec (`docs/marveen-v1.34.1-hybrid-merge-dev-spec.md`)
25 saját commitja közül a PICK/HAND-MERGE/PARTIAL döntésűek (a SKIP-ek már superseded
origin/main-ben, azokat nem kell visszaküldeni), plusz a hibrid-merge dokumentum óta
született 2 új commit. Minden TIER 1/2/3 elemnél élőben ellenőriztem `git show
origin/develop:<path>`-tal, hogy a fix TÉNYLEG hiányzik-e upstreamből, nem csak
feltételezés.

Ez a dokumentum a [[skill:upstream-fork-pr-contribution]] eljárás 1-2. lépésének
(bázis tisztázása + szűrés mi általános) eredménye. A 4-8. lépés (branch, teszt,
push a fork remote-ra, compare-URL) még NEM történt meg -- usage-limit miatt
elhalasztva, PROGI-nak való a folytatás.

## TIER 1 -- verified bug, upstream-ben bizonyítottan hiányzik, kis generalizálási igény

| Commit | Cím | Verifikáció |
|---|---|---|
| `f611958` | watchdog.sh: DBUS_SESSION_BUS_ADDRESS/XDG_RUNTIME_DIR export cron systemctl --user híváshoz | `git show origin/develop:scripts/watchdog.sh` -- nincs benne DBUS/XDG_RUNTIME_DIR/flock string |
| `ec8d280` | watchdog.sh: overlapping run-ok szerializálása non-blocking flockkal | ua. (fentebb ellenőrizve egyben) |
| `599162e` | watchdog.sh: safety env-var-ok backfill a fallback sub-agent spawn-ba | ua. |
| `642d969` | reauth-healer.ts: recent-task sanity check force-restart előtt | `git show origin/develop:src/web/reauth-healer.ts | grep -i sanity` -- nulla találat |
| `424f452` | reauth-healer.ts: kozvetlen Telegram fetch a notify.sh execFile helyett | upstream reauth-healer.ts MA IS `execFile('/bin/bash', [NOTIFY_SCRIPT, msg]...)`-t hasznal, UGYANAZ a mintazat ami nalunk 2026-08-29-en csendben elbukott (`logger.warn('reauth-healer: notify.sh escalation failed')` -- ez a log-sor upstream-ben is szo szerint ott van). Nagyon valoszinu, hogy upstream ugyanebbe a hibaba fog futni. |
| `fe9ecfe` | worker-liveness.ts: proaktiv worker-ujrainditas halalkor | upstream sajat kommentje szo szerint kimondja a hianyt: "nothing restarts it until the next request" |

## TIER 2 -- verified uj kepesseg, nagyobb/osszetettebb (hand-merge szintu) valtoztatas

| Commit | Cím | Verifikáció / megjegyzés |
|---|---|---|
| `aa75a90` + `047083e` | channel-monitor.ts + UJ sent-text-registry.ts: kimenő szöveg registry-alapú visszakeresés parkolt input eseten | `src/web/sent-text-registry.ts` EGYALTALAN NEM letezik upstream-ben. Komplementer mechanizmus origin/main sajat machine-origin-detektorahoz, nem helyettesíti. |
| `3ada407` | schedule-runner.ts: ket-fazisu escalation (agent-first, majd owner csak N perc mulva) | `ownerAlerted`/`OWNER_ESCALATION` string egyaltalan nincs upstream schedule-runner.ts-ben. GENERALIZALANDO PR ELOTT: a mostani szoveg "BELA"/"Istvan"-specifikus, at kell irni "main agent"/"owner" altalanos terminologiara. |
| `2d326bc` | channels: main session helyreallitasa eltunt tmux pane eseten + recreate-actor de-race | upstream csak mas tunetre (front-truncated) van fixelve, ez mas ag |
| `1d075f7` + `9c6186b` | schedule-runner: ne dobja el az utemezett feladatot ha a main session csak atmenetileg van lent | tipushiba-javitassal egyutt egy egyseg |
| `cae00f7` | channel-monitor: sub-agent overdue-guard, csak-riaszt szint | altalanos feature, nincs upstream megfeleloje |

## TIER 3 -- altalanos feature/apro javitas, nem hiba, "nice to have"

| Commit | Cím | Megjegyzes |
|---|---|---|
| `7858090` | kanban: emberi-olvashato Projects osszefoglalo oldal | upstream `src/web/` fajlneveiben nincs "project"-es UI fajl, tehat hianyzik |
| `2e97f2f` | kanban: Kesz/Folyamatban szuro a Projects oldalon | a fentihez kapcsolodik, egyutt erdemes kuldeni |
| `3eba977` | .gitignore: logs/ runtime konyvtar figyelmen kivul hagyasa | trivialis, alacsony kockazat |
| `ae0bbd4` (csak a debug-log resze) | channels.sh: CHANNELS_DEBUG_LOG=1 opcionalis env var | a commit MASIK fele (SSRF guard doksi) mar a Tier-kizart temahoz tartozik, csak a debug-log hunk kuldendo kulon |

## KIZARVA -- NE kuldd be

| Commit | Miert nem |
|---|---|
| `75f80ef` | Ez NEM hibajavitas, hanem Istvan sajat, tudatos kockazat-toleranciai dontese (a quarantine-reader fix domain-allowlist helyett barmilyen https + isIP()-alapu SSRF guardot enged). Upstream default biztonsagi szigoritasat lazitana -- csak akkor kuldendo, ha opt-in konfiggal, es csak Istvan kulon jovahagyasaval. |
| `c60e030` | Tisztan Bela-fleet sajat migracios commit, semmi altalanos benne |
| `ef1589c` | `scripts/bela-start.sh` fajlnev-szinten flotta-specifikus, az altalanositas kulon munka lenne alacsony megterulessel |
| `4442e74` | Verzio-pin bump, mar elavult, nincs ertelme |
| `6ee5020` | npm audit fix a lock-fajlon -- nem tisztan portolhato diff (fugg az upstream aktualis lock-allapotatol), inkabb egy Issue-ban jelezni erdemes hogy ezek a csomagok sebezhetok, nem PR-t nyitni ra |

## Kovetkezo lepes (usage-reset utan, PROGI-nak)

A [[skill:upstream-fork-pr-contribution]] 3-8. lepese szerint: uj branch `origin/develop`
tetejerol, Tier 1 + Tier 2 + Tier 3 kulon-kulon logikai csoportba (kb. 3 PR: "infra
robustness fixes", "channel-monitor sent-text-registry", "kanban Projects page"),
kommentek generalizalasa (BELA/Istvan hivatkozasok kivetele), teljes tesztfuttatas
origin/develop bazison, push a `fork` remote-ra (`git@github-marveen-backup:styu01/marveen.git`),
compare-URL Istvannak.
