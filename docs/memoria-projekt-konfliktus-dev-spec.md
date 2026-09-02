# Dev-spec: memória-ellentmondás ellenőrzés javaslat-generálás előtt

Státusz: TERV, kód/prompt-szerkesztés még nincs elvégezve. Kanban a41b4e49,
István jóváhagyta az irányt (2026-08-25, BÉLA relay msg 1046).

## Pontosítás a feladat-leíráshoz

BÉLA feladatleírása "Dream Engine motor" és "kódszintű bővítés"t említ,
mintha ezek TypeScript-forráskód lennének a `src/` alatt. Ez nem pontos:
**a Dream Engine, a kanban-audit és a reggeli-napindító mind
prompt-instrukciós scheduled task-ok** (`~/.claude/scheduled-tasks/<név>/
SKILL.md`), amiket a schedule-runner egyszerűen befuttat a megbízott agent
(BÉLA) session-jébe — NEM compiled alkalmazáskód. A `src/`-ben a "dream
engine" kifejezés csak a schedule-runner/kanban infrastruktúra (SQL
táblák, `type: "dream-engine"` mező) hivatkozásaiban jelenik meg, maga a
logika mind a SKILL.md szövegben van.

**Ez azt jelenti, hogy a javítás is SKILL.md-szerkesztés, nem TS-kód.** Ez
nem tér el István jóváhagyott irányától (memória-keresés + timestamp-
összevetés kötelező lépésként, konfliktus esetén NE ajánlja fel
automatikusan) — csak a megvalósítás formája más, és jóval kisebb
kockázatú (nincs build/systemd-restart, a fájl a következő futáskor
azonnal érvényes).

## Érintett fájlok

1. `~/.claude/scheduled-tasks/dream-engine/SKILL.md` — Bucket 3 (🎯 Top-3
   holnapi javaslat, 51-60. sor a jelenlegi fájlban). Ez a megerősített
   gyökérok (memória id 327/328 vs 320).
2. `~/.claude/scheduled-tasks/kanban-audit/SKILL.md` — 3-4. lépés (beakadt
   task detektálás + ping/eszkaláció). Ugyanaz a hibaosztály: egy
   szándékosan jegelt/waiting kártyát a pusztán `updated_at`-alapú
   "beakadt" logika tévesen felajánlhat pingelésre/eszkalálásra.
3. `reggeli-napindito/SKILL.md` — **nincs külön változtatás**: csak a
   `DREAM.md` tartalmát veszi át változtatás nélkül (84. sor), tehát az
   1. pont javítása ide is automatikusan begyűrűzik.

## API, amit használunk (ellenőrizve a forrásban, nem feltételezve)

`GET /api/memories?agent=<agent>&q=<kulcsszó>&limit=20`

`src/web/routes/memories.ts:64-96`: ha `q` meg van adva és **nincs
`category`/`tier` paraméter**, a keresés a `searchAgentMemories()`-en
keresztül **mind a négy réteget (hot/warm/cold/shared) együtt** vizsgálja
— tehát NEM kell 3 külön hívás hot/warm/cold-ra, egyetlen hívás elég a
`category` paraméter kihagyásával. Minden találat tartalmazza a
`created_at` Unix epoch mezőt (`memories.ts:113` `created_label` is ebből
számolódik), ami az összevetéshez kell.

## 1. Változtatás: dream-engine SKILL.md, Bucket 3 bővítése

A jelenlegi eljárás (Bucket 3) a kanban-kártyákat kizárólag `status IN
('planned','in_progress','waiting')` alapján listázza, majd projekt+
aktivitás szerint súlyoz TOP-3-at. **Új, kötelező lépés a TOP-3 kiválasztás
ELŐTT**, minden esélyes projekt/kártya-jelöltre:

```bash
# Minden TOP-3 esélyesre (a card.project mezőt preferáld kulcsszóként, ha
# üres, a card.title első pár szavát):
curl -s -H "Authorization: Bearer $(cat /home/kisss/marveen/store/.dashboard-token)" \
  "http://localhost:3420/api/memories?agent=bela&q=<PROJEKT_VAGY_CIM_KULCSSZO>&limit=20"
```

Nézd át a találatokat: van-e köztük olyan, aminek `created_at` **később**
van mint a kártya `updated_at`-ja, ÉS a tartalma arra utal, hogy a
projektet szándékosan nem kell/szabad most felajánlani (pl. "jegelve",
"jegeljük", "ne foglalkozz vele", "ne dolgozz rajta", "várj vele",
"leállítva", "szüneteltetve", "ne implementáld" — ez a lista PÉLDA, nem
kimerítő: ítéld meg a szöveg tartalma alapján, ne csak kulcsszó-egyezésre
hagyatkozz, hasonlóan ahogy a Bucket 3 többi lépése is LLM-mérlegeléssel
dolgozik, nem mechanikus szabállyal).

**Ha van ellentmondó, frissebb memória**: a projekt/kártya NE kerüljön be
a TOP-3-ba. Helyette egy ÚJ kis szekció a DREAM.md-ben:

```markdown
## ⚠️ Konfliktus — ellenőrizendő
- <project/kártya cím> (kártya #<id>, utolsó frissítés <dátum>): a kanban
  nyitottnak mutatja, de egy frissebb memória (<memória id>, <dátum>)
  ennek ellentmond: "<rövid idézet a memória tartalmából>". Ellenőrizd
  mielőtt bármit javasolsz rá.
```

**Ha nincs ellentmondás**: a projekt a TOP-3-ban marad, változatlan
logikával.

Ez a lépés csak azokra a projektekre fut, amik amúgy is bekerülnének a
TOP-3 jelöltek közé (nem az összes nyitott kártyára) — így a futásidő nem
nő érdemben (jellemzően 3-5 kereséssel jár egy éjszakai futásban).

## 2. Változtatás: kanban-audit SKILL.md, 3-4. lépés bővítése

A "Beakadt task detection" (3. lépés) és a rákövetkező ping/eszkaláció (4.
lépés) közé egy azonos jellegű ellenőrzés kerül: mielőtt egy beakadt
kártyáról pingot küldenél az assignee-nek (vagy 2 kör után eszkalálnál
Istvánhoz), fusd le ugyanezt a memória-keresést a kártya
projektjére/címére, és ha van frissebb, ellentmondó ("jegelve" jellegű)
memória, **NE pingelj/eszkalálj** — helyette a 7. lépés (Telegram-jelzés)
összegzésébe kerüljön be egy rövid megjegyzés ("X kártya technikailag
beakadt, de egy frissebb memória szerint szándékosan jegelve van, kihagyva
a pingelésből").

## 3. Amit NEM változtatunk

- `reggeli-napindito/SKILL.md`: nincs önálló módosítás (ld. fent).
- A `memoria-heartbeat` task (memória-mentés + skill-reflexió) nem érintett
  — az nem projekt-javaslatot generál, más réteg.
- Nem vezetünk be új adatbázis-táblát vagy API-végpontot — a meglévő
  `/api/memories?q=` keresés elég erre a célra.

## Ellenőrzés

- Manuális próbafuttatás: az okosugyintezo.hu projektre lefuttatva a
  memória-keresést, a memória id 320 (jegelve) találatnak fel kell jönnie
  és `created_at`-jának később kell lennie mint az érintett kártyák
  `updated_at`-ja — ha ez a próba nem hozza fel a konfliktust, a
  kulcsszó-választás (projekt-mező vs cím) hibás, azt kell finomítani.
- Következő éjszakai Dream Engine futás után: a `DREAM.md`-ben az
  okosugyintezo.hu-nak a "⚠️ Konfliktus" szekcióban kell megjelennie, NEM
  a "🎯 Top-3"-ban.
