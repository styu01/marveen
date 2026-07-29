// Béla Home Kitchen Server -- port 3421
import express from 'express'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '20mb' }))
app.use(express.static(join(__dirname, 'public')))

const OPENAI_KEY = readFileSync('/home/kisss/marveen/store/.openai-key', 'utf8').trim()
const STORE = '/home/kisss/marveen/store'
const REMINDERS_PATH = join(STORE, 'kitchen-reminders.json')
const BRIEFING_PATH = join(STORE, 'kitchen-briefing.json')
const PROFILES_PATH = join(STORE, 'kitchen-profiles.json')
const RESEND_KEY_PATH = join(STORE, '.resend-key')

const DEFAULT_PROFILES = {
  Istvan:   { kedvenc_etelek: ['gulyás','rántott hús','pörkölt'], kedvenc_alapanyagok: ['fokhagyma','hagyma','paprika'], allergenek: [], dieta: '', megjegyzes: 'Szereti a fűszeres ételeket.' },
  Erika:    { kedvenc_etelek: [], kedvenc_alapanyagok: [], allergenek: [], dieta: 'laktózmentes', megjegyzes: '' },
  Adam:     { kedvenc_etelek: [], kedvenc_alapanyagok: [], allergenek: ['mogyoró'], dieta: '', megjegyzes: '' },
  Viktoria: { kedvenc_etelek: ['palacsinta'], kedvenc_alapanyagok: [], allergenek: [], dieta: '', megjegyzes: '' },
}

function loadProfiles() {
  try { return JSON.parse(readFileSync(PROFILES_PATH, 'utf8')) } catch { return { ...DEFAULT_PROFILES } }
}
function saveProfiles(p) { writeFileSync(PROFILES_PATH, JSON.stringify(p, null, 2)) }

if (!existsSync(PROFILES_PATH)) saveProfiles(DEFAULT_PROFILES)

function loadReminders() {
  try { return JSON.parse(readFileSync(REMINDERS_PATH, 'utf8')) } catch { return [] }
}
function saveReminders(list) { writeFileSync(REMINDERS_PATH, JSON.stringify(list, null, 2)) }

// --- STT: OpenAI Whisper ---
app.post('/api/stt', async (req, res) => {
  const { audio, mimeType = 'audio/webm' } = req.body
  if (!audio) return res.status(400).json({ error: 'no audio' })

  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  const formData = new FormData()
  const blob = new Blob([Buffer.from(audio, 'base64')], { type: mimeType })
  formData.append('file', blob, `audio.${ext}`)
  formData.append('model', 'whisper-1')
  formData.append('language', 'hu')

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: formData,
  })
  const data = await r.json()
  if (!r.ok) return res.status(500).json({ error: data.error?.message || 'whisper error' })
  res.json({ text: data.text })
})

// --- Köszöntés időpont szerint (Budapest TZ) ---
const GREETINGS_BY_PERIOD = {
  reggel: [
    'Szép jó reggelt a Kiss családnak!',
    'Jó reggelt Istvánnak, Erikának, Ádámnak és Viktóriának!',
    'Kelj fel Kiss család, a kávé nem issza meg magát.',
    'Jó reggelt! Ne ess pánikba -- még csak reggel van.',
    'Szép reggelt! Ádám és Viktória, iskolára fel. Istvan, kávéra fel. Erika, mindenki másra fel.',
    'A Föld ismét megfordult a tengelye körül -- jó reggelt Kiss família!',
    '42. Ez a válasz arra is, hogy miért érdemes felkelni. Jó reggelt!',
    'Jó reggelt! A naprendszer rendben, Budapest él, és a Kiss ház remélhetőleg szintén.',
    'Ne ess pánikba. Reggel van, de ez múlandó. Jó reggelt Kiss família!',
    'Jó reggelt! Köszönöm a halakat -- és most jöjjön az összefoglaló.',
    'Szép jó reggelt! Béla bejelentkezett. Kávé ajánlott az összefoglaló előtt.',
    'Üdvözlöm a Kiss famíliát a nap legoptimistább pillanatában. Lefelé csak romolhat.',
    'Jó reggelt! Istvan, Erika, Ádám, Viktória -- mindenki talpon? Akkor mehetünk.',
    'Reggel van. Ez az a nap része amikor még minden lehetséges. Jó reggelt Kiss família!',
    'Jó reggelt! A kávé már gőzölög, csak fel kell kelni. Na, szép lassan.',
    'Sziasztok! Reggel van, és Béla már órák óta ébren van -- ami nem nagy teljesítmény, de mégis.',
    'Jó reggelt Kisséknék! A nap nem fog magától elkezdődni -- vagy dehogynem, de azért keljetek fel.',
    'Fel a fejjel Kiss família! Jó reggelt -- a nap szép lesz, vagy legalábbis eltelik.',
    'Jó reggelt! Ne nyomjátok a szundikálást -- Béla összefoglalóval vár.',
    'Szép jó reggelt! Az univerzum tegnap is rendben volt, és ma is rendben lesz. Jó reggelt!',
  ],
  delelott: [
    'Jó délelőttöt a Kiss famíliának!',
    'Szép délelőttöt Istvánnak, Erikának, Ádámnak és Viktóriának!',
    'Délelőtt van, Kiss família -- a nap még csak most melegszik be.',
    'Sziasztok! Délelőtt van és Béla összefoglalóval érkezik.',
    'Jó délelőttöt! Remélhetőleg a reggeli sikerült. Most jön a napi helyzetjelentés.',
    'Szép délelőttöt! A kávé már elfogyott remélhetőleg, az összefoglaló most jön.',
    'Jó délelőttöt Kiss família! A nap java még előttetek áll.',
    'Délelőtti üdvözlet Kisséknék -- Istvan, Erika, Ádám, Viktória, jó napot!',
    'Jó délelőttöt! Béla itt van az összefoglalóval. Még nem ebéd, de már nem reggel.',
    'Szép délelőttöt Kiss Istvánéknak! A nap felpörgött, de még bőven van belőle.',
    'Sziasztok Kiss família! Délelőtt van -- a nap legjobb és legproduktívabb szakasza.',
    'Jó délelőttöt! Remélem jól indult a reggel. Lássuk mi vár rátok.',
    'Délelőtt van, Kiss família. Jó napot kívánok mindenkinek!',
    'Szép délelőttöt! Béla bejelentkezett a nap közepén.',
    'Jó délelőttöt Kisséknék! Az összefoglaló rövid lesz, a nap hosszú.',
  ],
  del: [
    'Jó napot a Kiss famíliának -- pontosan ebéd időben.',
    'Sziasztok! Dél van, ami általában a nap legjobb része -- hacsak nem az ebéd.',
    'Jó napot Istvánnak, Erikának, Ádámnak és Viktóriának! Ebéd előtt összefoglaló.',
    'Délben köszöntelek titeket -- jó napot Kiss família!',
    'Dél van. Az összefoglaló rövid lesz, az ebéd annál fontosabb.',
    'Jó napot Kiss família! Béla ebéd előtt bejelentkezett.',
    'Szép napot mindenkinek! Dél van -- ideje ebédelni és összefoglalót hallgatni.',
    'Jó napot Kisséknék! A nap fele mögöttetek, a másik fele előttetek.',
    'Dél van, Kiss família -- jó étvágyat és jó napot!',
    'Sziasztok! Pontosan dél van. Béla itt a frissítéssel.',
    'Jó napot! Dél van, a nap csúcsán. Összefoglaló következik.',
    'Szép jó napot a Kiss famíliának! Az ebéd megvárja a híreket.',
    'Jó napot Istvánnak és családjának! Délben bejelentkezett Béla.',
    'Dél van, és Béla sem pihent -- jó napot Kiss família!',
    'Jó napot! A nap fele kész, most lássuk mi maradt.',
  ],
  delutan: [
    'Jó napot a Kiss famíliának!',
    'Szép napot Istvánnak, Erikának, Ádámnak és Viktóriának!',
    'Jó napot! Délután van, a nap legalább fele már mögöttünk.',
    'Jó napot Kiss família -- mi újság a nap első felében?',
    'Sziasztok! Délután van, Béla itt a frissítéssel.',
    'Szép délutánt Kiss Istvánéknak! A nap hátralévő részére összefoglalóval.',
    'Jó napot! Remélem produktív volt a délelőtt. A délután is az lesz.',
    'Jó délutánt Kiss família! Még van bőven a napból.',
    'Sziasztok Kisséknék! Délutáni összefoglaló következik.',
    'Szép napot! Béla délután is talpon van -- jó napot Kiss família!',
    'Jó napot Istvánnak és csapatának! Délután van, de még nem este.',
    'Jó délutánt! Ádám és Viktória már valószínűleg hazaért. Jó napot mindenkinek!',
    'Szép délutánt Kiss família! Az összefoglaló rövid, a délután hosszú.',
    'Jó napot! Béla itt a délutáni helyzetjelentéssel.',
    'Sziasztok! Délután van, és Béla még mindig ébren van -- jó napot Kiss família!',
  ],
  este: [
    'Jó estét a Kiss famíliának!',
    'Szép estét Istvánnak, Erikának, Ádámnak és Viktóriának!',
    'Jó estét! A nap véget ért, de Béla még talpon van.',
    'Este van, Kiss família -- jó estét kívánok.',
    'Jó estét! Remélem jól telt a nap. Lássuk mi van.',
    'Szép estét Kiss Istvánéknak! A nap végéhez közeledve összefoglalóval.',
    'Jó estét! Béla est felé gondol -- mármint este van, nem gondol rá.',
    'Sziasztok Kiss família! Este van, ideje pihenni és összefoglalót hallgatni.',
    'Jó estét! Ádám és Viktória remélem ágyban van nemsokára. Jó estét mindenkinek!',
    'Szép estét! A nap hősei hazaértek, Béla bejelentkezett.',
    'Jó estét Kisséknék! Az este a pihenés ideje -- de előtte összefoglaló.',
    'Sziasztok! Este van, Béla nem alszik. Jó estét Kiss família!',
    'Jó estét! A nap munkája elvégezve, most lássuk mi maradt holnapra.',
    'Szép jó estét Kiss família! Béla az esti összefoglalóval érkezik.',
    'Jó estét Istvánnak és az egész Kiss famíliának! Kellemes estét kívánok.',
  ],
  ejjel: [
    'Jó éjszakát a Kiss famíliának -- bár ha ezt hallod, bizonyára nem alszol.',
    'Éjjel van Kiss família. Béla soha nem alszik, de titeket kér erre.',
    'Jó éjt! Az összefoglaló rövid lesz -- ilyen korán reggel nincs sok hír.',
    'Sziasztok, Kiss família -- éjszakai összefoglaló következik.',
    'Éjjel van. Béla ébren van, de Kiss Istvan remélem nem.',
    'Jó éjszakát! Ha ezt hallod, vagy nagyon korán keltél, vagy nagyon késő van.',
    'Sötét van odakint, Kiss família. Jó éjszakát -- vagy jó kora reggelt.',
    'Éjjeli összefoglaló következik. Béla ébren van, mindenki más aludjék.',
    'Jó éjt Kiss família! A csillagok rendben vannak, a ház is remélhetőleg.',
    'Sziasztok! Éjjel van, de Béla azért bejelentkezett. Jó éjszakát!',
    'Éjfél körül jó estét -- vagy jó reggelt -- kívánok. Attól függ merre mész.',
    'Kiss família, éjjel van. Béla összefoglalója gyors lesz.',
    'Jó éjszakát Istvánéknak! Ha ébren vagytok, hamarosan nem lesztek.',
    'Éjjeli bejelentkezés -- jó éjszakát Kiss família!',
    'Sziasztok! Az éjszaka közepén is csak Béla vagyok. Jó éjt!',
  ],
}

function getBudapestHour() {
  return new Date().toLocaleString('en-US', { timeZone: 'Europe/Budapest', hour: 'numeric', hour12: false })
}

function getPeriod(hour) {
  const h = Number(hour)
  if (h >= 5 && h < 10) return 'reggel'
  if (h >= 10 && h < 12) return 'delelott'
  if (h >= 12 && h < 14) return 'del'
  if (h >= 14 && h < 18) return 'delutan'
  if (h >= 18 && h < 22) return 'este'
  return 'ejjel'
}

app.get('/api/greeting', (req, res) => {
  const hour = getBudapestHour()
  const period = getPeriod(hour)
  const list = GREETINGS_BY_PERIOD[period]
  const greeting = list[Math.floor(Math.random() * list.length)]
  res.json({ greeting, period, hour: Number(hour) })
})

// --- Naptár felvételi kérések (BÉLA dolgozza fel heartbeat-nél) ---
const CAL_REQUESTS_PATH = join(STORE, 'kitchen-calendar-requests.json')
function loadCalRequests() {
  try { return JSON.parse(readFileSync(CAL_REQUESTS_PATH, 'utf8')) } catch { return [] }
}

app.post('/api/calendar-request', (req, res) => {
  const { summary, date, time, duration, notes } = req.body
  if (!summary) return res.status(400).json({ error: 'no summary' })
  const list = loadCalRequests()
  const item = { id: Date.now(), summary, date, time, duration, notes, pending: true, createdAt: Date.now() }
  list.push(item)
  writeFileSync(CAL_REQUESTS_PATH, JSON.stringify(list, null, 2))
  res.json(item)
})

// --- Emlékeztetők ---
app.get('/api/reminders', (req, res) => {
  const now = Date.now()
  const all = loadReminders()
  let changed = false
  all.forEach(r => { if (!r.done && r.dueMs && r.dueMs <= now && !r.due) { r.due = true; changed = true } })
  if (changed) saveReminders(all)
  res.json(all.filter(r => !r.done))
})

app.post('/api/reminders', (req, res) => {
  const { text, dueMs } = req.body
  if (!text) return res.status(400).json({ error: 'no text' })
  const list = loadReminders()
  const item = { id: Date.now(), text, dueMs: dueMs || null, done: false, due: false, createdAt: Date.now() }
  list.push(item)
  saveReminders(list)
  res.json(item)
})

app.patch('/api/reminders/:id', (req, res) => {
  const id = Number(req.params.id)
  const list = loadReminders()
  const item = list.find(r => r.id === id)
  if (!item) return res.status(404).json({ error: 'not found' })
  Object.assign(item, req.body)
  saveReminders(list)
  res.json(item)
})

app.delete('/api/reminders/:id', (req, res) => {
  const id = Number(req.params.id)
  const list = loadReminders().filter(r => r.id !== id)
  saveReminders(list)
  res.json({ ok: true })
})

// --- Reggeli briefing (BÉLA írja, kitchen olvassa) ---
app.get('/api/briefing', (req, res) => {
  try {
    const b = JSON.parse(readFileSync(BRIEFING_PATH, 'utf8'))
    res.json(b)
  } catch {
    res.json({ text: null, generatedAt: null })
  }
})

// BÉLA hívja ezt reggel (belső, csak localhost-ról)
app.post('/api/briefing', (req, res) => {
  if (!req.socket.remoteAddress?.includes('127.0.0.1') &&
      !req.socket.remoteAddress?.includes('::1') &&
      !req.socket.remoteAddress?.includes('::ffff:127.')) {
    return res.status(403).json({ error: 'csak localhost' })
  }
  const { text, events, weather } = req.body
  writeFileSync(BRIEFING_PATH, JSON.stringify({ text, events, weather, generatedAt: Date.now() }, null, 2))
  res.json({ ok: true })
})

// --- Profilok ---
app.get('/api/profiles', (req, res) => res.json(loadProfiles()))

app.get('/api/profile/:person', (req, res) => {
  const profiles = loadProfiles()
  const p = profiles[req.params.person]
  if (!p) return res.status(404).json({ error: 'not found' })
  res.json(p)
})

app.post('/api/profile/:person', (req, res) => {
  const profiles = loadProfiles()
  profiles[req.params.person] = { ...(profiles[req.params.person] || {}), ...req.body }
  saveProfiles(profiles)
  res.json(profiles[req.params.person])
})

// --- Chat: OpenAI gpt-4o-mini ---
function getBudapestDate() {
  return new Date().toLocaleDateString('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })
}

async function fetchWeatherContext() {
  try {
    const r = await fetch('http://localhost:3421/api/weather?city=Budapest')
    const d = await r.json()
    if (!d.temp) return ''
    const fc = (d.forecast || []).map(f => `${f.day}: ${f.max}°/${f.min}°, ${f.desc}`).join('; ')
    return `\nJelenlegi időjárás Budapesten: ${d.temp}°C, érzet ${d.feels}°C, ${d.desc}, páratartalom ${d.humidity}%. Előrejelzés: ${fc}.`
  } catch { return '' }
}

const HU_EN_FOOD = {
  'csirke':'chicken','tyúk':'chicken','csirkemell':'chicken breast',
  'marha':'beef','marhahús':'beef','gulyás':'goulash',
  'sertés':'pork','disznó':'pork','karaj':'pork chop',
  'hal':'fish','lazac':'salmon','ponty':'carp','tonhal':'tuna',
  'bárány':'lamb','borjú':'veal',
  'tojás':'eggs','tojásos':'eggs','rántotta':'scrambled eggs',
  'tészta':'pasta','spagetti':'spaghetti','makaróni':'macaroni',
  'rizs':'rice','rizottó':'risotto',
  'leves':'soup','húsleves':'chicken soup',
  'palacsinta':'crepes','rétes':'strudel',
  'pizza':'pizza','burger':'burger',
  'gomba':'mushroom','paprika':'pepper','paradicsom':'tomato',
}

function translateRecipeQuery(query) {
  const lower = query.toLowerCase()
  for (const [hu, en] of Object.entries(HU_EN_FOOD)) {
    if (lower.includes(hu)) return en
  }
  return null
}

async function fetchRecipeContext(query) {
  try {
    const enTerm = translateRecipeQuery(query)
    if (!enTerm) return { context: '', youtubeUrl: null, sourceUrl: null }
    const r = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(enTerm)}`)
    const d = await r.json()
    const meal = d.meals?.[0]
    if (!meal) return { context: '', youtubeUrl: null, sourceUrl: null }
    const ingredients = []
    for (let i = 1; i <= 20; i++) {
      const ing = meal[`strIngredient${i}`]
      const meas = meal[`strMeasure${i}`]
      if (ing && ing.trim()) ingredients.push(`${meas?.trim() || ''} ${ing}`.trim())
    }
    const sourceUrl = `https://www.themealdb.com/meal/${meal.idMeal}`
    const youtubeUrl = meal.strYoutube || null
    return {
      context: `\nValódi recept a TheMealDB-ből: "${meal.strMeal}" -- Forrás: ${sourceUrl}${youtubeUrl ? ` -- YouTube: ${youtubeUrl}` : ''} -- Hozzávalók: ${ingredients.slice(0, 10).join(', ')}.`,
      youtubeUrl,
      sourceUrl,
    }
  } catch { return { context: '', youtubeUrl: null, sourceUrl: null } }
}

function buildProfileCtx(person) {
  const profiles = loadProfiles()
  const p = profiles[person]
  if (!p) return ''
  const parts = []
  if (p.dieta) parts.push(`diéta: ${p.dieta}`)
  if (p.allergenek?.length) parts.push(`allergiás: ${p.allergenek.join(', ')}`)
  if (p.kedvenc_etelek?.length) parts.push(`kedvenc ételek: ${p.kedvenc_etelek.join(', ')}`)
  if (p.kedvenc_alapanyagok?.length) parts.push(`kedvenc alapanyagok: ${p.kedvenc_alapanyagok.join(', ')}`)
  if (p.megjegyzes) parts.push(p.megjegyzes)
  return parts.length ? `\n${person} profilja: ${parts.join('; ')}.` : ''
}

function buildSystemPrompt(weatherCtx = '', recipeCtx = '', personCtx = '') {
  const today = getBudapestDate()
  return `Te BÉLA vagy, Istvan otthoni AI asszisztense, konyhai módban.
Ma ${today}.${weatherCtx}${recipeCtx}${personCtx}
Mindig JSON-t adj vissza ebben a formátumban:
{"short":"Rövid, max 2 mondatos verzió hangos felolvasáshoz.","long":"Részletes, markdown-formázott válasz olvasáshoz. Lehet hosszabb.","extra":null}

Az extra mező lehet null, vagy az alábbi típusok egyike:
- Recept kérésre: {"type":"recipe","name":"...","ingredients":["..."],"steps":["..."],"sourceUrl":null,"youtubeUrl":null}
- Időzítőre: {"type":"timer","seconds":600,"label":"10 perces időzítő"}
- Bevásárlólista hozzáadásra: {"type":"shopping","action":"add","item":"..."}
- Emlékeztető beállításra (pl. "emlékeztess holnap hogy felhívjam Erikát"): {"type":"reminder","text":"Hívd fel Erikát","dueMs":null} -- a dueMs-t töltsd ki Unix ms-ban ha konkrét időpont elhangzott
- Naptárba felvételre (pl. "vedd fel a naptárba csütörtökre 10-re a fogorvost"): {"type":"calendar_add","summary":"Fogorvos","date":"2026-07-24","time":"10:00","duration":60,"notes":""} -- a date mezőt töltsd ki ISO formátumban a valós mai nap alapján számolva, time HH:MM formátumban, duration percben

Szabályok:
- A short mindig hangos felolvasásra optimalizált, maximum 2 mondat, természetes magyar
- A long tartalmaz minden részletet, legyen informatív és jól olvasható
- Ha időzítőt kérnek: a short mondja meg hogy beállítottad, az extra tartalmazza az időzítőt
- Ha valaki zenét vagy YouTube videót kér (nem receptet), NE használj recipe extra típust -- extra:null, a long mezőben adj szöveges javaslatot ÉS egy YouTube keresési linket: [Dal neve](https://www.youtube.com/results?search_query=ELOADO+DAL+CIM) formátumban. Soha ne generálj watch?v= vagy youtu.be/ formátumú video URL-t.
- Mindig valid JSON-t adj, semmi más szöveget a JSON előtt vagy után`
}

const RECIPE_KEYWORDS = ['recept','főzz','főzzek','főzzünk','csináljak','vacsor','ebéd','süt','sül','étel','fogás','hozzávaló']

app.post('/api/chat', async (req, res) => {
  const { message, history = [], person = 'Istvan' } = req.body
  if (!message) return res.status(400).json({ error: 'no message' })

  const msgLower = message.toLowerCase()
  const isWeatherQ = msgLower.includes('időjárás') || msgLower.includes('idő') || msgLower.includes('fok') || msgLower.includes('eső') || msgLower.includes('meleg') || msgLower.includes('hideg')
  const isRecipeQ = RECIPE_KEYWORDS.some(k => msgLower.includes(k))

  const [weatherCtx, recipeResult] = await Promise.all([
    isWeatherQ ? fetchWeatherContext() : Promise.resolve(''),
    isRecipeQ ? fetchRecipeContext(message) : Promise.resolve({ context: '', youtubeUrl: null, sourceUrl: null }),
  ])

  const recipeCtx = recipeResult.context || recipeResult  // backward compat if string
  const verifiedYoutubeUrl = recipeResult.youtubeUrl ?? null
  const verifiedSourceUrl = recipeResult.sourceUrl ?? null

  const personCtx = buildProfileCtx(person)

  const messages = [
    ...history.slice(-6),
    { role: 'user', content: message }
  ]

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: buildSystemPrompt(weatherCtx, recipeCtx, personCtx) }, ...messages],
      max_tokens: 1024,
    }),
  })
  const data = await r.json()
  if (!r.ok) return res.status(500).json({ error: data.error?.message || 'openai error' })
  let text = data.choices?.[0]?.message?.content || ''

  // Override any model-generated URLs with verified TheMealDB values
  if (isRecipeQ) {
    try {
      const parsed = JSON.parse(text)
      if (parsed.extra?.type === 'recipe') {
        parsed.extra.youtubeUrl = verifiedYoutubeUrl
        parsed.extra.sourceUrl = verifiedSourceUrl
      }
      text = JSON.stringify(parsed)
    } catch {}
  }

  res.json({ text })
})

// --- Beállítások (hang/email/város a kliensen, Resend kulcs csak itt) ---
app.get('/api/settings/resend-status', (req, res) => {
  res.json({ hasKey: existsSync(RESEND_KEY_PATH) })
})

app.post('/api/settings', (req, res) => {
  const { resendKey } = req.body
  if (resendKey) {
    try {
      writeFileSync(RESEND_KEY_PATH, String(resendKey).trim())
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  res.json({ ok: true })
})

// --- Bevásárlólista email (Resend API-n keresztül) ---
app.post('/api/shopping-email', async (req, res) => {
  const { items = [], to = 'antal.er@gmail.com' } = req.body
  if (!items.length) return res.status(400).json({ error: 'empty list' })

  const subject = `Bevásárlólista (${new Date().toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' })})`
  const body = items.map(i => `• ${i}`).join('\n')

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readFileSync(RESEND_KEY_PATH, 'utf8').trim()}`,
      },
      body: JSON.stringify({
        from: 'BÉLA <bela@resend.dev>',
        to: [to],
        subject,
        text: `Bevásárlólista:\n\n${body}\n\n-- BÉLA, Istvan konyhai asszisztense`,
      }),
    })
    const d = await r.json()
    if (!r.ok) return res.status(500).json({ error: d.message || 'resend error' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// --- Weather: wttr.in (3 napos) ---
const DAY_NAMES = ['vas','hét','ked','sze','csü','pén','szo']
app.get('/api/weather', async (req, res) => {
  const city = req.query.city || 'Budapest'
  try {
    const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
    const data = await r.json()
    const cur = data.current_condition?.[0]
    const forecast = (data.weather || []).slice(0, 3).map((w, i) => {
      const d = new Date(); d.setDate(d.getDate() + i)
      return {
        day: i === 0 ? 'Ma' : i === 1 ? 'Holnap' : DAY_NAMES[d.getDay()],
        max: w.maxtempC,
        min: w.mintempC,
        desc: w.hourly?.[4]?.weatherDesc?.[0]?.value || '',
      }
    })
    res.json({
      temp: cur?.temp_C,
      feels: cur?.FeelsLikeC,
      desc: cur?.weatherDesc?.[0]?.value,
      humidity: cur?.humidity,
      maxTemp: data.weather?.[0]?.maxtempC,
      minTemp: data.weather?.[0]?.mintempC,
      forecast,
    })
  } catch {
    res.status(500).json({ error: 'weather unavailable' })
  }
})

// --- TTS: OpenAI TTS ---
app.post('/api/tts', async (req, res) => {
  const { text, voice = 'onyx' } = req.body
  if (!text) return res.status(400).json({ error: 'no text' })

  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: 'tts-1', input: text.slice(0, 4096), voice }),
  })
  if (!r.ok) return res.status(500).json({ error: 'tts error' })
  const buf = await r.arrayBuffer()
  res.set('Content-Type', 'audio/mpeg')
  res.send(Buffer.from(buf))
})

const PORT = 3421
createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`Béla Home kitchen szerver: http://0.0.0.0:${PORT}`)
})
