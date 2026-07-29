BÉLA HOME v2
Hangvezérelt családi faliújság és konyhai AI-asszisztens
Felhasználói, funkcionális és termékkövetelmény-dokumentáció
Dokumentum státusza
Jóváhagyandó célállapot – nem a jelenlegi v1 leírása
Verzió
2.0
Dátum
2026. július 23.
Tulajdonos
Kiss István
„Előbb legyen természetes és megbízható. Csak utána legyen látványosan okos.”
Belső projekt- és fejlesztési alapdokumentum

0. A dokumentum célja és használata
Ez a dokumentum a Béla Home v2 teljes célállapotát írja le felhasználói és funkcionális nézőpontból. Nem a jelenlegi gyors prototípust tekinti végleges alapnak, hanem azt a rendszert határozza meg, amelyet a család napi szinten megbízhatóan használhat, és amely később WSL2-ről más Linux-hardverre – például Raspberry Pi-re vagy mini PC-re – is áthelyezhető.
Fontos státuszjelzés
A dokumentumban a „kell”, „kötelező” és „nem teheti” kifejezések elfogadott termékkövetelményt jelentenek. A „később” vagy „opcionális” jelölésű funkciók csak az alapok stabil működése után fejleszthetők.

Jelölés
Jelentés
KÖTELEZŐ
A v2 stabil kiadásának része; nélküle a rendszer nem tekinthető késznek.
KÉSŐBB
Hasznos, de csak a kötelező funkciók stabilizálása után készülhet el.
OPCIONÁLIS
Telepítésenként bekapcsolható vagy szolgáltatófüggő.
KIZÁRT
Tudatosan nem része a terméknek; Béla nem veheti fel önállóan a roadmapre.

0.1. A dokumentum elsődleges olvasói
A tulajdonos, aki jóváhagyja a termék működését és prioritásait.
Béla/Codex vagy más fejlesztő agent, amely a v2-t megvalósítja.
Későbbi emberi fejlesztő vagy auditor, aki ellenőrzi az architektúrát és az elfogadási feltételeket.
A családtagok, akik meg akarják érteni, mire képes a rendszer és mire nem.
0.2. A jelenlegi v1 és a v2 viszonya
A jelenlegi Béla Home v1 gyors prototípus: külön Node.js folyamatként fut ugyanabban a WSL2-környezetben, egy egyfájlos frontenddel, egy nagy szerverfájllal, localStorage- és JSON-alapú adattárolással, valamint részben a fő Béla heartbeatjére támaszkodó integrációkkal. A v1 értéke az, hogy megmutatta a valódi használati igényeket. A v2 nem egy vak újraírás: a bevált dizájn, szövegek és felhasználói folyamatok átvehetők, miközben a backend, az állapotkezelés és az integrációk hordozható alapokra kerülnek.

Tartalom
1. Vezetői összefoglaló
16. Lépésenkénti főzési munkamenet
2. Termékvízió, alapelvek és hatókör
17. Zene, YouTube és szórakozás
3. Felhasználók és napi élethelyzetek
18. Időjárás és napi információk
4. Rendszerkép és hordozhatóság
19. Valós idejű frissítés, háttérfolyamatok és értesítések
5. A fő kezelőfelület és navigáció
20. Offline és hibás működési módok
6. Természetes hangkommunikáció
21. Adminisztrációs felület
7. Családi memória és beszélgetési előzmények
22. Első telepítés és eszközpárosítás
8. Családi faliújság és napi állapot
23. Adatvédelem, biztonság és jogosultságok
9. Google Naptár
24. Kizárt és elhalasztott funkciók
10. Emlékeztetők és időzítők
25. Elfogadási feltételek és tesztelés
11. Reggeli összefoglaló AC/DC háttérzenével
26. Fejlesztési fázisok
12. Bevásárlólista és Google Keep
A. Google-integrációk kutatási melléklete
13. Gmail és emailküldés
B. Példabeszélgetések
14. Receptmód – többforrásos keresés
C. Fogalomtár és források
15. Kalória- és makrószámítás


1. Vezetői összefoglaló
A Béla Home v2 egy hangvezérelt, családi használatra tervezett digitális faliújság és konyhai asszisztens. A rendszer elsődleges feladata nem az, hogy minél több látványos AI-funkciót halmozzon fel, hanem hogy főzés és a napi családi szervezés közben gyorsan, természetesen és megbízhatóan segítsen.
A termék lényege
A család beszél hozzá; Béla megérti a kérést, valódi szolgáltatásokból adatot kér le vagy ellenőrzött műveletet hajt végre, röviden válaszol hanggal, és a részleteket a képernyőn jeleníti meg.

Pillér
Mit jelent a gyakorlatban
Hang
Kéz nélkül, magyarul, automatikus csendérzékeléssel, megszakítható válasszal.
Faliújság
Naptár, emlékeztetők, családi üzenetek, időjárás és aktív időzítők egy helyen.
Főzés
Otthoni alapanyagokból 3–6 valódi recept, több forrásból, linkkel és tápértékkel.
Memória
Szerkeszthető, megerősített családi preferenciák és releváns korábbi beszélgetések.
Integráció
Google Calendar, Gmail, Google Keep-export, YouTube és külső adatforrások.
Hordozhatóság
Most HP/WSL2 alatt fut, később ugyanaz a szerver Raspberry Pi-n vagy mini PC-n is.

1.1. A legfontosabb prioritási sorrend
1. A magyar hangfelismerés, a természetes hangos válasz és a hands-free működés stabilizálása.
2. A tartós, kézzel szerkeszthető családi memória kialakítása.
3. Megbízható, szerveroldali időzítők, emlékeztetők és élő naptárfrissítés.
4. A többforrásos, nem hallucináló receptkereső és a tápértékszámítás.
5. A közvetlen Google Calendar- és Gmail-integráció, valamint a Google Keep-export.
6. A hordozható backend, adminisztráció, mentés és biztonság.
7. Csak a végén: ébresztőszó finomítása és ElevenLabs hangklónozás.
1.2. Minőségi kapu
A rendszer akkor tekinthető használhatónak, ha a család több héten keresztül napi szinten képes rá támaszkodni úgy, hogy nem marad el emlékeztető, nem jön létre téves naptáresemény, nem szakad meg a főzési munkamenet, nem talál ki receptet vagy linket, és újraindítás után visszaáll az aktuális állapot.

2. Termékvízió, alapelvek és hatókör
2.1. Termékmeghatározás
A Béla Home v2 egy helyben futó szerverhez kapcsolódó, tablet- vagy telefonalapú családi asszisztens. A szerver tárolja a fontos adatokat, kezeli a háttérfolyamatokat, és közvetíti az AI- és Google-szolgáltatások felé irányuló kéréseket. A tablet a felhasználói felület, nem az adatok egyetlen tárolóhelye.
BH-C-001
KÖTELEZŐ
Hang az elsődleges kezelési mód
Főzés közben minden alapvető funkció – kérdezés, receptléptetés, időzítő, emlékeztető, lista – hanggal is használható legyen.

BH-C-002
KÖTELEZŐ
Valódi művelet, valódi visszaigazolás
Béla csak akkor mondhatja, hogy egy naptáreseményt, emlékeztetőt vagy emailt létrehozott, ha a háttérrendszer sikert igazolt.

BH-C-003
KÖTELEZŐ
Nincs recept- és linkhallucináció
A recept- és YouTube-találatok ellenőrzött külső eredmények legyenek. Ismeretlen helyzetben Béla mondja ki, hogy nem talált megfelelő találatot.

BH-C-004
KÖTELEZŐ
A család ura marad az emlékeinek
Minden tartós családi emlék megtekinthető, hozzáadható, szerkeszthető és törölhető az adminfelületen.

BH-C-005
KÖTELEZŐ
Hordozható szerver
Az alkalmazás üzleti logikája ne függjön Windowstól, WSL-től vagy a fő Bélától. Linux amd64 és arm64 környezetben is futtatható legyen.

2.2. Nem cél
Nem okosotthon-központ.
Nem teljes hűtő- vagy raktárkészlet-kezelő.
Nem vonalkódos leltározó.
Nem vállalati Kanban- vagy agentplatform.
Nem helyettesít dietetikust vagy orvosi tanácsadást.
Nem másol teljes receptoldalakat saját adatbázisba engedély nélkül.
Nem generál önállóan új termékfunkciókat tulajdonosi jóváhagyás nélkül.
2.3. Termékgazdai szabály
Roadmap-fegyelem
Béla vagy más fejlesztő agent új funkciót csak akkor vehet fel a roadmapre, ha az közvetlenül támogatja a dokumentumban rögzített pillérek egyikét, és a tulajdonos jóváhagyta.

3. Felhasználók és napi élethelyzetek
Felhasználó
Elsődleges szükséglet
Tipikus használat
István
Napi összefoglaló, naptár, beszélgetés, táplálkozási információ
Reggeli briefing; esti tervezés; kalória- és makróellenőrzés.
Erika
Főzés, időzítők, bevásárlólista
Alapanyag-alapú receptkeresés; lépésenkénti főzés; lista export.
Gyerekek
Egyszerű kérdések és időzítők
Időjárás, pomodoro, zene, rövid beszélgetés.
Vendég
Korlátozott, biztonságos funkciók
Időjárás, zene, receptötlet; tartós memória módosítása nélkül.
Admin
Beállítás és ellenőrzés
Memória, Google-kapcsolatok, jogosultságok, mentés, rendszerállapot.

3.1. Tipikus nap
Időszak
Kiemelt felület
Példa
06:00–09:00
Reggeli összefoglaló
Időjárás, mai események, fontos emlékeztetők, AC/DC háttérzene.
11:00–13:00 és 17:00–20:00
Receptmód és időzítők
„Van csirkemell és paprika. Mit főzzek?”
Napközben
Faliújság
Új naptáresemény vagy családi üzenet automatikusan megjelenik.
Bevásárlás előtt
Bevásárlólista
Lista megosztása Google Keepbe vagy emailben.
20:00–23:00
Másnapi tervezés
Naptár, ismétlődő emlékeztetők, beszélgetés.

3.2. Kontextuális, de nem kaotikus felület
A rendszer a napszak és az aktuális tevékenység alapján változtathatja a hangsúlyt, de nem rendezheti át kiszámíthatatlanul az egész felületet. A fő navigáció állandó; csak a kiemelt kártya mérete vagy sorrendje változhat.
4. Rendszerkép és hordozhatóság

4.1. Jelenlegi és célkörnyezet
Környezet
Szerep
Elvárás
HP gép + WSL2
Első fejlesztési és saját használati környezet
A v2 ugyanitt fusson tovább, de saját projekttel, függőségekkel és adatbázissal.
Raspberry Pi 4/5
Jövőbeli önálló háztartási szerver
ARM64-kompatibilis Node.js, SQLite, systemd vagy Docker.
Mini PC / NAS / Linux
Alternatív telepítés
Azonos konfigurációs elv és API-k.
Tablet / telefon
Kliens
Nem tartós állapotforrás; képernyő, mikrofon, hangszóró és érintés.

4.2. A fő Béla kapcsolata
A Béla Home önállóan is működjön. A jelenlegi fő Béla opcionális integrációként adhat extra kontextust vagy kezelhet közös feladatokat, de a Home alapfunkciói – naptár, Gmail, briefing, memória, emlékeztetők – nem függhetnek tőle. A kapcsolat szabályos API-n keresztül történjen, ne közös JSON-fájlok informális figyelésével.
4.3. Tartós állapot
A tartós adatok elsődleges forrása egy helyi SQLite-adatbázis. A böngésző localStorage-ja kizárólag felületi kényelmi állapotot tárolhat, például utoljára megnyitott lapot vagy be nem küldött szövegvázlatot.
Adat
Elsődleges tárolás
Megjegyzés
Családi memória
SQLite
Verziózott, szerkeszthető, visszakövethető.
Naptár helyi másolata
SQLite
Google sync tokennel frissítve.
Emlékeztetők és időzítők
SQLite + scheduler
Tablet alvásától független.
Aktív receptmunkamenet
SQLite
Újranyitás után folytatható.
Bevásárlólista
SQLite
Minden eszközön ugyanaz.
Chatelőzmény
SQLite, szabályozott megőrzés
Törölhető; nem minden mondat lesz tartós memória.

5. A fő kezelőfelület és navigáció
A felület világos, meleg, konyhai hangulatú legyen: törtfehér és világos bézs alap, zsálya- és olívazöld hangsúlyokkal, visszafogott arany elemekkel. A zöldségek, gyümölcsök és konyhai motívumok dekorációként jelenhetnek meg, de nem csökkenthetik az olvashatóságot.
Fő nézet
Tartalom
Elsődleges művelet
Kezdőlap / faliújság
Óra, időjárás, következő esemény, emlékeztetők, időzítők, lista
Beszélj Bélával
Beszélgetés
Utolsó releváns üzenetek, kártyák, linkek
Hang vagy szöveg
Receptmód
Találatok vagy aktuális főzési lépés
Kiválasztás / következő lépés
Naptár
Napi és heti áttekintés
Esemény hozzáadása / módosítása
Bevásárlólista
Szinkronizált lista
Hozzáadás / Keep / Gmail
Beállítások / admin
Memória, integrációk, hang, értesítés, rendszer
Ellenőrzött konfiguráció

5.1. Képernyőkímélő és kioszk jelleg
A kijelző inaktivitáskor átválthat nagy órára, időjárásra és következő eseményre. Ez nem végleges eszközlezárás: az iPad Air más célra is használható, ezért a rendszer egy érintéssel kiléphető, és az alkalmazás később ugyanott folytatja az állapotot.
5.2. Nagy érintési célok
A legfontosabb gombok legalább 44×44 képpontos érintési célterületet kapjanak.
Főzés közben a mikrofon, következő lépés, időzítő és nyugtázás legyen kiemelten nagy.
Veszélyes vagy visszafordíthatatlan művelethez megerősítés kell.
A hangos állapotot egyértelmű vizuális jelzés kísérje: hallgat, feldolgoz, beszél, hiba.
6. Természetes hangkommunikáció

6.1. Célélmény
A felhasználó ne hangüzenetet küldjön egy chatbotnak, hanem rövid, természetes beszélgetést folytasson. Béla érzékelje a mondat végét, gyorsan kezdjen válaszolni, és azonnal hallgasson el, ha a felhasználó közbevág.
BH-V-001
KÖTELEZŐ
Automatikus csendérzékelés
A felvétel kézi második gombnyomás nélkül álljon le. A rendszer VAD-dal érzékelje a beszéd végét, de konyhai zajban se vágja le a mondatot.

BH-V-002
KÖTELEZŐ
Barge-in / félbeszakítás
Ha a felhasználó Béla beszéde közben megszólal, a hanglejátszás álljon le, és az új kérés feldolgozása induljon el.

BH-V-003
KÖTELEZŐ
Rövid hang, részletes képernyő
Hangosan rövid, cselekvésorientált válasz hangozzon el. A recept, link, hozzávalók vagy naptárrészletek a képernyőn jelenjenek meg.

BH-V-004
KÖTELEZŐ
Magyar pontosság
A beszédfelismerés magyar nyelvre legyen rögzítve, és kapjon kontextust a család neveiről, konyhai szavakról és gyakori helynevekről.

BH-V-005
KÖTELEZŐ
Átirat megjelenítése
A felhasználó lássa, mit értett a rendszer; téves átirat esetén egy érintéssel javíthassa vagy újramondhassa.

6.2. Bevezetési fokozatok
Fázis
Működés
Indok
1. Stabil alap
Mikrofongomb → VAD auto-stop → STT → válasz → TTS
Jól tesztelhető és hibakereshető.
2. Aktív beszélgetési mód
Egy gomb után több váltás; a rendszer rövid ideig folyamatosan figyel
Főzés közben kevesebb érintés.
3. Realtime beszélgetés
WebRTC-alapú speech-to-speech, beépített VAD és megszakítás
Alacsonyabb késleltetés és természetesebb élmény.
4. Ébresztőszó
„Szia Béla” csak stabil alap után
iPad- és böngészőkorlátok miatt nem lehet az első mérföldkő.

6.3. AI- és hangszolgáltató
Az elsődleges szolgáltató OpenAI. A hagyományos láncban a beszédátíráshoz GPT-4o transcribe modell, a válaszhoz gyors általános modell, a beszédhez GPT-4o mini TTS használható. A végleges természetes beszélgetési mód az OpenAI Realtime API és WebRTC irányába épüljön. A modell- és hangválasztás az adminfelületből módosítható legyen, ne legyen a kódba égetve.
Miért nem kell most Claude vagy DeepSeek?
A Claude és a DeepSeek a középső szöveges „agy” szerepét tölthetné be, de a hangfelismerést és a beszédet továbbra is más szolgáltatásnak kellene biztosítania. Ez most több késleltetést, hibapontot és konfigurációt hozna valódi előny nélkül.

6.4. Hangbeállítások
Hangszín és beépített hang kiválasztása.
Beszédtempó és rövidség.
Fő hangerő és értesítési hangerő külön.
VAD érzékenység és maximális felvételi idő.
Konyhai zajteszt és mikrofonteszt.
Később ElevenLabs saját vagy engedélyezett hang – csak minden más stabil működése után.
6.5. Példabeszélgetés
Felhasználó
Béla Home
„Béla, tegyél fel tíz percet a tésztának.”
„Elindítottam a Tészta nevű 10 perces időzítőt.”
„Nem, legyen tizenkettő.”
„Módosítottam: 12 perc van hátra.”
„Közben mondd a következő receptlépést.”
„Most add hozzá a felkockázott paprikát, és pirítsd két percig. A részletek a képernyőn vannak.”

7. Családi memória és beszélgetési előzmények
A memória nem profiljáték és nem automatikus adatgyűjtés. A cél, hogy Béla megbízhatóan ismerje a család tartós preferenciáit, rutinjait és korábban jóváhagyott információit, miközben a felhasználó teljes ellenőrzést kap.
7.1. Memóriatípusok
Típus
Példa
Felhasználás
Háztartási ételpreferencia
„A család nem eszik gombát.”
Recepttalálatok kizárása vagy hátrasorolása.
Személyes preferencia
„István szereti a csípős ételeket.”
Személyhez igazított rangsorolás.
Kedvelt alapanyag
„Gyakran használunk csirkemellet és görög joghurtot.”
Alapanyag-alapú javaslat.
Kerülendő összetevő
„Kevés fokhagyma mehet, sok ne.”
Recept értékelése.
Allergia / diéta
Csak kifejezett, megerősített adat
Biztonsági szűrés; automatikus következtetés tilos.
Bevált recept
„Ezt már elkészítettük, 5/5.”
Előresorolás és gyors újranyitás.
Családi rutin
„Csütörtökönként edzés van.”
Napi briefing és emlékeztető.
Egyéb tény
„A gyerekek 5 és 7 évesek.”
Kornak megfelelő válaszok, ha szükséges.

7.2. „Mit tud rólunk Béla?” adminoldal
Kereshető és szűrhető memóriajegyzék.
Új emlék kézi hozzáadása.
Meglévő emlék szerkesztése és törlése.
Hozzárendelés: egész háztartás vagy konkrét személy.
Forrásjelzés: kézzel megadott, beszélgetésből megerősített, importált.
Létrehozás és utolsó módosítás ideje.
Opcionális változásnapló és visszavonás.
7.3. Automatikus tanulás szabálya
Felhasználó
Béla Home
„Ezt a csirkét sok paprikával szeretjük.”
„Ezt csak a mai ételre érted, vagy jegyezzem meg családi preferenciaként?”
„Jegyezd meg.”
„Rendben. Elmentettem: a család a csirkés ételeket sok paprikával kedveli.”

Tiltás
Béla nem találhat ki allergiát, betegséget, diétát vagy személyes preferenciát. Ezek csak kifejezett felhasználói állításból és megerősítés után kerülhetnek a tartós memóriába.

7.4. Beszélgetési memória
A rendszer őrizze meg az aktuális beszélgetés kontextusát és a hasznos korábbi beszélgetéseket, de ne keverje össze a chatelőzményt a tartós memóriával. A felhasználó törölhesse az előzményeket, és beállíthassa a megőrzési időt.
8. Családi faliújság és napi állapot
A kezdőlap a hagyományos családi faliújság digitális megfelelője. Egy pillantással mutassa a mai nap lényegét, és hanggal is lekérdezhető legyen.
Kártya
Tartalom
Frissítés
Óra és dátum
Nagy, jól olvasható idő és nap
Helyben, folyamatosan.
Időjárás
Jelenlegi idő, napi minimum/maximum, figyelmeztetés
Időjárás-szolgáltatásból.
Következő esemény
Következő releváns naptárbejegyzés
Google Calendar szinkron után azonnal.
Emlékeztetők
Mai és esedékes tételek
Szerveroldali scheduler.
Időzítők
Aktív visszaszámlálók
Szerveridő alapján.
Bevásárlólista
Nyitott tételek és darabszám
Minden eszközön szinkron.
Családi üzenet
Rövid, kézzel vagy hanggal rögzített faliújság-üzenet
SSE-n azonnal megjelenik.

8.1. Családi üzenetek
Felhasználó
Béla Home
„Írd ki a faliújságra, hogy holnap úszás lesz, vigyük a felszerelést.”
„Kitettem a családi faliújságra holnapra: Úszás – vigyük a felszerelést.”
„Töröld, már bepakoltunk.”
„Eltávolítottam az üzenetet.”

9. Google Naptár
A Béla Home közvetlenül a Google Calendar API-val kezelje a kiválasztott naptárakat. Ne a fő Béla informális heartbeatjére várjon, és ne mondja azt, hogy egy esemény bekerült, amíg nem kapott sikeres API-választ.
BH-GC-001
KÖTELEZŐ
Naptárak kiválasztása
Az admin megadhatja, mely naptárak jelenjenek meg, és melyik legyen az alapértelmezett írási cél.

BH-GC-002
KÖTELEZŐ
Megerősített eseménylétrehozás
Béla ismételje vissza a konkrét dátumot, időt, címet és időtartamot; bizonytalan adatnál kérdezzen vissza.

BH-GC-003
KÖTELEZŐ
Élő szinkron
A szerver inkrementális szinkronnal érzékelje a napközbeni változásokat, és teljes oldalfrissítés nélkül frissítse a kártyát.

BH-GC-004
KÖTELEZŐ
Ismétlődő esemény
Támogassa a napi, heti és egyedi ismétlődést, valamint az egyetlen előfordulás vagy teljes sorozat módosítását.

9.1. Példa – esemény létrehozása
Felhasználó
Béla Home
„Vedd fel a naptárba jövő csütörtökre tízre a fogorvost.”
„Jövő csütörtökön, július 30-án 10:00-ra szeretnéd felvenni a Fogorvos eseményt. Mennyi ideig tartson?”
„Egy órát.”
„Rendben. Létrehoztam július 30-án 10:00–11:00 között az alapértelmezett családi naptárban.”

9.2. Ütközések
Ha az új esemény ütközik egy meglévővel, Béla ne írja fel automatikusan. Mutassa az ütközést és ajánljon alternatív időpontot vagy kérjen megerősítést.
10. Emlékeztetők és időzítők
10.1. Időzítők
Több párhuzamos, elnevezett időzítő.
Szerveroldali befejezési idő; a visszaszámlálás nem állhat le a tablet alvásakor.
Lejáratkor hang, vizuális jelzés, rendszerértesítés és nyugtázás.
Szüneteltetés, hosszabbítás, törlés és „emlékeztess 5 perc múlva”.
Aktív recepthez kapcsolható időzítő.
10.2. Emlékeztetők
Egyszeri, napi, heti és egyedi ismétlődés.
Határidő, címke, értesítési csatorna és címzett.
Elhalasztás: 5, 10, 30 perc vagy egyedi idő.
Nyugtázás és teljesítve állapot.
Kritikus emlékeztetőnél több csatorna is választható: tablet push, hang, Telegram vagy Gmail.
10.3. Faliújság-jellegű emlékeztető
Felhasználó
Béla Home
„Emlékeztess mindenkit este hétkor, hogy holnap kirándulás van.”
„Beállítottam ma 19:00-ra. A faliújságon is megjelenik, és a konyhai eszköz hangosan jelez.”
„Ha nem nyugtázzuk, szólj újra tíz perc múlva.”
„Bekapcsoltam az egyszeri 10 perces ismétlést.”

11. Reggeli összefoglaló AC/DC háttérzenével
A reggeli briefing egy tudatosan megtartott, különleges funkció. A rendszer a napi információkat rövid, jól strukturált hangos összefoglalóvá alakítja, miközben halk AC/DC háttérzene szól.
Elem
Szabály
Indítás
Időzítve vagy érintésre; ne induljon váratlanul éjszaka.
Tartalom
Időjárás, naptár, fontos emlékeztetők, családi üzenetek, opcionális rövid motiváló mondat.
Zene
Alapértelmezett AC/DC; külön ki- és bekapcsolás és hangerő.
Ducking
Béla beszéde alatt a zene automatikusan halkuljon, utána visszaállhat.
Fallback
Ha az előre generált briefing hiányzik, a szerver élő adatokból készítse el.
Frissesség
A napi összefoglaló ne használjon tegnapi eseményeket aktuálisként.

Szerzői jogi és technikai megjegyzés
A háttérzene lejátszása csak olyan forrásból történjen, amelynek használata és beágyazása megfelel a szolgáltató feltételeinek. A zene ne kerüljön tárolásra vagy újraközlésre a Béla Home szerveren.

12. Bevásárlólista és Google Keep
A bevásárlólista elsődleges, hiteles példánya a Béla Home saját adatbázisában él. Ezt minden párosított eszköz ugyanúgy látja. A Google Keep célja kényelmes külső használat, nem az alapadatok kizárólagos tárolása.
BH-SH-001
KÖTELEZŐ
Szinkronizált lista
Hozzáadás, kipipálás és törlés minden eszközön azonnal megjelenik.

BH-SH-002
KÖTELEZŐ
Hangos kezelés
„Tegyél a listára két tejet és paradicsomot.”, „A tejet vettem meg.”

BH-SH-003
KÖTELEZŐ
Forráskapcsolat
A kiválasztott recept hiányzó hozzávalói egyenként vagy egy gombbal a listára tehetők.

BH-SH-004
KÖTELEZŐ
Kimenetek
Google Keep-export, Gmail, vágólap és megosztási lap.

12.1. Google Keep – kutatási eredmény és döntés
Következtetés
A hivatalos Google Keep API képes szöveges és listajegyzet létrehozására, de a Google azt vállalati/Workspace-adminisztrációs környezetre pozicionálja, domain-wide delegationnel. Egy átlagos személyes Gmail-háztartásnál ezért nem szabad a közvetlen Keep API-t kötelező alapnak tekinteni.

12.2. Kötelező személyes Gmail-megoldás
1. A felhasználó megnyomja a „Küldés Google Keepbe” gombot.
2. A Béla Home összeállítja a címet és a listatételeket.
3. A Web Share API megnyitja az eszköz natív megosztási lapját.
4. A felhasználó kiválasztja a Google Keep alkalmazást, ha telepítve van.
5. Fallback: másolás vágólapra és Google Keep megnyitása.
6. A művelet felhasználói érintést igényel; teljesen automatikus háttérszinkron nem ígérhető.
12.3. Opcionális Workspace-integráció
Megfelelő Google Workspace-környezetben, adminisztrátori jóváhagyással a Keep API közvetlenül létrehozhat listajegyzetet és jelölőnégyzetes tételeket. Ez külön opcionális integráció legyen, és az adminfelület csak akkor ajánlja fel, ha az OAuth- és szervezeti feltételek teljesülnek.
12.4. Nincs kötelező kétirányú Keep-szinkron
A v2 alapverzió nem ígér folyamatos kétirányú Google Keep-szinkront. A Keepbe küldött lista másolat vagy export. Az elsődleges lista továbbra is a Béla Home-ban marad, így a rendszer nem veszti el az adatokat akkor sem, ha a Keep-integráció nem elérhető.
13. Gmail és emailküldés
A Gmail-integráció két tudatosan különválasztott üzemmódot ad: piszkozatkészítés és közvetlen küldés. A rendszer a lehető legszűkebb OAuth-jogosultságot kérje, és a nyilvános termékverzió készüljön fel a Google OAuth-ellenőrzési követelményeire.
Mód
Működés
Biztonsági szabály
Piszkozat
Béla elkészíti a Gmail-piszkozatot
Alapértelmezett hosszabb vagy érzékeny levélnél.
Közvetlen küldés
A Gmail API azonnal elküldi
Csak egyértelmű „küldd el” utasítás és címzett-visszaigazolás után.
Bevásárlólista
Formázott lista küldése
Előre beállított családi címzett választható.
Rendszerértesítés
Hiba vagy biztonsági mentés jelzése
Admin által engedélyezett címre.

13.1. Példa
Felhasználó
Béla Home
„Küldd el Erikának a bevásárlólistát.”
„A listán 8 tétel van. Erikának, az erika@example.com címre küldjem?”
„Igen.”
„Elküldtem a Gmail-fiókodból. A küldés azonosítója naplózva van.”
„Írj Péternek egy emailt, hogy késni fogok.”
„Készítsek piszkozatot, vagy küldjem el azonnal?”

13.2. Jogosultság és termékesítés
Saját háztartási tesztnél egy Google Cloud projekt és saját tesztfelhasználó elegendő lehet, de „Testing” állapotban a refresh token korlátozott ideig érvényes. Stabil saját használathoz is megfelelő OAuth-publikálási beállítás kell. Nyilvánosan értékesített verziónál a Gmail- és Calendar-scope-ok Google-ellenőrzést, adatkezelési dokumentációt és esetenként további biztonsági követelményeket válthatnak ki.
14. Receptmód – többforrásos, ellenőrzött keresés

14.1. Alapszabály
Kötelező korlát
Béla nem talál ki receptet. Csak ténylegesen megtalált, működő forráslinkkel rendelkező recepteket ajánlhat.

14.2. Bemenet
A felhasználó hanggal vagy kézzel felsorolja az otthon lévő fő alapanyagokat. A rendszer legfeljebb a döntéshez szükséges pontosító kérdéseket teszi fel: adag, időkeret, elkészítési eszköz, kalória- vagy fehérjecél. Nem épül teljes hűtőkészlet-nyilvántartás.
Felhasználó
Béla Home
„Van itthon csirkemell, répa, paprika, hagyma és krumpli.”
„Hány főre és nagyjából mennyi idő alatt szeretnél főzni?”
„Négy főre, egy órán belül, lehetőleg magas fehérjével.”
„Rendben. Több magyar receptoldalon keresek 3–6 olyan ételt, amelynek ezek a fő összetevői.”

14.3. Források
A kereső több, adminban jóváhagyott népszerű receptoldalt használjon. Kezdő forráslista: Mindmegette, Nosalty, GastroHobbi, Street Kitchen. További forrás csak tulajdonosi jóváhagyással adható hozzá. Ha nincs hivatalos API, a rendszer elsősorban keresési találatokat, strukturált oldaladatokat és forráslinket használjon; ne másolja le automatikusan a teljes szerzői jogi tartalmat.
14.4. Találatok száma és rangsorolása
BH-R-001
KÖTELEZŐ
Legalább 3, legfeljebb 6 variáció
Ha legalább három megfelelő találat elérhető, a rendszer ne álljon meg egyetlen ajánlatnál. Hatnál több találat ne terhelje a főképernyőt.

Rangsorolási tényező
Hatás
Fő alapanyagok egyezése
A legtöbb megadott fő összetevőt használó recept kerül előre.
Hiányzó hozzávalók
Kevesebb és könnyebben beszerezhető hiány előny.
Családi memória
Nem kedvelt vagy kerülendő összetevő hátrasorol vagy kizár.
Időkeret
A felhasználó által megadott időn belül elkészíthető legyen.
Táplálkozási cél
Magasabb fehérje, alacsonyabb energia vagy más beállított cél.
Korábbi értékelés
Bevált családi recept előresorolható.
Forrásminőség
Működő link, teljes mennyiségek, adag és értékelés előny.

14.5. Receptkártya
Recept neve és ételfotó, ha a forrás jogszerűen biztosítja.
Forrásoldal neve és ellenőrzött link.
Egyező otthoni alapanyagok, nem használt alapanyagok és hiányzó hozzávalók.
Elkészítési idő, adag, nehézség.
Teljes és adagonkénti kalória, fehérje, szénhidrát és zsír – pontossági jelzéssel.
„Megnyitás a forrásoldalon”, „Főzés indítása”, „Hiányzók listára” és „Mentés kedvencként” gomb.
14.6. Nincs találat
Ha nincs legalább három jó találat, Béla mondja ki pontosan, hányat talált, és kérje a feltételek lazítását. Nem töltheti ki a hiányzó helyeket saját generált receptekkel.
15. Kalória- és makrószámítás
A táplálkozási számítás a receptből kinyert pontos mennyiségek és külön tápanyag-adatbázis alapján történik. A nyelvi modell segíthet az alapanyag nevének normalizálásában, de nem találhat ki kcal- vagy makróértéket.
Kimenet
Kötelező megjelenítés
Teljes étel
Összes kcal, fehérje, szénhidrát és zsír.
Egy adag
Az adagok számával osztott értékek.
Alapanyagonként
Opcionális részletezés: melyik összetevő mennyit ad hozzá.
Pontossági szint
Pontosabb / becsült / nem számítható.
Feltételezések
Például „10 g olajjal számolva” vagy „nyers tömeg alapján”.
Forrás
A használt tápanyag-adatbázis megnevezése.

15.1. Adatforrás
Első, nyílt adatforrásként a USDA FoodData Central használható: REST API-t biztosít tápanyagadatokhoz, az adatai nyilvános felhasználásúak. A magyar alapanyag-nevekhez normalizáló szótár és ellenőrzött megfeleltetés kell. Kereskedelmi alternatívaként receptszintű elemző API is választható, de annak licenc-, cache- és attribúciós feltételeit külön kell kezelni.
15.2. Pontossági szabályok
A mennyiség nélküli „egy kevés olaj” nem adható meg pontos számként.
A nyers és főtt tömeg közötti különbséget jelölni kell.
Márkás terméknél a konkrét címkeadat előnyben részesíthető.
Az étkezés egészségességét nem lehet kizárólag a kalória alapján minősíteni.
Az eredmény tájékoztató jellegű; orvosi vagy dietetikai döntéshez szakember kell.
15.3. Dinamikus újraszámítás
Felhasználó
Béla Home
„Csak 300 gramm csirkét teszek bele, és 10 gramm olajat.”
„Újraszámoltam. A teljes étel becsült értéke 1 860 kcal, egy adag 465 kcal. A fehérje 42 g adagonként.”
„Legyen öt adag.”
„Öt adagra osztva egy adag 372 kcal. A részletes makrók frissültek a képernyőn.”

16. Lépésenkénti főzési munkamenet
A kiválasztott receptből Béla külön főzési munkamenetet hoz létre. A munkamenet állapota a szerveren tárolódik, így oldalbezárás, Wi-Fi-kimaradás vagy másik eszköz megnyitása után folytatható.
Állapot
Példa
Kiválasztott recept
Forráslink, hozzávalók, adagok.
Módosított mennyiségek
A felhasználó ténylegesen használt mennyiségei.
Aktuális lépés
4/9 – „Add hozzá a paprikát.”
Aktív időzítők
Tészta 8:20, sütő 24:10.
Tápérték
Az aktuális mennyiségekkel újraszámítva.
Jegyzet és értékelés
„Kevesebb sóval jobb”, 4/5.

16.1. Hangparancsok
„Indítsuk el.”
„Olvasd fel újra.”
„Kész, következő.”
„Lépj vissza.”
„Mennyi paprika kell?”
„Indítsd el a 15 perces időzítőt.”
„Mennyi van még hátra?”
„Módosítsd 300 gramm csirkére.”
„Állítsd le a főzést, később folytatom.”
17. Zene, YouTube és szórakozás
Béla képes zenét és videót keresni, linket megjeleníteni, egyszerű beszélgetést folytatni, viccet vagy rövid történetet mondani. A keresési eredményeket valódi YouTube-keresésből kell lekérni.
BH-YT-001
KÖTELEZŐ
Valódi YouTube-találat
A rendszer cím, csatorna, bélyegkép, videóazonosító és ellenőrzött link alapján jelenítsen meg találatot.

BH-YT-002
KÖTELEZŐ
Nincs kitalált videó
Ha nincs API-találat, Béla ne nevezzen meg úgy konkrét videót, mintha megtalálta volna.

BH-YT-003
KÖTELEZŐ
Felhasználói indítás
A videó vagy zene alapértelmezetten felhasználói érintésre induljon; ne legyen váratlan autoplay.

BH-YT-004
KÖTELEZŐ
Forrásjelzés
A felületen egyértelműen látszódjon, hogy a tartalom YouTube-ról származik.

17.1. Példa
Felhasználó
Béla Home
„Keress valami magyar rockzenét.”
„Három YouTube-találatot találtam. A képernyőn látod a címet és a csatornát. Melyiket nyissam meg?”
„Az elsőt.”
„Megnyitottam a YouTube-lejátszót. A lejátszást érintéssel indíthatod.”

18. Időjárás és napi információk
Az időjárás a faliújság, a reggeli briefing és a beszélgetés közös adatforrásából érkezzen. A látható widget és Béla hangos válasza nem mondhat eltérő várost vagy eltérő adatot.
Adminban állítható alapértelmezett város és ideiglenes utazási helyszín.
Megbízható elsődleges szolgáltató és fallback.
Jelenlegi idő, napi minimum/maximum, csapadék, szél és releváns figyelmeztetés.
Adatfrissítés háttérben; hibánál utolsó frissítés ideje látható.
Béla ne állítsa biztosra a gyorsan változó előrejelzést, ha az adat régi vagy a szolgáltatás nem elérhető.
19. Valós idejű frissítés, háttérfolyamatok és értesítések
A Béla Home nem frissítheti újra rendszeresen az egész weboldalt, mert az megszakítaná a hangot, videót, főzési munkamenetet és a beírt szöveget. A szerver külön adat- és eseményfrissítést küld a kliensnek.
19.1. Saját háttérfolyamat – nem AI-heartbeat
Feladat
Javasolt gyakoriság
AI kell?
Esedékes időzítők ellenőrzése
Másodperces pontosság / scheduler
Nem
Emlékeztetők ellenőrzése
Folyamatos / percenként
Nem
Google Calendar változások
1–3 percenként inkrementális sync
Nem
Időjárás frissítése
10–30 perc
Nem
Reggeli briefing
Napi időzítés
Igen, csak a szövegezéshez
Sikertelen feladat újrapróbálása
Háttér queue szerint
Nem
Mentés és karbantartás
Naponta
Nem

19.2. Aktív képernyő frissítése
A szerver Server-Sent Events (SSE) csatornán eseményt küld. A frontend csak az érintett komponenst frissíti. A hangkapcsolat külön WebRTC-csatornán működhet.
Esemény
Frissülő rész
calendar.updated
Naptárkártya és következő esemény.
reminder.due
Felugró értesítés, hang, faliújság.
timer.expired
Riasztó és időzítőlista.
shopping.updated
Bevásárlólista minden eszközön.
memory.updated
Admin memóriaoldal és AI-kontextus.
briefing.ready
Reggeli összefoglaló sáv.
system.status
Kapcsolat- és hibaállapot.

19.3. Alvó vagy bezárt tablet
A szerver tovább dolgozik. Fontos emlékeztető és lejárt időzítő esetén Web Push vagy más beállított csatorna értesít. Újranyitáskor a kliens előbb teljes állapotot kér, majd folytatja az eseményfolyamot.
20. Offline és hibás működési módok
Hiba
Felhasználói viselkedés
Megmaradó funkció
Nincs internet
„Az online AI és keresés nem elérhető.”
Helyi lista, memória, időzítők, emlékeztetők, korábban mentett recept.
OpenAI hiba
Újrapróbálás és érthető hiba
Nem áll le az egész oldal.
Google token lejárt
Admin értesítés és újracsatlakoztatás
Helyi naptármásolat csak olvasható, frissességi jelzéssel.
Receptoldal nem elérhető
Találat kihagyása vagy „nem elérhető”
Más források keresése.
Tápanyagadat hiányzik
Becsült vagy nem számítható jelzés
Recept továbbra is megnyitható.
Szerver újraindult
Automatikus helyreállás
Aktív állapot SQLite-ból visszatöltődik.

20.1. Hibaüzenetek hangneme
Lehet közvetlen és enyhén személyes, de ne viccelje el a fontos hibát. A felhasználó kapjon egyértelmű állapotot és következő lépést.
Felhasználó
Béla Home

„A Google Naptár kapcsolata lejárt, ezért az új eseményt még nem tudtam elmenteni. Az adminban újra kell kapcsolni a Google-fiókot.”

„Nem találtam három megbízható receptet ezekkel a feltételekkel. Lazítsunk az időkereten, vagy engedjünk meg egy plusz hozzávalót?”

21. Adminisztrációs felület
A független Béla Home nem támaszkodhat kézzel szerkesztett konfigurációs fájlokra. Az adminoldal komoly, de áttekinthető kezelőközpont legyen. A napi felület és az adminfelület vizuálisan és jogosultságban különüljön el.
21.1. Admin menüpontok
Menü
Tartalom
Általános
Háztartás neve, nyelv, időzóna, város, dátumformátum.
Család és memória
Emlékek, személyek, ételpreferenciák, rutinok, allergiák – csak megerősített adatok.
AI és hang
Szolgáltató, modellek, hang, tempó, VAD, költségkorlát, később ElevenLabs.
Google
Fiók, Calendar, Gmail, Keep-képesség, scope-ok, utolsó sync, újraengedélyezés.
Receptek
Engedélyezett oldalak, találatszám, rangsorolás, tápanyagforrás.
Értesítések
Push, hang, Telegram, Gmail, csendes időszak, ismétlés.
Eszközök
Párosított tabletek/telefonok, utolsó elérés, push állapot, visszavonás.
Biztonság
Adminjelszó, munkamenetek, auditnapló, titkok állapota.
Rendszer
Verzió, CPU/RAM/tárhely, adatbázis, API-státusz, logok, mentés és frissítés.

21.2. Titkok kezelése
Biztonsági követelmény
OpenAI-, Google-, YouTube- vagy ElevenLabs-kulcsot nem szabad a napi konyhai felületen megjeleníteni. A titkok csak admin jogosultsággal, HTTPS-en és szerveroldali védett tárolásban kezelhetők.

21.3. Rendszerállapot
Béla Home szerver fut-e.
Utolsó sikeres Google Calendar szinkron.
Gmail és Keep kapcsolat státusza.
OpenAI és hangszolgáltató elérhetősége.
Háttérfeladat-queue és sikertelen próbálkozások.
Adatbázis és utolsó mentés állapota.
Aktív kliensek és értesítési jogosultságok.
22. Első telepítés és eszközpárosítás
22.1. Telepítési varázsló
1. Adminfiók létrehozása.
2. Háztartás neve, nyelv, időzóna és város.
3. OpenAI kapcsolat és hangteszt.
4. Google OAuth összekapcsolás.
5. Naptárak és alapértelmezett naptár kiválasztása.
6. Gmail-küldési jogosultság és biztonsági mód.
7. Google Keep képességvizsgálat: Workspace API vagy megosztásos export.
8. Receptforrások és tápanyag-adatforrás.
9. Értesítési csatornák és csendes időszak.
10. Első családi memóriaadatok.
11. Tablet/telefon párosítása.
12. Önellenőrző teszt és mentés.
22.2. Eszközpárosítás
A kliens QR-kóddal vagy rövid, egyszer használatos párosítási kóddal csatlakozik. A párosított eszköz saját tokennel rendelkezik, amely az adminból visszavonható. A vendég mód csak alacsony kockázatú funkciókat enged.
23. Adatvédelem, biztonság és jogosultságok
Elv
Követelmény
Helyi adatelsőség
A családi memória, listák és állapotok helyben, a háztartás szerverén maradnak.
Átlátható felhőhasználat
A hang és kérdés csak a szükséges szolgáltatóhoz kerül; az admin látja, melyik funkció küld adatot külső félnek.
Legkisebb jogosultság
Google OAuth csak az adott funkcióhoz szükséges scope-okat kérje.
HTTPS
Mikrofon, OAuth, admin és titkok miatt a helyi felület is biztonságos originen fusson.
Hitelesítés
A LAN-hozzáférés önmagában nem jogosultság; eszközpárosítás és adminvédelem kell.
Audit
Emailküldés, naptárírás, memóriamódosítás és adminművelet naplózva legyen.
Mentés
Az adatbázis automatikusan menthető és visszaállítható legyen.
Export és törlés
A család saját adatait exportálhatja és teljesen törölheti.

23.1. Gyerekek és vendégek
A gyerekek és vendégek nem módosíthatnak tartós családi memóriát, Google-kapcsolatot, címzettlistát vagy adminbeállítást. Általános kérdés, időjárás, zene és korlátozott időzítő engedélyezhető.
24. Kizárt és elhalasztott funkciók
Funkció
Státusz
Indok
Vonalkódolvasó
KIZÁRT
Nem támogatja a fő használati esetet; készletkezeléshez vezetne.
Teljes hűtőkészlet-nyilvántartás
KIZÁRT
Túl nagy adatbeviteli teher; alapanyagokat kérdésenként adunk meg.
Notion-export
KIZÁRT
Google Keep és Gmail elegendő.
Teljes profilválasztó UI
KIZÁRT
A háttérben lehet személyhez kötés, de nem ez legyen a napi UX.
Okosotthon-vezérlés
KIZÁRT
Más termékkategória.
Egyetlen receptoldalra épülés
KIZÁRT
Több forrás és ellenőrzés kötelező.
Automatikus, megerősítés nélküli memória
KIZÁRT
Pontatlanság és adatvédelmi kockázat.
ElevenLabs hangklónozás
KÉSŐBB
Csak a teljes alaprendszer stabilitása után.
Ébresztőszó
KÉSŐBB
Előbb VAD, Realtime és eszközkompatibilitás.
Kereskedelmi licenc és központi SaaS
KÉSŐBB
Előbb saját háztartásban 4–8 hét stabil használat.

25. Elfogadási feltételek és tesztelés
25.1. Hang
Legalább 50 magyar konyhai és napi mondat tesztje csendben és elszívó/vízcsap mellett.
A mondat eleje és vége nem vágódik le.
A felhasználó Béla válaszát félbe tudja szakítani.
A teljes kérdés–első hangválasz késleltetése normál hálózaton elfogadható és mérve van.
Téves átirat vizuálisan javítható.
25.2. Megbízhatóság
Szerver- és tablet-újraindítás után aktív emlékeztetők, időzítők és receptmunkamenet helyreáll.
Naptárváltozás teljes oldalfrissítés nélkül megjelenik.
Tablet alvásakor a szerveroldali időzítő tovább fut.
Két eszköz ugyanazt a bevásárlólistát látja.
Külső API-hiba nem teszi használhatatlanná az egész alkalmazást.
25.3. Recept és tápérték
A rendszer 3–6 valódi, kattintható receptet mutat, vagy őszintén jelzi, ha nincs ennyi.
Minden találatnál forrás és működő link van.
A megadott alapanyagok egyezése és a hiányzók helyesen jelennek meg.
A kcal és makró kézi mintaszámítással összevethető.
Bizonytalan mennyiségnél „becsült” jelzés jelenik meg.
A GPT nem adhat forrás nélküli tápértéket.
25.4. Google és memória
Esemény csak sikeres Calendar API-válasz után kap „elkészült” státuszt.
Email címzettje és küldési módja visszaigazolható.
Keep-export személyes fióknál működik megosztással vagy fallback másolással.
Minden tartós emlék adminban látható és szerkeszthető.
Allergia vagy diéta nem kerülhet be automatikus következtetésből.
26. Fejlesztési fázisok
Fázis
Tartalom
Kiadási feltétel
0. V1 befagyasztás
Git-tag, mentés, csak kritikus hibajavítás
A prototípus bármikor visszaállítható.
1. V2 alap
Saját projekt, config, SQLite, auth, HTTPS, scheduler, SSE, adminváz
HP/WSL alatt stabil indulás és állapotmegőrzés.
2. Hangmag
STT/TTS frissítés, VAD, barge-in, rövid hangos válasz
Konyhai zajteszt teljesítve.
3. Faliújság
Naptár sync, emlékeztetők, időzítők, push, briefing
Tablet alvását túlélő működés.
4. Memória és Google
Memória-admin, Calendar direct, Gmail, Keep-export
Jogosultságok és audit működik.
5. Recept és táplálkozás
3–6 forrás, rangsorolás, makrók, főzési munkamenet
Hallucinációmentes mintatesztek.
6. Realtime és finomítás
WebRTC voice, ébresztőszó, több eszköz, kioszk
4–8 hét családi próba.
7. Extra hang
ElevenLabs és választható hangklón
Minden korábbi fázis stabil.
8. Hordozhatósági próba
Raspberry Pi / ARM64 telepítés
Azonos funkciók külön hardveren.

A. Google-integrációk kutatási melléklete
A.1. Google Keep – tényleges lehetőségek
A Google hivatalos Keep API-ja rendelkezik notes.create végponttal, és szöveges vagy listajegyzetet – akár kipipálható listatételekkel – tud létrehozni. Ugyanakkor a Google hivatalos áttekintése a szolgáltatást vállalati adminisztrációs felhasználásra pozicionálja, és az engedélyezést Google Workspace domain-wide delegation köré építi.
Környezet
Javasolt megoldás
Korlát
Személyes Gmail
Web Share API → Keep alkalmazás; fallback vágólap
Felhasználói érintés kell; nincs garantált automatikus kétirányú sync.
Google Workspace, admin jóváhagyással
Közvetlen Keep API, list note létrehozás
Adminisztrátori/OAuth-konfiguráció és megfelelő scope kell.
Eladható általános termék
Keep-export alapból; direct API csak képességvizsgálat után
Nem ígérhető minden háztartásnak azonos direct API.

A.2. Google Calendar
A Calendar API közvetlenül létrehoz eseményt, és siker esetén Event erőforrást ad vissza. A napközbeni változásokhoz az inkrementális szinkron nextSyncToken értéket ad: egyszeri teljes szinkron után csak a változások kérhetők le. Ez a saját Raspberry Pi-s telepítéshez alkalmasabb, mint a publikus webhookot igénylő push-csatorna.
A.3. Gmail
A Gmail API közvetlen messages.send és drafts.send módot is támogat. A felhasználói bizalom miatt a Béla Home külön kezelje a piszkozatot és a küldést. Nyilvános alkalmazásnál a Gmail-scope-ok érzékeny vagy korlátozott kategóriába eshetnek; a legkisebb szükséges scope és a Google OAuth-verifikáció megtervezése kötelező.
A.4. OAuth gyakorlati következmény
A saját fejlesztési projekt „Testing” publikálási állapotában az external refresh token alapértelmezetten 7 nap után lejár, ha nem csak alap profil-scope-okat kérünk. Emiatt a Calendar/Gmail stabil saját használatához sem elég egy örökké tesztmódban hagyott OAuth-projekt. A termékesített verzióhoz production OAuth-konfiguráció, adatkezelési tájékoztató, támogatási oldal és szükség esetén Google-verifikáció kell.
A.5. YouTube
A YouTube Data API search.list végpontja valódi videó-, csatorna- és lejátszásilista-találatokat ad. Az eredmények megjelenítésénél a YouTube-forrást és brandinget egyértelműen jelezni kell. A lejátszás alapértelmezetten felhasználói indításra történjen; a rendszer ne próbálja meg elrejteni a YouTube eredetét vagy megkerülni a lejátszó szabályait.
A.6. OpenAI hang
Az OpenAI dokumentáció támogatja a gpt-4o-transcribe és gpt-4o-mini-transcribe modelleket, amelyekhez prompt adható a felismerés javításához. A gpt-4o-mini-tts utasítással szabályozható hangstílust és streaming hangkimenetet ad. Böngészős speech-to-speech alkalmazásnál az OpenAI WebRTC-t javasol a Realtime kapcsolathoz; a kliens rövid életű, szerver által kiadott tokennel csatlakozhat, így a normál API-kulcs nem kerül a tabletre. A Realtime VAD server_vad és semantic_vad módot is kínál.
B. Részletes példabeszélgetések
B.1. Reggel
Felhasználó
Béla Home
„Jó reggelt, mi van mára?”
„Jó reggelt. Budapesten 25 fok várható, délután lehet zápor. 9-kor fogorvos, 16:30-kor edzés. Este 7-kor emlékeztetlek a holnapi kirándulásra. Elindítsam a reggeli összefoglalót AC/DC háttérzenével?”
„Igen, de halkabban a zenét.”
„Rendben, 10%-os zenei hangerővel indítom.”

B.2. Alapanyag-alapú vacsora
Felhasználó
Béla Home
„Van csirkemell, répa, paprika, hagyma és krumpli. Négy főre legyen, maximum egy óra.”
„Négy forrásból hat megfelelő receptet találtam. Az első három mind az öt alapanyagot használja. A legmagasabb fehérjetartalmú egy tepsis csirkemell, becslésem szerint 510 kcal és 47 g fehérje adagonként.”
„Mutasd az első hármat.”
„Megjelenítettem őket forrással, hiányzó hozzávalókkal és tápértékkel.”
„Indítsuk a másodikat.”
„Rendben. A forrás receptje 4 adagos és 45 perces. Az első lépés: melegítsd elő a sütőt 190 fokra.”

B.3. Memória
Felhasználó
Béla Home
„A gyerekek ezt a szószt kevésbé csípősen szeretik.”
„Ezt jegyezzem meg tartósan a gyerekek preferenciájaként?”
„Igen.”
„Elmentettem. A memória-adminban bármikor szerkesztheted vagy törölheted.”

B.4. Naptár és email
Felhasználó
Béla Home
„Tedd be szombatra tízre a bevásárlást, egy órára.”
„Szombaton 10:00–11:00 között, a Családi naptárba. Megerősíted?”
„Igen, és küldd el Erikának a listát.”
„Az eseményt létrehoztam. A bevásárlólistát Erikának küldjem emailben, vagy nyissam meg Google Keep-exportként?”

C. Fogalomtár és források
Fogalom
Magyarázat
STT
Speech-to-text: beszéd átalakítása szöveggé.
TTS
Text-to-speech: szöveg felolvasása.
VAD
Voice Activity Detection: beszéd és csend érzékelése.
WebRTC
Alacsony késleltetésű valós idejű média- és adatkapcsolat.
SSE
Server-Sent Events: a szerver élő eseményeket küld a megnyitott böngészőnek.
Web Push
Rendszerértesítés akkor is, ha a webalkalmazás nincs előtérben.
OAuth 2.0
Engedélyezési protokoll, amellyel a felhasználó jelszó átadása nélkül kapcsolja Google-fiókját.
SQLite
Egyfájlos helyi adatbázis, külön adatbázis-szerver nélkül.
Scheduler
Háttérfolyamatok és időzített munkák végrehajtója.
PWA
Telepíthető webalkalmazás, amely bizonyos natív jellegű képességeket használ.

C.1. Kutatási források – 2026. július
[1] Google Keep API Overview: https://developers.google.com/workspace/keep/api/guides
[2] Google Keep – Create notes: https://developers.google.com/workspace/keep/api/guides/create-notes
[3] Google Keep – notes.create: https://developers.google.com/workspace/keep/api/reference/rest/v1/notes/create
[4] Google Calendar – Events insert: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
[5] Google Calendar – Incremental sync: https://developers.google.com/workspace/calendar/api/guides/sync
[6] Gmail – Create and send messages: https://developers.google.com/workspace/gmail/api/guides/sending
[7] Gmail – Drafts: https://developers.google.com/workspace/gmail/api/guides/drafts
[8] Google OAuth – Web server apps: https://developers.google.com/identity/protocols/oauth2/web-server
[9] Google OAuth – app states and token limits: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
[10] YouTube Data API – Search list: https://developers.google.com/youtube/v3/docs/search/list
[11] YouTube Developer Policies: https://developers.google.com/youtube/terms/developer-policies
[12] OpenAI – Realtime WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
[13] OpenAI – Realtime VAD: https://developers.openai.com/api/docs/guides/realtime-vad
[14] OpenAI – Speech to text: https://developers.openai.com/api/docs/guides/speech-to-text
[15] OpenAI – Text to speech: https://developers.openai.com/api/docs/guides/text-to-speech
[16] USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide
[17] MDN – Web Share API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API
C.2. Belső kiinduló dokumentumok
Béla Home – Developer Specification v1.0 (DEV-SPEC.md, 2026-07-23).
Béla Home – Felhasználói Specifikáció v1.1 (bela-home-spec.html, 2026-07-23).
A tulajdonossal folytatott követelményegyeztetés a hangról, memóriáról, receptekről, Google-integrációkról és hordozhatóságról.
Jóváhagyási összefoglaló
A dokumentum a Béla Home v2 célállapotának funkcionális alapja. A megvalósítás során ettől eltérni, funkciót hozzáadni vagy kötelező elemet törölni csak tulajdonosi döntéssel szabad.
Döntés
Státusz
Hang az elsődleges kezelési mód
Jóváhagyandó
Szerkeszthető családi memória
Jóváhagyandó
Google Calendar és Gmail direct integráció
Jóváhagyandó
Google Keep export; direct API csak megfelelő Workspace-ben
Kutatással alátámasztott döntés
3–6 valódi, többforrásos recept; AI-generált recept tilos
Jóváhagyandó
Kalória és makró hiteles adatforrásból
Jóváhagyandó
AC/DC briefing marad
Jóváhagyandó
ElevenLabs legutolsó fázis
Jóváhagyandó
V1 befagyasztás, v2 párhuzamos építés
Jóváhagyandó
Raspberry Pi-kompatibilis hordozható backend
Jóváhagyandó
