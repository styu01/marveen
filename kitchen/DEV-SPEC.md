# Béla Home — Developer Specification

Version: 1.0
Date: 2026-07-23
Scope: `/home/kisss/marveen/kitchen/` — the standalone kitchen-assistant subsystem of the Marveen/BÉLA fleet.
Companion document: `public/bela-home-spec.html` (user-facing spec, Hungarian, product-level).
This document is the technical counterpart: exact behavior, exact schemas, exact gaps. English per project convention (technical docs are written in English; the surrounding BÉLA agent communicates with Istvan in Hungarian).

---

## 1. System overview

Béla Home is a single Node.js process (`server.js`) serving a single-page static frontend (`public/index.html`) over plain HTTP on the local network. It is **not** part of the main BÉLA Claude Code agent process — it is a separate, always-on Express server that a tablet browser connects to. The only coupling to the main BÉLA agent is through **shared files** on disk (`store/kitchen-*.json`) that BÉLA reads/writes during its own heartbeat cycles, and through shared secrets (`store/.openai-key`).

There is no build step, no bundler, no framework. `index.html` is a single ~1700-line file: inline `<style>`, inline `<script>`, vanilla DOM APIs. `server.js` is a single ~550-line file using Express 5.

```
Tablet browser (Chrome/Android, LAN)
        │  HTTP, port 3421
        ▼
Windows host: netsh portproxy 0.0.0.0:3421 → WSL2 IP:3421
        ▼
WSL2: node server.js  (binds 0.0.0.0:3421)
        │
        ├── serves public/ statically (index.html, this doc's sibling)
        ├── /api/* JSON endpoints
        ├── reads/writes store/kitchen-*.json
        └── calls out to: OpenAI API, wttr.in, TheMealDB, Resend API
```

---

## 2. Runtime environment

| Item | Value |
|---|---|
| Node.js | v24.16.0 (confirmed via `node --version` on host) |
| Module system | ESM (`"type": "module"` in `kitchen/package.json`) |
| HTTP framework | Express **5.2.1** (resolved from the repo-root `node_modules/`, not a local `kitchen/node_modules/` — there is no lockfile or `node_modules` inside `kitchen/`; Node's ESM resolver walks up parent directories, so `import express from 'express'` in `kitchen/server.js` resolves to `/home/kisss/marveen/node_modules/express`) |
| Port | `3421`, hardcoded in `server.js` (`const PORT = 3421`), bound to `0.0.0.0` |
| Process manager | None (no pm2/systemd). Plain `node server.js &` backgrounded by `bela-start.sh` |
| Autostart | `scripts/bela-start.sh`, step 11 ("Kitchen szerver indítás"). Checks `store/kitchen.pid` for a live PID via `kill -0`; if not running, spawns `node kitchen/server.js`, redirects stdout/stderr to `store/kitchen.log`, writes the new PID to `store/kitchen.pid` |
| Windows-side networking | `kitchen/windows-setup.ps1` (run once, as admin, on the Windows host): reads the WSL2 IP via `wsl hostname -I`, adds a `netsh interface portproxy` rule forwarding Windows `0.0.0.0:3421` → WSL2 IP `3421`, adds a matching firewall rule. Must be re-run after WSL2 restarts (WSL2 IP is not stable across reboots) |
| Tablet access | `http://<windows-lan-ip>:3421` from any device on the home LAN |
| Secrets on disk | `store/.openai-key` (mode `600`, plain text API key, one line); `store/.resend-key` (same pattern — **does not currently exist on disk**, see §12) |

---

## 3. Repository layout

```
kitchen/
├── package.json          -- {"name":"bela-home-kitchen","type":"module","version":"1.0.0"}, no deps field (uses root node_modules)
├── server.js             -- Express app, all backend logic, ~546 lines
├── windows-setup.ps1      -- one-time Windows port-forward + firewall script
└── public/
    ├── index.html         -- entire frontend: HTML + CSS + JS, ~1706 lines
    └── bela-home-spec.html -- user-facing product spec (this file's companion)

store/                      -- shared with the main BÉLA agent, NOT inside kitchen/
├── .openai-key             -- OpenAI API key, mode 600
├── .resend-key              -- Resend API key, written by POST /api/settings (currently absent)
├── kitchen-profiles.json    -- per-person profile data
├── kitchen-reminders.json   -- reminder CRUD store
├── kitchen-briefing.json    -- written externally by BÉLA, read by the kitchen server
├── kitchen-calendar-requests.json -- written by the kitchen server, read/processed externally by BÉLA
└── kitchen.pid, kitchen.log -- process bookkeeping written by bela-start.sh
```

There is no `store/kitchen-shopping.json` — the shopping list is **not** persisted server-side (see §9.7, §13).
There is no `store/kitchen-memory.json` — "learned facts" memory is not implemented (see §14.5).

---

## 4. External APIs — exact usage

### 4.1 OpenAI (three separate endpoints, one shared key from `store/.openai-key`)

| Feature | Endpoint | Model | Request shape | Notes |
|---|---|---|---|---|
| Speech-to-text | `POST https://api.openai.com/v1/audio/transcriptions` | `whisper-1` | `multipart/form-data`: `file` (audio blob), `model`, `language=hu` | Server receives base64 audio + `mimeType` from the client, decodes to a `Buffer`, wraps in a `Blob`, builds a native `FormData`. File extension inferred from MIME (`m4a`/`ogg`/`webm`). No file size cap beyond Express's `json({ limit: '20mb' })` body parser limit (audio arrives base64-encoded inside JSON, so the *encoded* payload must fit under ~20MB → roughly 14–15MB of raw audio) |
| Chat completion | `POST https://api.openai.com/v1/chat/completions` | `gpt-4o` (note: **not** `gpt-4o-mini` despite what both memory notes and the product spec say — `server.js:421` literally sends `model: 'gpt-4o'`) | `messages: [{role:'system', content: <built prompt>}, ...last 6 history entries, {role:'user', content: message}]`, `max_tokens: 1024` | The system prompt is rebuilt on every call (see §8.6) and is **not cached/reused** — no prompt caching is configured. Response is expected to be a raw JSON string (the model is instructed to emit `{"short":...,"long":...,"extra":...}` with no surrounding prose) and is **not validated server-side** — the server passes `data.choices[0].message.content` straight through as a string; if the model's output isn't valid JSON, `JSON.parse` in the frontend's `appendMsg()` catches the exception and falls back to treating the raw string as both `short` and `long` |
| Text-to-speech | `POST https://api.openai.com/v1/audio/speech` | `tts-1` | `{model, input: text.slice(0,4096), voice}` | `voice` defaults to `'onyx'`, comes from the client's `bela-voice` localStorage key (client sends whatever it has; server has no whitelist/validation of the voice name — an invalid voice name would surface as an OpenAI 400, unhandled beyond `res.status(500)`) |

**Cost model** (informational, not enforced anywhere in code): Whisper ~$0.006/min, gpt-4o is charged per input+output token (not the cheap gpt-4o-mini rate the older docs assumed), TTS ~$15/1M characters (tts-1 pricing). There is no token/cost tracking or budget cap in the code.

### 4.2 TheMealDB (recipe lookup, free, no key)

`GET https://www.themealdb.com/api/json/v1/1/search.php?s=<english term>`

Only triggered when the incoming chat message contains one of `RECIPE_KEYWORDS` (`recept, főzz, főzzek, főzzünk, csináljak, vacsor, ebéd, süt, sül, étel, fogás, hozzávaló` — substring match, case-insensitive) **and** `translateRecipeQuery()` finds a match in `HU_EN_FOOD`, a hardcoded ~35-entry Hungarian→English dictionary (`server.js:306-319`, e.g. `csirke→chicken`, `gulyás→goulash`). If the dictionary has no match for anything in the message, TheMealDB is never called and the model answers from its own knowledge with no verified source — this is the exact mechanism behind the "recipe link hallucination" risk documented in the product spec.

If TheMealDB does return a match, the server extracts up to 20 ingredient/measure pairs, builds a context string injected into the system prompt, and — critically — **overwrites** whatever `sourceUrl`/`youtubeUrl` the model put in its JSON `extra.recipe` object with the verified TheMealDB values (`server.js:430-440`, done after the OpenAI call returns, via a second `JSON.parse`/`JSON.stringify` pass on the response text). This means the model cannot hallucinate a fake link for a *known* dish — but for unknown dishes there is no fallback URL at all, and the model is free to hallucinate.

### 4.3 wttr.in (weather, free, no key)

`GET https://wttr.in/<city>?format=j1` — city is `Budapest` by default, or whatever came in the `city` query param. Used both by the standalone `/api/weather` endpoint (frontend widget) and internally by `fetchWeatherContext()` for chat weather questions (which always hardcodes `city=Budapest`, ignoring any per-user city setting — see §12). No caching; every call hits wttr.in live. No documented SLA; the product spec's noted risk ("wttr.in unreliable, no fallback") is accurate — a failed fetch is caught and returns `res.status(500).json({error:'weather unavailable'})`, and the frontend widget silently does nothing on a fetch error (empty `catch {}`).

### 4.4 Resend (transactional email, requires key)

`POST https://api.resend.com/emails`, `Authorization: Bearer <key from store/.resend-key>`, body `{from: 'BÉLA <bela@resend.dev>', to: [<address>], subject, text}`. **The key file does not currently exist on disk** — this feature is wired end-to-end in code but will fail with a file-read exception (uncaught `ENOENT` inside the route handler → unhandled promise rejection → Express 5's default error handling returns a 500) until Istvan actually pastes a real Resend key into the Settings panel.

---

## 5. Server — complete route reference (`server.js`)

All routes are on the single Express app; there is **no authentication, no CORS restriction, no rate limiting** on any of them. Anything on the LAN that can reach port 3421 can call every endpoint below, including the ones that mutate shared state or send email. The only access-control primitive in the whole file is the manual remote-address check on `POST /api/briefing` (see 5.6).

### 5.1 `POST /api/stt`
Body: `{audio: <base64 string>, mimeType?: string}`. Calls OpenAI Whisper (§4.1). Returns `{text}` or `{error}` (500) on OpenAI failure. No timeout on the outbound `fetch` — a slow Whisper response blocks this request indefinitely (the *client* imposes no timeout on this call either; only the subsequent `/api/chat` call has a 20s `AbortController` — see §10.7).

### 5.2 `GET /api/greeting`
No params. Picks the current hour in `Europe/Budapest` via `Date.toLocaleString('en-US', {timeZone:'Europe/Budapest', hour:'numeric', hour12:false})`, maps it to one of six period buckets (`reggel 5-10, delelott 10-12, del 12-14, delutan 14-18, este 18-22, ejjel` else), and returns a uniformly-random line from a hardcoded array of 12–20 hand-written Hungarian greetings per bucket (`GREETINGS_BY_PERIOD`, ~110 lines total, `server.js:64-172`). Returns `{greeting, period, hour}`. Purely cosmetic, used only by `playBriefingWithMusic()` on the frontend to prepend a greeting before the briefing text.

### 5.3 `POST /api/calendar-request`
Body: `{summary, date?, time?, duration?, notes?}`. `summary` required (400 if missing). Appends `{id: Date.now(), ...body, pending: true, createdAt: Date.now()}` to `store/kitchen-calendar-requests.json` (read-modify-write of the whole array, no locking). **This endpoint does not talk to Google Calendar.** It only queues a request. Nothing in this codebase drains the queue — that happens externally, by the main BÉLA agent, during its heartbeat cycle, using its own Google Calendar MCP tools. There is no scheduled task or script anywhere in `~/.claude/scheduled-tasks/` dedicated to this queue (confirmed by search) — the drain is informal/prompt-driven, which is the root cause of the "max 30 min, sometimes longer, no guarantee" behavior noted in the product spec.

### 5.4 `GET /api/reminders`
No params. Loads `store/kitchen-reminders.json`, and as a side effect flips `due: true` on any reminder where `dueMs <= now && !done && !due` (and persists that mutation back to disk before responding — a GET with a write side effect). Returns only `!done` reminders. Polled by the frontend every 60s (`setInterval(loadReminders, 60000)`).

### 5.5 `POST /api/reminders`, `PATCH /api/reminders/:id`, `DELETE /api/reminders/:id`
Standard CRUD over the same JSON array. `POST` body `{text, dueMs?}` (text required). No recurrence field exists in the schema — "remind me every Monday" is not representable; every reminder is one-shot. IDs are `Date.now()` (millisecond timestamp) — colliding IDs are theoretically possible if two reminders are created in the same millisecond, though in practice unlikely given human-speed interaction. Note the live data in `store/kitchen-reminders.json` right now contains 6 duplicate entries of "Hívd fel Erikát hogy vegye be a kollagént" all with `done:true` — apparent evidence of repeated identical chat requests or a retry bug on the client side that was never deduplicated.

### 5.6 `GET /api/briefing`, `POST /api/briefing`
`GET`: reads `store/kitchen-briefing.json`, returns `{text, events, weather, generatedAt}`, or `{text:null, generatedAt:null}` if the file is missing/unparseable.
`POST`: **the only access-controlled route in the app.** Checks `req.socket.remoteAddress` for a `127.0.0.1`/`::1`/`::ffff:127.` substring; anything else gets `403 {error:'csak localhost'}`. This is a same-machine check, not an auth check — trivially satisfied by anything running on the WSL2 host itself (including the main BÉLA agent process, or literally any other local process/script). Body `{text, events, weather}` is written verbatim to `kitchen-briefing.json` with `generatedAt: Date.now()` added. **Nothing calls this route automatically.** It is meant to be called by the main BÉLA agent during a morning heartbeat, but there is no cron/scheduled-task entry wired up for it (same situation as §5.3) — if BÉLA's heartbeat doesn't happen to run and call it, the briefing bar simply never appears (frontend also gates on `age > 18h → don't show`, so a stale briefing from yesterday silently disappears too).

### 5.7 `GET /api/profiles`, `GET /api/profile/:person`, `POST /api/profile/:person`
Loads/saves `store/kitchen-profiles.json`. On first boot, if the file doesn't exist, it's seeded from `DEFAULT_PROFILES` (hardcoded in `server.js:22-27`) for exactly four keys: `Istvan`, `Erika`, `Adam`, `Viktoria` (note: no accented characters in the object keys, unlike the JSON's display strings). `POST /api/profile/:person` does a shallow merge (`{...existing, ...body}`) — array fields like `allergenek` are **replaced wholesale**, not appended, if the caller sends a new array. There is no frontend UI that calls `POST /api/profile/:person` at all — the only way to edit a profile today is a direct API call or hand-editing the JSON file.

### 5.8 `POST /api/chat`
The core route. Body: `{message, history?: [], person?: 'Istvan'}`.
1. Lowercases the message, checks two keyword sets: `isWeatherQ` (substrings `időjárás|idő|fok|eső|meleg|hideg` — note `idő` alone matches almost anything containing the string "idő", including unrelated words) and `isRecipeQ` (`RECIPE_KEYWORDS`, §4.2).
2. Runs `fetchWeatherContext()` and `fetchRecipeContext()` in parallel via `Promise.all`, each conditionally resolving to an empty string/object if its keyword check failed.
3. Builds `personCtx` from the requested person's profile (`buildProfileCtx`).
4. Builds the final system prompt via `buildSystemPrompt(weatherCtx, recipeCtx, personCtx)` (§8.6) — this is a **brand new string every call**, not cached, not reused across turns.
5. Sends `history.slice(-6)` (the *server* independently truncates to 6, even though the *client* already truncates to 8 before sending — so effectively the last 6 of whatever the client sent) plus the new user message.
6. Calls OpenAI chat completion (§4.1).
7. If `isRecipeQ`, attempts to `JSON.parse` the model's response and overwrite `extra.recipe.{youtubeUrl,sourceUrl}` with the verified TheMealDB values; silently no-ops (empty `catch{}`) if parsing fails, meaning a malformed model response for a recipe query passes through with **unverified** URLs intact from the model.
8. Returns `{text}` — the raw JSON string, unwrapped, unvalidated.

No retry logic anywhere in this route. A single OpenAI hiccup is a single failed user turn.

### 5.9 `GET /api/settings/resend-status`
Returns `{hasKey: existsSync(RESEND_KEY_PATH)}` — used by the frontend to color the 📧 shopping button and set its tooltip.

### 5.10 `POST /api/settings`
Body (as sent by the frontend): `{resendKey?, emailTo?, city?}`. **Only `resendKey` is actually handled** — `server.js:450-460` reads `req.body.resendKey` and writes it to `store/.resend-key` if truthy; `emailTo` and `city` are silently ignored server-side. This is not a bug that breaks anything functionally today, because the frontend never reads email/city back from the server — it keeps them purely client-side in `localStorage` (`bela-notify-email`, `bela-weather-city`) and always sends them explicitly on every relevant call (`getNotifyEmail()`, `getWeatherCity()`). But it means **the settings are per-browser, not per-installation** — if Erika opens the app on her own phone, she gets the hardcoded defaults (`styu01@gmail.com`, `Budapest`), not whatever Istvan configured on the kitchen tablet. It also means the `/api/settings` endpoint's accepted body shape is misleading relative to what it actually persists.

### 5.11 `POST /api/shopping-email`
Body `{items: string[], to?: string}`. `to` defaults to `'antal.er@gmail.com'` **on the server** (`server.js:464`) — this is a *different* default address than the client's own default of `'styu01@gmail.com'` (`getNotifyEmail()` in `index.html`). In practice the client always sends `to` explicitly, so the server default is dead code, but it is a landmine: if the client-side default or the Settings UI is ever refactored to omit `to`, the fallback silently changes who receives the shopping list. Sends via Resend (§4.4); fails with an unhandled file-read error today since the key file doesn't exist (see §4.4, §12).

### 5.12 `GET /api/weather`
Query: `city?` (default `Budapest`). Note the frontend actually calls this with an extra `days=3` query param (`loadWeather()` in `index.html:716`) that the server **does not read at all** — the forecast length is hardcoded to `slice(0, 3)` regardless. Harmless today (client only ever asks for 3), but the `days` param is decorative/dead.

### 5.13 `POST /api/tts`
Body `{text, voice?: 'onyx'}`. `text.slice(0, 4096)` before sending to OpenAI (OpenAI TTS's hard input limit). Returns raw `audio/mpeg` bytes, not JSON. No caching — identical text spoken twice (e.g. the same briefing replayed) re-hits the OpenAI TTS API both times.

---

## 6. Data persistence — exact file schemas

### 6.1 `store/kitchen-profiles.json`
```json
{
  "Istvan":   { "kedvenc_etelek": string[], "kedvenc_alapanyagok": string[], "allergenek": string[], "dieta": string, "megjegyzes": string },
  "Erika":    { ... same shape ... },
  "Adam":     { ... },
  "Viktoria": { ... }
}
```
Object, not array. Keys are the exact strings used everywhere else as the `person` identifier (frontend `data-person` attributes, `currentPerson` localStorage value, chat request `person` field). No `id` field, no email/notification prefs per-person (those live in a separate, un-keyed localStorage setting).

### 6.2 `store/kitchen-reminders.json`
```json
[{ "id": number /* Date.now() */, "text": string, "dueMs": number|null, "done": boolean, "due": boolean, "createdAt": number }]
```
Array. `due` is a derived/cached flag flipped server-side by `GET /api/reminders` once `dueMs` has passed; it is **not** automatically re-computed if the file is edited by hand while the server isn't polling. `dueMs: null` means "no specific time" — such reminders never get `due` flipped to `true` and thus never trigger the frontend's `speak('Emlékeztető: ...')` announcement; they just sit in the list until manually marked done.

### 6.3 `store/kitchen-briefing.json`
```json
{ "text": string, "events": [{ "time": string, "title": string }], "weather": object, "generatedAt": number }
```
Single object, overwritten wholesale on every `POST`. No history of past briefings is kept.

### 6.4 `store/kitchen-calendar-requests.json`
```json
[{ "id": number, "summary": string, "date": string|undefined, "time": string|undefined, "duration": number|undefined, "notes": string|undefined, "pending": boolean, "createdAt": number }]
```
Append-only from the kitchen server's side. Nothing in this codebase ever sets `pending: false` or removes an entry — that would have to happen in whatever external process drains the queue, and since that process doesn't formally exist yet (§5.3), **this file can only grow**. As of this writing it's `[]` (empty), so no request has round-tripped through this queue yet, or all have been manually cleared.

### 6.5 `store/kitchen.pid`, `store/kitchen.log`
Plain-text PID (written by `bela-start.sh`) and append-only stdout/stderr log (redirected by the same script). Not rotated — `kitchen.log` will grow indefinitely across restarts unless something external truncates it.

---

## 7. Data flow — key sequences

### 7.1 Text chat turn
```
user types → submitText() → sendText(msg)
  → appendMsg('user', msg); history.push(...); saveHistory() [localStorage]
  → POST /api/chat {message, history: history.slice(-8), person: currentPerson}, 20s AbortController
      server: buildSystemPrompt (weather? recipe? profile?) → OpenAI chat/completions (gpt-4o)
              → if recipe: overwrite extra.recipe.{sourceUrl,youtubeUrl} with TheMealDB truth
      ← {text: '<raw JSON string from model>'}
  → history.push(assistant reply); saveHistory()
  → appendMsg('bela', reply)
      parses reply as JSON → renders bubble-short (spoken) + bubble-long (markdown) + extra card
      if extra.type is timer/shopping/reminder/calendar_add → side-effect function called (addTimer/addShoppingItem/addReminder/addCalendarRequest)
  → speak(short || long) → POST /api/tts → <audio/mpeg> → new Audio(blob url).play()
```
On AbortError (>20s) or network failure, a hardcoded BÉLA-voiced JSON string is injected into `appendMsg` directly (client-side, no server round trip for the error message itself).

### 7.2 Voice chat turn
```
mic button click → getUserMedia → MediaRecorder(webm/opus or best supported) records
mic button click again (manual stop, no VAD) → recorder.stop()
  → blob → base64 → POST /api/stt → OpenAI Whisper → {text}
  → appendMsg('user', text) [as if typed]
  → same POST /api/chat flow as §7.1, with its own independent 20s AbortController
```
Two full network round trips (STT then chat) before any reply is even fetched, each with its own timeout; total worst-case latency before a friendly timeout message can appear is up to ~40s+ (STT has no client-side timeout at all, chat has 20s) plus whatever TTS synthesis adds afterward.

### 7.3 Wake word → hands-free trigger
```
Web Speech Recognition (continuous, hu-HU, interim results) running in background
  → transcript matched against WAKE_PHRASES (accent-stripped substring match)
  → recognition.stop(); speak('Szia! Miben segíthetek?'); status → "Figyelem..."
  → after 1800ms fixed delay: micBtn.click() [starts recording as if user pressed the button]
  → after another 500ms: startWakeWord() again [restart listening after recording begins]
```
The 1800ms is a fixed guess at how long the greeting takes to finish speaking — it is not synchronized to the actual TTS audio duration, so a longer/shorter greeting can start recording too early/late relative to real audio playback. Recording itself still stops only on a second manual click (or, in the wake-word path, never automatically) — there is no VAD auto-stop.

### 7.4 Briefing generation and playback (cross-process)
```
[external, no code in this repo] BÉLA agent, sometime during a morning heartbeat:
  gathers weather + calendar + reminders → composes Hungarian summary text
  → POST /api/briefing (from localhost) → kitchen-briefing.json written

[kitchen server, independent] GET /api/briefing polled once on page load
  → if generatedAt is <18h old → briefing-bar shown with 80-char preview

[user] taps briefing bar → playBriefingWithMusic()
  → GET /api/greeting → random time-of-day line
  → startBgMusic() [hidden 1x1 YouTube IFrame player, video id rrim6_9VSeM = AC/DC "Back in Black", volume 15]
  → speak(greeting + ' ' + briefingText)
  → estimate spoken duration as (word_count / 2.5 words/sec) + 1000ms
  → setTimeout(() => stopBgMusic(3-second fade), estimate)
```
The "18 hours" freshness gate and the "briefing only exists if someone remembered to POST it" gate are two independent single points of failure for this feature ever appearing at all on a given day.

### 7.5 Timer lifecycle
```
addPreset(n) [accumulate pendingSeconds] → startPendingTimer() → addTimer(seconds, label)
  → push {id: Date.now(), endMs: now+seconds*1000, label, done:false, acknowledged:false} to in-memory `timers[]`
  → saveTimers() [[localStorage 'bela-timers'], render, startTimerInterval(id) [setInterval 1000ms]
on tick: if now >= endMs → done=true, clearInterval, saveTimers(), triggerAlarm(id) [speak + repeating beep every 2500ms via Web Audio oscillator]
on page load: restoreTimers() reads localStorage, re-derives whether each saved timer is still pending, already expired-but-unacknowledged, or done, and re-establishes intervals/alarms accordingly
acknowledgeTimer(id) → marks acknowledged, filters it out of the in-memory+persisted array, stops the beep loop if no other alarms remain
```
Entirely client-side; the server has no concept of timers at all.

---

## 8. Frontend architecture (`public/index.html`)

Single file, no modules, everything in one global `<script>` block, organized by `// ====` comment banners (not actual module boundaries — every function is a global).

### 8.1 Global mutable state
| Variable | Purpose | Persisted? |
|---|---|---|
| `currentPerson` | selected profile name, sent on every chat call | localStorage `bela-person` |
| `history` | last N chat turns `{role, content, ts}` | localStorage `bela-chat-history`, capped to last 50 on save |
| `timers` | active timer objects | localStorage `bela-timers` |
| `shopping` | shopping list items `{id, name, done}` | localStorage `bela-shopping` — **not on the server at all** |
| `reminders` | mirror of server state, refreshed every 60s | server (`kitchen-reminders.json`) |
| `pendingSeconds` | accumulator for the preset-buttons-then-start flow | in-memory only |
| `recording`, `isProcessing` | UI/request-lock flags | in-memory only |
| `wakeRecognition`, `wakeActive` | Web Speech continuous-recognition instance/state | in-memory only |
| `ttsAudio` | currently-playing TTS `Audio` object (interrupted/replaced on new `speak()` calls) | in-memory only |
| `ytPlayer`, `ytReady` | hidden YouTube IFrame player for background music | in-memory only |
| `viewerCurrentUrl` | URL currently loaded in the in-app iframe viewer | in-memory only |

### 8.2 Settings actually stored, and where
| Setting | Storage | Read by |
|---|---|---|
| Notification email | `localStorage.bela-notify-email` (client-only; default `styu01@gmail.com`) | `emailShoppingList()` |
| Weather city | `localStorage.bela-weather-city` (client-only; default `Budapest`) | `loadWeather()` only — **the server-side chat weather context (`fetchWeatherContext`) always uses Budapest regardless of this setting**, so a per-user city change affects the visible widget but not what the AI says in chat |
| TTS voice | `localStorage.bela-voice` (default `onyx`) | `speak()` |
| Resend API key | `store/.resend-key` on the server (write-only from the client's perspective; `POST /api/settings`) | `POST /api/shopping-email` |
| Chat/timer/shopping/history state | see §8.1 | — |

All of the client-only settings are **per-browser**, not per-app-install: a different device/browser on the same tablet, or Erika's own phone, starts from the hardcoded defaults, not from whatever was configured on the kitchen tablet. There is no server-side single source of truth for these preferences (§5.10).

### 8.3 Markdown rendering (`renderMarkdown`)
Hand-rolled regex pipeline, in this exact order: HTML-escape → `**bold**` → `*italic*` → `` `code` `` → `[text](url)` links → bare YouTube URLs → bare other URLs → `### / ## / #` headers → `- ` unordered list items → `1. ` ordered list items → newline-to-`<br>` → post-hoc `<br>`-stripping regex to wrap consecutive `<li>` runs in `<ul>`/`<ol>`. This is order-sensitive and fragile (e.g. a `*` inside a URL or a literal backtick in a recipe step could mis-render) but has no test coverage; correctness is whatever manual testing happened to catch.

### 8.4 In-app link viewer
All links rendered by `renderMarkdown` get `class="viewer-link"` and a `data-title`, intercepted by a single delegated click listener on `#chat-area` that calls `openViewer(url, title)` instead of navigating. `openViewer`:
- YouTube search-result URLs (`youtube.com/results?...`, i.e. the "song suggestion" case from the system prompt, §8.6) are special-cased to open in a **real new browser tab** (`openInBrowserUrl`), bypassing the iframe entirely.
- Actual YouTube watch/short URLs are rewritten to an embeddable `youtube.com/embed/<id>?rel=0` URL via `toYouTubeEmbed()` and loaded in an `<iframe>` inside a slide-in "viewer panel" that covers the chat area, with a manual "🚫 this page can't display here / open in browser" fallback UI, driven by a same-origin-check trick (`iframe.contentDocument.location.href === 'about:blank'` after `onload`, which throws — and is caught — for genuinely cross-origin loads, meaning the error banner only reliably fires for same-origin-blank failures, not all embed refusals; sites that refuse via `X-Frame-Options` typically just render blank without ever throwing, so this detection is best-effort, not reliable).
- Everything else loads directly in the same iframe.

This is the mechanism behind the "YouTube links open in an in-app embedded viewer, not a plain clickable link" behavior flagged for confirmation with Istvan in the product spec — it is deliberate, working code, just possibly not what was originally asked for ("just a clickable text link, no player").

### 8.5 Wake word implementation
`webkitSpeechRecognition`/`SpeechRecognition` (Web Speech API), `continuous: true`, `interimResults: true`, `lang: 'hu-HU'`. Restarts itself on `onend` (unless actively handling a wake event or already recording) and on most `onerror` codes (backs off 3s), except `not-allowed`/`service-not-allowed` (permission denied — gives up silently). Only starts after the very first user click anywhere on the page (`{once:true}` listener), per browser autoplay/mic-permission policy. **Not supported on Safari/iOS** (no `webkitSpeechRecognition` there for continuous dictation in the way Chrome/Android implements it) — Chrome on Android is the only realistically supported wake-word platform, which matches the tablet's actual OS.

### 8.6 System prompt construction (`buildSystemPrompt`, mirrors the server-side function of the same name)
Built fresh per request from four pieces: today's date in Hungarian (`getBudapestDate()`, `Europe/Budapest` locale), an optional weather context string, an optional recipe context string, an optional per-person profile context string. The instructions embedded in the prompt (not enforced by any schema validator, purely prompt-level) require:
- Always return exactly `{"short":..., "long":..., "extra":...}` as raw JSON, nothing else.
- `extra` can be `null` or one of: `recipe`, `timer`, `shopping` (`action:"add"`), `reminder`, `calendar_add`. These four/five types are the **entire extension surface** of the app — any new structured action (e.g. a future "cancel timer by voice" or "remove shopping item by voice") would require both a new `extra.type` in this prompt and a matching `else if` branch in the frontend's `appendMsg()` extra-handling switch (§7.1's side-effect dispatch).
- Calendar dates must be computed by the model relative to the real current date and returned as ISO `date` + `HH:MM` `time`.
- YouTube/music requests must never return a direct `watch?v=`/`youtu.be` URL — only a `youtube.com/results?search_query=...` search link — specifically to avoid the model guessing a (possibly wrong or nonexistent) direct video.

### 8.7 "Keep screen awake" hack
Every 25 seconds, a throwaway `AudioContext` is created, `resume()`d, and `close()`d 500ms later (`index.html:1700-1703`). This is a workaround for iOS/some Android browsers suspending JS timers or dimming/locking the screen during inactivity — it is **not** the real [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) (`navigator.wakeLock.request('screen')`), which would be the correct, purpose-built tool for this and is not used anywhere in the codebase.

### 8.8 PWA claim vs. reality
Memory notes and the product spec both describe this as a "PWA frontend." In the actual code: there is `<meta name="apple-mobile-web-app-capable" content="yes">` and `<meta name="mobile-web-app-capable" content="yes">`, but **no `manifest.json`, no `<link rel="manifest">`, and no Service Worker registration anywhere**. It is a mobile-optimized web page that can be added to a home screen manually via the browser's "Add to Home Screen" (which is what those two meta tags enable), but it is not an installable, offline-capable PWA by the modern definition. This is directly why "Service Worker + Push Notification" is a real, from-scratch backlog item and not a small tweak (§14.2).

---

## 9. Security notes

- **No authentication on any `/api/*` route** except the localhost-only check on `POST /api/briefing`. Anyone on the home LAN who can reach `<host>:3421` can read/write reminders, read/edit profiles, trigger emails via `/api/shopping-email`, and burn OpenAI API credits via `/api/chat`, `/api/stt`, `/api/tts`. Mitigated in practice only by the fact that the port is not exposed past the home router (no port-forward to the public internet is documented anywhere).
- `store/.openai-key` is `600` (owner-only) — correct. `store/.resend-key` doesn't exist yet, but the code that will create it (`writeFileSync(RESEND_KEY_PATH, ...)`, `server.js:454`) does **not** explicitly set file mode, so it will inherit the process's default `umask`-derived permissions rather than being forced to `600` like the OpenAI key was (presumably set manually outside this code). Worth hardening when the key is actually provisioned.
- XSS: all model output rendered as `long`/`short` goes through `renderMarkdown()`, which HTML-escapes first, then re-introduces a small, fixed set of tags via regex — so a malicious/broken model response cannot inject arbitrary HTML through the markdown path. Recipe card fields, reminder text, and timer labels are separately escaped via `esc()` wherever they're interpolated into `innerHTML`. Plain `textContent` assignment is used in a few places (e.g. user bubble) which is inherently safe regardless.
- No CSRF protection is needed/relevant here since there's no cookie-based session or cross-site-sensitive state — everything is same-origin fetches from the one page.
- No rate limiting anywhere — a malicious or buggy client (or a runaway retry loop) could rack up unbounded OpenAI spend; there is no server-side cap.

---

## 10. Known technical inconsistencies (as opposed to missing features — these are things that *are implemented* but don't quite do what the docs/names imply)

1. Model is `gpt-4o`, not `gpt-4o-mini` as stated in multiple memory notes and the older product-spec draft.
2. `POST /api/settings` accepts and the frontend sends `emailTo`/`city`, but the server only persists `resendKey`; the other two fields are dead on arrival server-side (§5.10).
3. Default shopping-list recipient differs between client (`styu01@gmail.com`) and server fallback (`antal.er@gmail.com`) — currently masked because the client always sends `to` explicitly (§5.11).
4. `GET /api/weather?days=3` — the `days` param is sent by the client but ignored by the server, which always returns exactly 3 forecast days (§5.12).
5. Weather **in chat answers** is always for Budapest regardless of the user's configured city, even though the **weather widget** does respect the configured city — two different code paths, only one honors the setting (§8.2, §4.3).
6. "PWA" is a partial truth: home-screen-installable via meta tags, but no manifest and no service worker (§8.8).
7. "Briefing plays AC/DC" is real but implemented as a hidden YouTube IFrame embed of a specific public video (`rrim6_9VSeM`), not a local/licensed audio asset — this is dependent on that specific YouTube video staying available and embeddable, and technically streams from YouTube on every playback.
8. `store/kitchen-reminders.json` currently contains 6 duplicate "Hívd fel Erikát hogy vegye be a kollagént" entries — evidence worth investigating (possible double-submit on the client, or repeated identical voice/chat requests) even though it's not actively harmful (all marked `done`).

---

## 11. Planned work — technical implementation notes

Each item below is a real backlog entry (matches the product spec's roadmap) with concrete implementation guidance, not just a restated wish.

### 11.1 Server-side shopping list (highest priority backlog item)
Move `shopping[]` from `localStorage` to a new `store/kitchen-shopping.json`, mirroring the existing reminder CRUD pattern exactly: `GET/POST /api/shopping`, `PATCH /api/shopping/:id`, `DELETE /api/shopping/:id`. Frontend swaps its direct `localStorage` read/writes in `addShoppingItem`/`toggleShoppingItem`/`removeShoppingItem`/`renderShopping` for `fetch` calls, same shape as `loadReminders`/`addReminder`/`doneReminder`. Needs a polling interval (or, better, do this at the same time as §11.2's Service Worker work and skip polling in favor of push-driven refresh). No auth model changes needed since nothing in this app has auth today (§9) — but this is exactly the kind of change that makes the "no auth on `/api/*`" gap more consequential (now multiple devices legitimately mutate shared state, so a bad actor on the LAN could also corrupt the shared list, not just a personal one).

### 11.2 Service Worker + Web Push (timers/reminders survive tablet sleep)
Requires: a `manifest.json` (currently absent, §8.8), a registered Service Worker (`navigator.serviceWorker.register(...)`), the Web Push API (`PushManager.subscribe`) with VAPID keys generated once and stored server-side, a push subscription persisted per-device (would need a new `store/kitchen-push-subscriptions.json` keyed by subscription endpoint), and a server-side trigger — either the existing 1-second timer-check loop moved server-side (currently timers are 100% client-side, §7.5), or a periodic Node `setInterval` in `server.js` that scans due reminders/timers and calls `web-push` (npm package) to fire a `Notification`. This is the single largest architectural change on the backlog — it requires moving timer state from "purely client-side JS" to "server knows about it," which the current design deliberately avoids.

### 11.3 Voice Activity Detection (hands-free auto-stop)
Today `micBtn` click starts *and* stops recording manually (§7.2); the wake-word path starts recording automatically but still requires a manual second click to stop (§7.3). Plan: integrate `@ricky0123/vad-web` (runs a small ONNX model in an AudioWorklet, browser-side, no network call) — on speech-end detection (configurable silence threshold, ~1.5s), call the existing `recorder.stop()` programmatically instead of waiting for a click. This is additive to the existing `MediaRecorder` flow, not a replacement — VAD only decides *when* to call the already-existing stop function.

### 11.4 Reminder recurrence
Add a `recurrence: "daily"|"weekly"|null` field to the reminder schema (§6.2). On `GET /api/reminders`, when a recurring reminder's `due` flag is served/acknowledged, instead of just marking `done`, compute the next `dueMs` (add 1 day or 7 days) and reset `due:false` rather than terminating it. Needs a decision on weekly reminders: store day-of-week explicitly rather than just "+7 days from creation," so editing the time doesn't drift the weekday.

### 11.5 `kitchen-memory.json` — learned facts extracted from conversation
Not started. Would need: (a) a new `extra.type: "learned_fact"` addition to the system prompt's structured-output contract (§8.6) so the model can flag something as memorable mid-conversation, (b) a new `store/kitchen-memory.json` (simple array of `{person, fact, learnedAt}`, FIFO-capped as the product spec suggests, e.g. max 20), (c) a new section injected into `buildSystemPrompt`/`buildProfileCtx` analogous to the existing profile context, reading from this file per-person. This is a small, well-contained addition and doesn't require the two large architectural changes above.

### 11.6 Profile editor UI
The backend already fully supports this (`GET/POST /api/profile/:person`, §5.7) — this is purely a frontend task: a form inside (or reachable from) the existing Settings panel, pre-filled via `GET /api/profile/:person` for the currently-selected person, submitting via the existing `POST /api/profile/:person`. No server changes needed at all.

### 11.7 Recipe fallback URL
When `translateRecipeQuery()` finds no dictionary match (or TheMealDB returns no result for a term that *did* match), instead of returning an empty context (current behavior, `server.js:329-336`, letting the model answer with no grounding), return a Nosalty.hu search URL built from the raw Hungarian query string (always valid as a search link, unlike a guessed direct recipe URL) and inject it as `extra.recipe.sourceUrl` server-side, the same way TheMealDB URLs are force-injected today (§4.2) — the mechanism to overwrite `extra.recipe.*` post-hoc already exists, this just adds a second, Hungarian-language fallback source.

### 11.8 Direct Google Calendar API (skip the heartbeat queue)
Marveen already has Google Calendar MCP tooling set up for the main BÉLA agent (OAuth already authorized, per the `google-mcp-auth` skill and the MCP tool list). The kitchen server itself has no Google credentials and would need its own OAuth token/refresh-token pair (either its own client registration, or reuse of the existing token file if one is stored somewhere the kitchen process can read) to call the Calendar API directly from `server.js`, bypassing `kitchen-calendar-requests.json` and the informal heartbeat drain entirely (§5.3, §7.4). This removes the up-to-30-minute latency but introduces a second consumer of Google credentials that needs its own error handling (expired token, quota, etc.) independent of the main agent's.

### 11.9 Multi-turn recipe "next step" voice mode
Would need: a new short-lived session state (not currently modeled anywhere — today each chat turn is stateless beyond the `history` array) tracking "we are currently walking through recipe X, at step N." Simplest implementation: keep the recipe's step list in a client-side variable set when a recipe card is rendered, and special-case an utterance like "kész, mi a következő?" client-side (regex match, no AI round trip needed) to just advance a local index and `speak()` the next step string directly — this avoids a new AI call and a new `extra.type` entirely, and is cheaper/faster than routing it back through `/api/chat`.

### 11.10 Contextual UI emphasis by time of day
Purely frontend/CSS + a small JS branch: reuse `getBudapestHour()`-equivalent logic (already exists server-side, would need a client-side mirror or a new lightweight `GET /api/time-period` returning what `/api/greeting` already computes internally) to toggle a CSS class on `#app` (e.g. `period-morning`, `period-cooking`) that reorders/resizes cards via existing CSS grid/flex rules. No new data, no new persistence — this is the cheapest item on the entire backlog.

---

## 12. Summary — current state in one paragraph

Béla Home today is a fully client-persisted (timers, shopping list, chat history, most settings), server-orchestrated-AI (chat/STT/TTS all proxy through `server.js` to OpenAI) single-tablet kitchen assistant with four hardcoded family profiles, a working but latency-bound calendar/briefing bridge to the main BÉLA agent via shared JSON files with no enforced schedule, and zero authentication anywhere except a same-machine check on one internal-only route. Its biggest structural gaps are: shopping list not shared across devices, no survive-sleep notification path (needs a genuine Service Worker + Push architecture, not yet started), and voice interaction that is push-to-talk end-to-end (wake word only automates the *start*, never the *stop*). Everything else on the roadmap (profile editor UI, recipe fallback URL, recurrence, contextual UI, learned-facts memory) is small, additive, and doesn't require touching the app's core architecture.
