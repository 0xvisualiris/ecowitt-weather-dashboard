# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ecowitt Weather Dashboard

Project guide for Claude Code. Read this before making changes.

## Keep the local copy in sync with GitHub

The maintainer also edits the repo directly on GitHub (web UI), so this local clone can fall behind. **Always work on the latest version of the repository:**

- At the start of every session, and again before making any change, run `git fetch origin` and `git status -sb`.
- If the local branch is behind `origin/main`, update it with `git pull --ff-only origin main` before doing anything else.
- If the pull can't fast-forward (uncommitted local changes or diverged history), stop and ask the user. Never stash, reset, rebase or force-push on your own.
- After pulling, re-read any of `CLAUDE.md`, `README.md` or `config/config.example.yaml` that changed. They are the project's reference docs.
- Pull again right before committing or pushing, so you don't push on top of a stale base.
- Keep both `main` and `dev` up to date (`git fetch origin` covers both; fast-forward the local branch you are about to work from).

## Branching, versioning and releases

Every change goes through `dev` before it reaches production. Nothing is committed directly to `dev` or `main`; both branches are protected on GitHub (PR required, no force-push, no deletion, applies to admins too).

```
feature/<name> | fix/<name>  ──PR──▶  dev  (pre-release vX.Y.Z-dev.N)  ──PR──▶  main  (release vX.Y.Z)
```

### Version numbers

- [SemVer](https://semver.org), one version for the whole project. The tag is the source of truth; `server/package.json` carries the same version and is bumped at each production release.
- Pick the next version from the changes since the last production release:
  - **MAJOR**: breaking change for deployments (renamed/removed config keys or env vars, changed port, changed volume layout, API response changes that break consumers).
  - **MINOR**: new feature, screen, metric, config option or alert capability.
  - **PATCH**: bug fixes, styling, docs, dependency bumps.
- Dev versions are pre-releases of the *upcoming* production version: `v1.1.0-dev.1`, `v1.1.0-dev.2`, … If a later merge raises the bump level (e.g. a feature lands after only fixes), continue with the higher target: `v1.0.1-dev.2` → `v1.1.0-dev.1`.
- Baseline: the state of `main` before this workflow was introduced is `v1.0.0`.

### Merging into `dev` (every merge)

1. Branch from the latest `dev`: `feature/<short-name>` or `fix/<short-name>`.
2. Before opening the PR: `cd server && npm test` must pass, every changed frontend file must pass `node --check`, and the change must be checked in demo mode in a browser, in English and in German.
3. Open a PR into `dev`, then merge it (squash merge, PR title becomes the commit message).
4. Tag the merge commit with the next dev version and push the tag: `git tag -a v1.1.0-dev.3 -m "v1.1.0-dev.3" && git push origin v1.1.0-dev.3`.
5. Create a GitHub **pre-release** with release notes for just this merge: `gh release create v1.1.0-dev.3 --prerelease --target dev --title "v1.1.0-dev.3" --notes-file <file>`.

The `v*` tag makes CI build and publish the image as `ghcr.io/0xvisualiris/ecowitt-weather-dashboard:1.1.0-dev.3`, which can be deployed for testing without touching `latest`. Every push to `dev` also updates the moving `:dev` image tag, so a test container can simply track `:dev`.

### Releasing to production (`dev` → `main`)

Only when the user asks for a production release. A request to merge `dev` into `main` is a request for a production release.

Carry out all four steps yourself, including writing the release notes, pushing the tag and creating the GitHub release. Don't hand the tag or the release back to the user as commands to run. The release is finished only when the `vX.Y.Z` tag and the GitHub release exist.

1. Create `release/vX.Y.Z` from `dev`. Bump `version` in `server/package.json` (and its lockfile) with `npm version <x.y.z> --no-git-tag-version`; npm reformats `"engines"` in `server/package.json`, so restore the one-line form.
2. Add the release section to `CHANGELOG.md` (newest on top), summarising all dev pre-releases since the last production version. Merge `release/vX.Y.Z` into `dev` via PR. This release-prep merge does **not** get its own `-dev.N` tag.
3. Open a PR `dev` → `main` titled `Release vX.Y.Z` and merge it with a **merge commit** (not squash), so `dev` and `main` stay in sync.
4. Tag the merge commit on `main` as `vX.Y.Z`, push the tag, and create a full GitHub release: `gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes-file <file>`.

Pushing to `main` publishes `latest`; the tag publishes `X.Y.Z`.

### Release notes

Written in English, for people who run the dashboard, not for developers. Plain Markdown, **no emojis**. Use only the sections that apply, in this order:

```markdown
## vX.Y.Z – YYYY-MM-DD

### Breaking changes
- What changed and exactly what to do (config key renamed from `a` to `b`, …).

### New
- User-visible features.

### Improved
- Changes to existing behaviour, UI or performance.

### Fixed
- Bugs fixed, described by symptom ("History chart showed no data for year range").

### Upgrade
docker compose pull && docker compose up -d   (plus any extra steps)
```

- Dev pre-release notes cover only that one merge; production notes cover everything since the previous production release and link the PRs (`#12`).
- One line per change, no commit hashes, no internal refactors unless they affect users.
- Mention new config options with their key and default, and say whether `config.yaml` needs changing.

## Agent skills (addyosmani/agent-skills)

This project uses the [agent-skills](https://github.com/addyosmani/agent-skills) plugin for its engineering workflow. Install it once per machine:

```
/plugin marketplace add https://github.com/addyosmani/agent-skills.git
/plugin install agent-skills@addy-agent-skills
```

Claude Code picks skills from their descriptions, so there is no need to load `using-agent-skills` by hand. Use them at these points:

| When | Skill or command |
|---|---|
| A request is vague or has several readings | `interview-me` before writing anything |
| New feature, screen, metric, config option or alert capability | `spec-driven-development`, then `planning-and-task-breakdown` (`/spec`, `/plan`) |
| Implementing | `incremental-implementation`; add `frontend-ui-engineering` for `web/`, and `api-and-interface-design` for any `/api/*` change |
| Code that uses DWD data, the HA WebSocket API or the Ecowitt gateway API | `source-driven-development`: check the real format or docs, never guess |
| Something broke | `debugging-and-error-recovery` |
| Before opening a PR into `dev` | `code-review-and-quality` (`/agent-skills:review`); add `security-and-hardening` when touching `admin.js`, `totp.js`, sessions, the CSP or anything under `/api/admin/*` |
| Radar, charts or anything that renders per frame | `performance-optimization` |
| Changing `README.md`, this file or `config.example.yaml` | `documentation-and-adrs` |

### Where this project's rules win

The skills are generic. Where one disagrees with this file, this file wins:

- **Git and releases:** follow "Branching, versioning and releases" above, not `git-workflow-and-versioning`'s trunk-based model. Changes go `feature/*` / `fix/*` → `dev` (squash merge) → `main` (merge commit). `/ship` and `shipping-and-launch` don't replace that process. There are no feature flags or staged rollouts here: a release is a Docker image tag.
- **Tests:** use `test-driven-development` for the server's pure logic, where `node:test` suites already exist (`util.js`, `units.js`, `alerts.js`, `totp.js`, `radolan.js`, `ecowitt.js`, `recorder.js`, `admin.js`, `config.js`, `entities.js`). Don't add a test framework or tests for the frontend modules. Verify those in demo mode, as described under "Commands".
- **Dependencies:** no skill justifies a new dependency. "Keep the dependency footprint small" under "Hard constraints" still applies, so discuss any addition first.
- **Scope:** this is a hobby project kept deliberately simple. Keep specs and plans short. A small fix doesn't need a spec document.
- **Hard constraints** (no secrets in the browser, the CSP, the read-only public API, a non-root container, `DemoSource` kept in sync, port 47813) override any skill's advice.

## What this is

A public, read-only web dashboard for a personal weather station whose data lives in **Home Assistant** (HA), or is read straight from an **Ecowitt gateway** (`source: ecowitt`). One Docker container serves a static frontend (plain HTML, CSS and JavaScript modules, no build step) plus a small Node API. The backend holds the HA URL and token; the browser never sees them, nor coordinates or entity IDs.

- Hardware it was built for: Ecowitt WH90 (temp, humidity, ultrasonic wind, piezo rain, solar/UV), Ecowitt WH57 (lightning) and an Ecowitt gateway (pressure), via the HA Ecowitt integration. Any HA sensors work.
- Hobby project, vibe-coded with AI, not actively maintained. Keep changes simple and dependency-light.
- Repo: `0xvisualiris/ecowitt-weather-dashboard`. Image: `ghcr.io/0xvisualiris/ecowitt-weather-dashboard:latest`.
- **The UI is in English and German**, chosen per visitor (see "Languages"). **Everything else is English**: code, comments, docs, config files, tests, commit messages. German text exists in exactly two files, the translation tables `web/i18n.js` and `server/src/i18n.js`; don't put German anywhere else.
- There is one design, "Himmel" (sky): the last 24 hours as a landscape under a sky that follows the sun. Until v2.0.0 a second, React-based design ("classic") existed; it was removed, and so was the `ui.design` option.

## Repository layout

```
Dockerfile                  two stages (server deps → runtime), node:22-alpine; web/ is copied in as it is
docker-compose.yml          local build + run
.github/workflows/docker-publish.yml   builds amd64+arm64 image, pushes to GHCR on push to main / v* tags
config/config.example.yaml  fully commented example config (the reference for all options)
scripts/                    build-dwd-stations.mjs, build-radar-map.mjs: regenerate web/dwd-stations.json and web/radar-map.json, run by hand
docs/                       README screenshots (taken in demo mode)
server/                     Node 22 backend, ESM, plain JS, no framework
  src/index.js              HTTP server, routes, static files + SPA fallback, station name in index.html/manifest, security headers, gzip
  src/config.js             loads YAML, ${ENV} substitution, defaults, validation, SENSOR_KEYS, DEFAULT_ALERTS
  src/i18n.js               LANGS/LOCALES, the German texts of DEFAULT_ALERTS, compass points per language, textIn()
  src/ha.js                 HomeAssistantSource: HA WebSocket client
  src/ecowitt.js            EcowittSource: polls an Ecowitt gateway's local HTTP API directly (no HA), parseLiveData/parseSensors
  src/recorder.js           Recorder: the Ecowitt source's own history in DATA_DIR/ecowitt (raw samples + hourly rows), HA-shaped history()/statistics()
  src/demo.js               DemoSource: synthetic data, same interface as HomeAssistantSource
  src/dwd.js                DwdForecast: fetches/parses a DWD MOSMIX_L station KMZ, bias-corrects near-term with the live reading
  src/radolan.js            decodeRadolan: parses a DWD RADOLAN composite (ASCII header + binary uint16 grid) into {width,height,grid}
  src/radar.js              RadarSource: fetches+bunzip2s+decodes the DWD RY rain radar composites every 5 min, keeps the last 25 frames (two hours) in memory
  src/service.js            WeatherService: all data shaping (current, history, records, detail, hourly forecast) + METRICS
  src/alerts.js             AlertEngine: evaluates alert rules, fills in messages per language, persists log to DATA_DIR/alerts.json
  src/admin.js              AdminStore: login/session/password hashing, optional TOTP 2FA, persists DATA_DIR/admin.json, admin-settable HA/sensor/DWD settings
  src/entities.js           suggestSensors(): ranks HA sensors per sensor key (unit, device class, name, id family) for the admin entity picker
  src/totp.js               RFC 6238 TOTP (base32, HOTP, verify) on node:crypto only, no new dependency
  src/units.js              unit normalisation to canonical units, compass(deg, lang), fmtNumber(v, d, lang)
  src/astro.js              sunrise/sunset/day length/sun position/moon via suncalc
  src/util.js               local-time helpers, TTL cache, counter→increment conversion, time-bucketing (bucketLine/bucketCounter), round(), hourlyFromDays()
web/                        the frontend: plain HTML, CSS and ES modules loaded by the browser as they are; no build, no dependencies, not type-checked
  index.html                the page: header, one <main> per view, footer; static texts carry data-t keys
  styles.css                all styles and the colour tokens
  i18n.js                   LANG, tr(), loc(), the English and German text tables, serverError(); the only frontend file with German
  lib.js                    formatting (num, clock, atClock, hourLabel), units + conversion, METRICS, CONDITION, sky colours (skyAt), canvas and DOM helpers, getJson/postJson
  main.js                   hash routing (with the old German addresses as aliases), nav mark, kiosk mode, first-run redirect
  app.js                    Now: the landscape canvas, time cursor (drag/throw/spring), readout, instruments, next days; polls /api/current
  history.js                History: canvas line/bar chart, stats, today's figures, sensor info, records table, CSV export
  forecast.js               Forecast: 72-hour canvas chart, day-by-day list with three-hour tables (/api/forecast/hourly)
  radar.js                  Rain radar: frames, colour lookup table, playback, local rain readout
  map.js                    the one map of Germany on DWD's grid (canvas): projection, base map, place labels, pan/zoom; used by radar and both pickers
  pickers.js                admin-page map pickers: DWD station, approximate public location
  alerts.js                 Alerts: rules, active ones, log
  settings.js               Settings: language and units, stored in the visitor's browser
  admin.js                  station management: sign-in, password, 2FA, all admin settings
  manifest.webmanifest      installable-PWA manifest (name filled in by the server)
  favicon.svg, icon-192.png, icon-512.png, apple-touch-icon.png   app icon; the PNGs are renders of favicon.svg (regenerate them, e.g. with a headless browser, if the icon changes)
  fonts/                    Bricolage Grotesque (latin + latin-ext woff2, SIL OFL), self-hosted
  dwd-stations.json         ~2,800 DWD MOSMIX stations (id/name/lat/lon) for the station picker, from scripts/build-dwd-stations.mjs
  radar-map.json            base map (land, borders, federal states, rivers, lakes) as SVG path data in RADOLAN grid coordinates, from scripts/build-radar-map.mjs
```

## Commands

```bash
# Backend in demo mode, serving the frontend from web/ (http://localhost:47813)
cd server && npm install && DEMO=1 npm run dev
#   PowerShell: $env:DEMO=1; npm run dev

# Backend against a real HA instance
cd server && CONFIG_PATH=../config/config.yaml HA_TOKEN=... npm run dev

# Run the backend test suite (util, units, alerts, totp, radolan, radar, ecowitt, recorder, admin, config, entities)
cd server && npm test

# Syntax check of the frontend (there is no build and no type checker)
for f in web/*.js; do node --check "$f"; done

# Container
docker compose up -d --build
```

In a checkout the server serves `web/` directly (`config.js` finds it next to `server/` when `PUBLIC_DIR` isn't set), so a frontend change needs only a page reload. `npm run dev` restarts the server on server changes.

There's **no linter config**, and only a small, deliberately-scoped test suite — `cd server && npm test` (Node's built-in `node:test`, zero dependencies) covers the pure-logic hot spots (`util.js`, `units.js`, `alerts.js`'s condition/message/evaluate logic, `totp.js` against RFC 6238's own test vectors, `radolan.js`'s header/grid decoding against synthetic fixtures, the Ecowitt parsing, recorder and admin validation, the missing-config default and the entity picker's ranking), not the HTTP layer or the frontend. Verify everything else by running in demo mode and checking `/api/*` with curl plus the UI in a browser, in both languages.

**Every push to `main` publishes a new `latest` image to GHCR**, so merging to `main` is a production release. Follow the release process above.

## Architecture & data flow

```
Ecowitt → HA (Ecowitt integration, ~60 s) → HA WebSocket push → server (in-memory states)
   or: Ecowitt gateway ← server polls /get_livedata_info (poll_seconds) → in-memory states + Recorder (DATA_DIR/ecowitt)
browser polls /api/current every ui.refresh_seconds; views fetch /api/history etc. when opened
forecast: DWD MOSMIX_L KMZ (opendata.dwd.de, hourly poll) + live reading → bias-corrected daily and hourly forecast
          (falls back to the HA weather.* entity if dwd_station_id isn't set or DWD is unreachable)
rain radar: DWD RADOLAN RY composite (opendata.dwd.de, 5-min poll, bz2 → bunzip2 → binary grid) → /api/radar + /api/radar/grid
```

### Data source interface (`ha.js`, `ecowitt.js` and `demo.js` must stay compatible)

- `start()`; `connected` (bool); `lastMessage` (ms)
- `states`: `{ entity_id: { state, attributes, lu, lc } }`, with `lu`/`lc` (last updated/changed) in **milliseconds**
- `forecast`: array of HA daily forecast objects or `null`
- `location()` → `{ latitude, longitude, time_zone }`
- `history(entityIds, start, end)` → `{ entity_id: [{ t: ms, s: state }] }`
- `statistics(ids, start, end, period)` → `{ entity_id: [{ start: ms, mean, min, max, change, state }] }`, where `period` is `hour`, `day` or `month`
- Events: `update`, `status`, `config` (HA `get_config`), `forecast`
- Optional `sensorEntities()` → `[{ id, name, unit, deviceClass, state }]`, every `sensor.*` (HA `get_states`; `DemoSource` returns its own sensors plus a few look-alikes). Only for the admin page's entity picker; the Ecowitt source has none.

HA calls used: `auth`, `get_config`, `get_states` (admin entity picker only), `subscribe_entities` (compressed diffs `a`/`c`/`r`), `weather/subscribe_forecast` (daily), `history/history_during_period` (`minimal_response`, `no_attributes`), `recorder/statistics_during_period`, `ping`.

**HA reconnect** (`ha.js`): every way a connection can end goes through `_drop(ws, reason)`, which ignores sockets that are no longer current (so a late `close` from an old socket can't kill its replacement), rejects pending requests and schedules a reconnect with exponential backoff (max 60 s). Besides the `close` event it is triggered by: a 20 s handshake timeout (Node's WebSocket has none – a proxy or half-started HA that accepts TCP but never answers would otherwise hang forever), a failed `_afterAuth` (HA still starting – used to leave the source "connected" with no subscription), a missed `pong` to the 30 s `ping` heartbeat (a connection that died without a close, e.g. HA's host rebooted), and no entity event at all for 15 min (re-subscribes from scratch). The backoff only resets after setup succeeds.

**Ecowitt source** (`ecowitt.js`, `recorder.js`): polls `get_livedata_info` every `ecowitt.poll_seconds` – stateless, so an unreachable gateway just means the next poll succeeds again; there is nothing to reconnect. Its entity ids are the sensor keys themselves (`cfg.sensors = { temperature: 'temperature', … }`, set in `index.js` from a startup `probe()`, cached in `DATA_DIR/ecowitt/detected.json` for starts while the gateway is down); battery/signal from `get_sensors_info` become `<img>_battery`/`<img>_signal` (level 0–5 → %), and `station.devices` is generated from the paired sensors if none are configured. Values are converted to canonical units in the source (gateway unit strings like `mm/Hr`, `Klux`), and `lu` moves on every successful poll, so the stale dot means "gateway answered recently". `Recorder` appends every poll to `samples-YYYY-MM-DD.jsonl` (purged after `keep_raw_days`) and derives one row per completed hour into `hours.jsonl` (`[mean,min,max,last,change,n]`, `change` only for the daily-reset counters, computed with `counterIncrements`); `statistics()` rolls hours up to day/month in station time and includes the running hour, like HA. No forecast entity and no HA `get_config`, so `station.timezone`/`latitude`/`longitude` matter in this mode. `index.js` keeps the configured (HA) sensor mapping in `cfg.configuredSensors` so the admin page doesn't save the placeholder ids. The local API needs no key or password; only the gateway's address.

### Sensors and metrics

- Config `sensors:` maps fixed **sensor keys** (see `SENSOR_KEYS` in `config.js`) to HA entity IDs: `temperature, feels_like, dew_point, humidity, wind_speed, wind_gust, wind_direction, rain_rate, rain_event, rain_daily, rain_weekly, rain_monthly, rain_yearly, pressure, solar_radiation, uv_index, lightning_distance, lightning_time, lightning_count`. Missing keys are allowed, and the UI hides the matching readings.
- `METRICS` in `service.js` defines the 8 UI metrics: `temp, hum, wind, rain, press, solar, uv, light`. Each has a `sensor`, an `agg` (`mean` or `counter`) and optional `recordSensor` (wind records use the gust sensor) or `currentSensor` (light: the current value is the distance; the chart shows strike counts).
- `rain_daily` and `lightning_count` are **daily-reset counters**. Amounts come from `counterIncrements()`, which treats any drop as a reset; for statistics it prefers HA's `change` and falls back to `state`/`max`.
- If `rain_weekly`/`monthly`/`yearly` are missing, they are computed from daily statistics plus today's value.

### Units

The server normalises everything to canonical units in `units.js`: **°C, km/h, hPa, mm, mm/h, km**, based on each entity's `unit_of_measurement`. The browser converts to the visitor's units (`conv` / `metricConv` / `show` in `web/lib.js`), which are stored in `localStorage` key `himmel-units` (named after the design, kept so saved choices survive). For every unit a visitor hasn't chosen, `ui.default_units` from `/api/config` applies (`useDefaultUnits`).

Never convert units anywhere else. Exception: alert messages are formatted server-side in canonical units.

### Time zone

`process.env.TZ` is set at startup from `station.timezone`, otherwise from HA's `get_config.time_zone`, so plain `Date` methods in the server use station time. The frontend formats dates and times with the browser's own time zone.

### Languages

The UI is in **English and German**. All of it: every view, the admin page, the built-in alert rules, map labels, CSV files.

- **Choosing:** each visitor picks a language on the Settings page; it is stored in `localStorage` key `wetterstation.lang`. Without a choice, the browser's language decides (`de*` → German, anything else → English). A change reloads the page, so `LANG` in `web/i18n.js` is a constant for the page's lifetime and every module may call `tr()` at load time (e.g. `METRICS` labels in `lib.js`).
- **Frontend texts** live in one place, the `STRINGS` table in `web/i18n.js` (`en` and `de`, same keys). `tr('key', { var })` fills in `{var}`; a value may be a function for plurals; `words('key')` returns a list (compass points, wind words, table headings). Static texts in `index.html` carry `data-t="key"` (and `data-t-aria-label`, `data-t-aria-valuetext`); `translatePage()` runs once as soon as `i18n.js` loads, before any view writes its own text into those elements. Every new visible string goes into both tables; never write a visible string inline.
- **Formatting follows the language:** `LOCALE` is `en-GB` (24-hour clock, day-month order, decimal point) or `de-DE` (decimal comma). Use `num()`, `clock`, `atClock()` ("20:46" / "20:46 Uhr"), `hourLabel()` ("15:00" / "15 Uhr") and `DECIMAL`; a real minus sign (U+2212) in both. CSV export uses comma + decimal point + ISO dates in English and semicolon + decimal comma + `dd.mm.yyyy` in German, so the file opens in the visitor's spreadsheet.
- **The server sends no UI text** except alert texts: stat labels are stable keys (`min`, `rainDays`, …, translated as `stat.*`), forecast conditions are codes (`cond.*`), moon phases are slugs. A cached response is therefore valid for every visitor.
- **Alert texts:** a rule's `label`, `description`, `banner` and `message` are either a plain string (shown as written, in every language) or one string per language (`{ en: '…', de: '…' }`). The built-in `DEFAULT_ALERTS` (`config.js`) are written in English with their German in `server/src/i18n.js`. `AlertEngine._message()` fills a message in once per language (`LANGS`), so numbers, times and compass points (`E`/`O`) match each language; log entries store `text` as `{ en, de }` (entries from before v2.0.0 are plain strings). The frontend reads all of these through `loc()`. On the admin page a rule shows its texts in the admin's language, and a rule saved from there keeps plain strings.
- **Admin API errors** (`admin.js`'s `{error}` strings) stay English on the server; `serverError()` in `web/i18n.js` translates the known ones for German visitors.
- **Place names on the maps** are German by default with an English name where it differs (`München` → `Munich`, `Lüttich` → `Liège`), in `CITIES` in `web/map.js`.

### Forecast (`dwd.js`)

- **Picking a station** (admin page, "Pick station on the map", `stationPicker()` in `web/pickers.js`): the shared map (`web/map.js`) with a dot per station from `web/dwd-stations.json`, fetched only when the picker is opened — no mapping library, no map-tile requests. That file is static, generated by `scripts/build-dwd-stations.mjs` (zero-dependency Node, run by hand, not by any build step) and holds every station that (1) is in DWD's MOSMIX station catalogue (`mosmix_stationskatalog.cfg` under `dwd.de/DE/leistungen/met_verfahren_mosmix/`), (2) has a folder under `opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/` — i.e. DWD really publishes a MOSMIX_L forecast for it — and (3) lies on the map's 900×900 km grid: about 2,800 stations. Two traps, both of which an earlier hand-made version of this file fell into: **IDs are not all numeric** — most German stations have alphanumeric IDs such as `L771`, and they do have forecasts, so the folder listing, not the shape of the ID, decides; and **the catalogue gives positions in degrees.minutes, not decimal degrees** — `50.16` is 50°16′ = 50.267°, and reading it as a decimal moved stations by up to ~45 km. The catalogue also right-aligns short IDs in a fixed-width column, so it has to be parsed by column. Names come upper-case and ASCII with umlauts spelled out; the script title-cases them, and the picker's search folds typed umlauts to the same spelling.
- `WeatherService.forecast()` tries `DwdForecast.days()` first (when `forecast.dwd_station_id` is configured); if that returns nothing it falls back to the HA `weather.*`-entity logic (`src.forecast`, populated via `weather/subscribe_forecast` in `ha.js`).
- `DwdForecast` fetches `MOSMIX_L_LATEST_<station_id>.kmz` from `opendata.dwd.de` hourly (background `setInterval`, not awaited by `service.js` — same "populate a field, read synchronously" pattern as `ha.js`'s `forecast`/`states`). A KMZ's one entry is read via the zip central-directory record (DWD leaves the local header's size fields at 0) and inflated with Node's built-in `zlib`; the XML is parsed with a couple of targeted regexes (`TimeStep`, `TTT`, `ww`, `R101`, …), not a general XML library — no new dependency.
- `ww` (DWD's significant-weather code) maps to the same condition vocabulary HA emits (`sunny`, `rainy`, `lightning-rainy`, …) via `conditionCode`; the frontend translates that code itself (`cond.*`) and draws its symbol (`drawCondition()` in `lib.js`). A day's representative condition is its hourly rows' most severe `ww`; same-severity ties prefer a daytime hour.
- Bias correction: the offset between the live reading and DWD's own value for "now" is applied to the next `forecast.bias_hours` (default 6) of hourly temps, fading to 0 — only the near-term trajectory is nudged; day 2+ stays unmodified MOSMIX. `pop`/condition are never bias-corrected.
- **`/api/forecast/hourly`** feeds the Forecast page: `DwdForecast.hours()` (same bias correction as `days()`, plus rain amount, wind, gusts, sunshine and cloud cover parsed from MOSMIX) when a DWD station is set; otherwise `util.js`'s `hourlyFromDays()` spreads the daily forecast over the hours and the response says `synthetic: true`, which the page tells the visitor.
- On fetch/parse failure, a warning is logged and the last good result keeps being served (nothing overwrites `DwdForecast.hourly` on failure).

### Rain radar (`radolan.js`, `radar.js`, `web/radar.js`, `web/map.js`)

- **Data**: DWD's RADOLAN RY composite — a national 900×900 km rain-rate grid (1 km/px, polar-stereographic projection), updated every 5 minutes. `RadarSource` reads DWD's directory listing under `opendata.dwd.de/weather/radar/radolan/ry/`, keeps the newest 25 composites (two hours; about 0.8 MB each in memory) and backfills them newest-first on start, so the current frame is there after one download and the loop fills in behind it. Frames are identified by the UTC stamp in their file name (`stampToMs`). It fetches on the same "background interval, populate a field, read synchronously" pattern as `DwdForecast`/`ha.js`.
- **Decompression**: DWD only publishes RADOLAN as bz2, and Node has no built-in bzip2 support. Rather than add an npm dependency, `radar.js`'s `bunzip2()` shells out to the system `bunzip2` binary (`child_process.spawn('bunzip2', ['-c'])`) — the Dockerfile installs it (`apk add --no-cache bzip2`, alongside `tzdata`).
- **Decoding** (`radolan.js`'s `decodeRadolan`): a RADOLAN file is an ASCII header (`key=value` fields — `GP` grid dimensions, `PR` precision exponent, `MS` contributing station list, a `DDHHMM` timestamp) terminated by an ETX (0x03) byte, followed by a raw grid of little-endian uint16 values, one per cell. The low 12 bits are the masked value; DWD's fixed sentinel `2500` means "no data". `decodeRadolan` returns `{width, height, timestamp, grid}` where `grid` is a `Uint8Array` with one display-intensity byte per cell (255 = no data, 0 = no rain, 1–254 = `round(mm * 20)` clamped) rather than the raw uint16s, to keep `/api/radar/grid`'s payload small.
- **Rendering** (`web/radar.js`): the grid is coloured through a 256-entry lookup table on a log scale of rain rate (one intensity class = 0.6 mm/h; a linear ramp would paint nearly every frame one shade of blue), painted into a 900×900 canvas layer and drawn under the map's borders with smoothing. Cells outside radar range (255) are dimmed rather than transparent, which shows the edge of the coverage. If a public location is set, the map opens around it with distance rings (25/50/100 km — one grid unit is one kilometre), and a line beside the map reads the frame there: the rain rate, or the distance and direction to the nearest rain within 150 km.
- **Playback**: the screen opens on the newest frame, paused. Play steps through the held frames (420 ms each, the newest held for 1.6 s). Grids are kept as bytes and re-coloured per frame. `/api/radar` is polled every minute while the page is open.
- **One map for everything** (`web/map.js`, `createMap()`): the radar and both admin pickers draw the same canvas map in the same projection, so the public location picked on the admin page is by construction the spot the radar centres on. Base map (`web/radar-map.json`, see below), place labels in three tiers by zoom, drag / pinch / Ctrl + wheel / buttons / keyboard to move, `flyTo()` animations. A plain wheel or a one-finger drag scrolls the page and shows a short hint instead of moving the map.
- **Base map** (`web/radar-map.json`, `scripts/build-radar-map.mjs`): the radar can't use map tiles (no external requests, see the CSP), so land, country borders and coasts, the 16 federal-state borders, rivers and lakes are baked into one static ~115 KB file of SVG path data, already projected into RADOLAN grid coordinates and simplified to 0.3 km. Source is Natural Earth 1:10m (public domain). The script is zero-dependency Node and is run by hand; its projection constants must stay identical to `toGridPos()` in `web/map.js`.
- **Projection** (`toGridPos()` / `toLonLat()` in `web/map.js`): RADOLAN's polar-stereographic grid (standard parallel 60°N, reference meridian 10°E, Earth radius 6370.040 km) projects to a near-perfect axis-aligned 900×900 km square.
- `/api/radar` returns `{width, height, timestamp, frames}` (503 if no frame has loaded yet), where `frames` lists the timestamps of every composite held, oldest first; `/api/radar/grid` returns the newest one's raw `Uint8Array` as `application/octet-stream`, and `/api/radar/grid?t=<timestamp>` a specific past one (cacheable, since a past composite never changes; 404 if it has dropped out of the two-hour window). gzip shrinks a mostly-empty grid from 810,000 bytes to a few KB.
- **Public location / privacy**: auto-centering the radar on "home" would conflict with the hard constraint that the public API never exposes coordinates (see below), so there is a separate, admin-opt-in `station.publicLocation` (`{lat, lon}`, rounded to 0.1° / ~10 km both in the admin UI and again server-side in `admin.js`'s `saveSettings` as defense in depth) — kept entirely distinct from `station.latitude`/`longitude`, which remain server-side-only and are never sent to the browser. Picked via `locationPicker()` in `web/pickers.js`, which snaps to the same 0.1° cells the server rounds to. If unset, the radar just opens showing all of Germany.
- **Known gap**: wind isn't implemented. DWD doesn't have a "wind radar" product — radar detects precipitation, not wind — so a wind layer would need an entirely different, much larger data source (e.g. ICON-D2 GRIB2 model output), deliberately scoped out.

### Caching (`makeCache` in `util.js`: TTL + in-flight dedupe + serve-stale-on-error)

| What | TTL |
|---|---|
| `/api/current` | `cache.live_seconds` (15 s) |
| `dayRaw`: raw HA history, last 25 h, all sensors | ≤ 60 s |
| history `day` | 60 s |
| history `week`/`month`/`year` | `cache.history_seconds` (300 s) |
| `dailyStats`: daily LTS since `station.since` | `cache.records_seconds` (3600 s) |
| records / detail | 60 s |

### History bucketing

| Range | Source | Line metrics | Rain | Lightning |
|---|---|---|---|---|
| `day` | raw history | 10-min mean | 30-min sums | hourly counts |
| `week` | hourly statistics | 168 points | hourly | hourly |
| `month` | daily statistics | 30 points | daily | daily |
| `year` | daily statistics | 365 points | daily | daily |

The Now landscape uses the `day` history of temp, hum, wind, rain, press, solar and light. The pressure trend is the current value minus the value 3 h ago (`pressureTrend`, computed on the server); the Now view calls it steady within ±0.3 hPa, otherwise rising or falling.

`_rangeStats` returns stat objects `{ k: key, v: value, kind }`. `kind` (`metric | rain | count | km | rate | time | rainDay | strikes`) tells the frontend how to format the value (`statValue()` in `web/history.js`); `k` is translated as `stat.<k>`.

**CSV export** (`exportCsv()` in `web/history.js`): client-side only, no server endpoint — builds a CSV from the already-fetched points for the metric/range on screen, in the visitor's current unit, with a UTF-8 BOM, separators and number/date format per language (see "Languages"), and downloads it via a `Blob` + temporary `<a download>`.

### Alerts (`alerts.js`)

- Rules come from config `alerts:`. Each rule has `all:` or `any:` conditions. A condition has `sensor:` (a sensor key, compared in canonical units) or `entity:` (a raw HA entity), plus a comparison `above | below | at_least | at_most | equals` and an optional `recent: { sensor|entity, minutes }`. `recent` uses the timestamp in the entity's state if there is one, otherwise its `lc`.
- Message templates: `{sensor_key}`, `{sensor_key|time}`, `{sensor_key|compass}`, `{sensor.raw_entity_id}`; filled in once per language (see "Languages").
- A rule clears only after its conditions have been false for `alert_settings.clear_after_minutes`.
- Evaluation is debounced 2 s after updates, and also runs every 30 s.
- The log is persisted to `DATA_DIR/alerts.json` (max 200 entries). If the file isn't writable it logs a warning and keeps the log in memory.
- If `alerts:` is omitted, `DEFAULT_ALERTS` applies: lightning < 15 km within 30 min, frost, gust > 60 km/h, rain rate > 10 mm/h, UV ≥ 6. `alerts: []` disables all alerts.

### Admin (`admin.js`)

- `AdminStore` persists `DATA_DIR/admin.json`: username, scrypt password hash + salt, `mustChangePassword`, a session-signing secret, and the admin-settable `settings` (HA url/token, data source, Ecowitt host, sensor entity IDs, forecast entity/DWD station id/bias hours/label, alert rules, station info + devices). Unlike `alerts.js`, a failed write here **blocks** the action (password change / settings save respond with an error) instead of silently continuing in memory — losing this file is a real security footgun (reverts to `admin`/`admin`), not just a minor UX gap. A `design` key left in it from before v2.0.0 is ignored.
- **Precedence**: `config.yaml` always wins, per field. `index.js` computes a `locked` map right after `loadConfig()` (which fields `config.yaml` already set) and merges in `AdminStore`'s settings only for the fields it left blank, before `source`/`dwd` are constructed — so `ha.js`/`dwd.js`/`service.js` need no changes, they just see the final merged `cfg`. `saveSettings()` ignores any field the `locked` map marks, server-side, not just in the UI.
  - `alerts` and the station scalar fields (`name`/`subtitle`/`altitude_m`/`since`) need `config.js` to expose *whether config.yaml explicitly set them* (`cfg._locked`, computed in `loadConfig()`) — these already have config.js-applied defaults (`DEFAULT_ALERTS`, `'Weather Station'`, …) by the time `index.js` would otherwise check truthiness. `station.devices` doesn't need this — an empty array unambiguously means config.yaml set none.
  - `homeassistant.url`/`token` and `ecowitt.host` can also be locked by an environment variable (`HA_URL`/`HA_TOKEN`/`ECOWITT_HOST`); `cfg._locked.haUrlEnv`/`haTokenEnv`/`ecowittHostEnv` record which, so the admin page's lock note can name the right cause.
  - `alerts` is all-or-nothing, not per-field: a config.yaml `alerts:` key (including an explicit `alerts: []`) locks the whole list; otherwise the admin's array (or `null`, meaning "use `DEFAULT_ALERTS`") fully replaces it, never merges rule-by-rule. Same for `station.devices`.
  - Rule validation (`all`/`any` required, each condition needs `sensor` or `entity`, id/label/description/level defaulting) is `config.js`'s exported `normalizeAlerts()`, called from both `loadConfig()` (YAML path) and `saveSettings()` (admin-UI path, wrapped in try/catch so a bad rule becomes a `400` with the validation message instead of corrupting `admin.json` or crashing a later boot). Text lengths are checked in `tooLongError()` (`TEXT_LIMITS`, mirrored by `LIMITS` in `web/admin.js`).
- `source` (`homeassistant`/`ecowitt`) and `ecowitt.host` are admin-settable. Unset, `index.js` picks Home Assistant if URL+token exist, else Ecowitt if a host exists – existing setups never change behaviour.
- If, after that merge, the chosen source is still unconfigured anywhere, `index.js` forces demo mode with a warning instead of crashing — `config.js` doesn't throw on a missing HA url/token, specifically so the admin page stays reachable to fix it. The resulting `needsSetup` flag (`/api/config`) is true exactly in that forced-fallback case — not for a deliberate `server.demo: true` with a source also configured — so the frontend can send first-time visitors to `#/admin` without ever redirecting a deployment that's configured via config.yaml and doesn't use the admin page.
- Sessions are an HMAC-SHA256-signed cookie (`node:crypto`, zero new dependencies) over an expiry timestamp, verified with `timingSafeEqual`; a simple in-memory per-IP backoff throttles repeated failed logins/password attempts. There's no per-session store, so revocation works by rotating the shared `sessionSecret` (invalidating every outstanding token at once) — `changePassword()` does this and re-issues a fresh cookie for the caller so they stay signed in, and `logout()` does the same without re-issuing one.
- Settings changes only take effect at boot (same as `config.yaml`), so a successful `POST /api/admin/settings` responds first, then the process exits after a short delay, relying on the container's restart policy to reload with the new settings — password changes don't restart anything. The admin page waits for the server to come back and reloads.
- Every `/api/admin/*` route except `/login` and `/session` requires a valid session; every one except `/password` additionally requires `mustChangePassword` to already be false — enforced server-side (`requireSession` in `index.js`), not just hidden in the UI.
- **Two-factor authentication** (`totp.js` + `AdminStore`'s `totp` state): optional, off by default, a hand-rolled RFC 6238 TOTP implementation on `node:crypto` only (base32, HOTP, verify with ±1 step clock-drift tolerance) — no new dependency, no QR code (the admin page shows the secret as text plus a tappable `otpauth://` link instead). `totp.test.js` checks it against RFC 6238's own published test vectors.
  - `beginTotpSetup()` keeps the new secret **in memory only** (`AdminStore._pendingTotpSecret`) until `confirmTotpSetup()` receives a valid code against it — a secret nobody has saved in an app never reaches disk.
  - `verifyLogin(ip, username, password, code)` re-verifies the password every time rather than issuing a partial "awaiting 2FA" session: if `totp.enabled` and `code` is missing, it returns `{ok:false, needsTotp:true}` (answered with `200`, not `401`, since the password was right); a wrong code *is* a rate-limited failure (`401`, same throttle as password guesses). The admin page resubmits username+password+code together.
  - `disableTotp()` requires the current password, not a code — the way back in if you've lost the authenticator but still have the password; if you've lost both, see the README's "Forgot the admin password?" (delete `admin.json`).

### API

Everything under `/api/*` except `/api/admin/*` is GET-only (anything else returns 405):

| Endpoint | Returns |
|---|---|
| `/api/config` | public config: station, devices, timezone, available metrics/sensors, alert rule labels, ui, needsSetup |
| `/api/current` | values, today min/max, rain totals, pressureTrend, spark, forecast, astro, devices, active alerts |
| `/api/history?metric=&range=` | `{ metric, range, agg, points: [{t, v, lo?, hi?}], stats }` |
| `/api/detail?metric=` | `{ today: Stat[], record, device }` |
| `/api/records` | all-time records per metric, plus this month |
| `/api/radar` | `{ width, height, timestamp, frames }` for the rain radar (503 if none loaded yet) |
| `/api/radar/grid` | raw `Uint8Array` intensity grid (`application/octet-stream`), pairs with `/api/radar`; `?t=` for a past frame |
| `/api/alerts` | `{ rules, log }` |
| `/api/forecast/hourly` | `{ source, synthetic, hours: [{t, temp, conditionCode, pop, rain, wind, gust, sunMin, cloud}] }` for the next 72 hours |
| `/healthz` | `{ ok, connected, lastMessage }` |

Alert texts in `/api/config`, `/api/current` and `/api/alerts` (`label`, `description`, `banner`, `message`, a log entry's `title` and `text`) are a string or an `{ en, de }` object (see "Languages").

`/api/admin/*` (see above) is the one authenticated, non-read-only surface:
`POST /login`, `POST /logout`, `GET /session`, `POST /password`, `GET`/`POST /settings`, `GET /entities` (HA's sensors with `suggestions` per sensor key, ranked by `entities.js`; `available: false` for the Ecowitt source or while HA is disconnected), `POST /totp/setup`, `POST /totp/enable`, `POST /totp/disable`.

The frontend is the API's only client in this repo and reads the responses directly; there are no shared types. Any change to an API response shape must be checked against every `web/*.js` module that reads it.

## Frontend (`web/`)

Plain HTML, CSS and ES modules, loaded by the browser as they are: no build step, no bundler, no framework, no dependencies, no type checker. Check changes with `node --check` and in a browser.

- **Serving** (`index.js`): the static root is `server.public_dir` (`PUBLIC_DIR`; `/app/public` in the image, `web/` in a checkout), with an SPA fallback to `index.html`. When serving `index.html` and `manifest.webmanifest`, `withStationName()` replaces the "Weather Station" placeholder with `station.name` (HTML-escaped) in `<title>`, `apple-mobile-web-app-title`, the header's `#stationName` and the manifest's `name`/`short_name`, so the tab and a home-screen app carry the name before any script runs. `/himmel` and `/himmel/…` (the old preview address) redirect to `/`.
- **Modules**: `index.html` loads `app.js` (the Now view, which also loads `/api/config` and polls `/api/current`) and `main.js` (routing; imports the other views). Shared state between views is `store` in `lib.js` (`cfg`, `cur`), with a `station` event when `/api/current` arrives; `stationReady()` waits for the first one. Views export `enter(params)` and optionally `leave()`.
- **Routing**: hash routes `#/` (Now), `#/history?m=<metric>&r=<day|week|month|year>`, `#/forecast`, `#/radar`, `#/alerts`, `#/settings`, `#/admin`. The German addresses from before v2.0.0 (`#/verlauf`, `#/vorhersage`, `#/regenradar`, `#/warnungen`, `#/einstellungen`, `#/verwaltung`) and the old `#/details/<metric>` still lead to their view (`OLD_ADDRESSES` in `main.js`). `?kiosk=1` (query string) shows only the Now view without navigation; tapping the station name toggles fullscreen. If `cfg.needsSetup`, a visit to Now redirects once to `#/admin`.
- **Data**: `app.js` polls `/api/current` every `ui.refresh_seconds` and the day history every 5 minutes; other views fetch when entered. The status in the header is "Live" with the time of the last reading, turns amber and says "Stale" when that reading is older than `ui.stale_after_seconds` (`updated` is the max `lu` of the configured sensors, which only changes when a value changes, so on calm nights use 300 s or more), and says there is no connection when the request fails.
- **Colours come from the sun**: `skyAt()` in `lib.js` maps the sun's height (from `/api/current`'s `astro`) to sky (`--zenith`, horizon) and ground (`--ground`) colours through five keyframes, greyed on overcast days. The Now landscape, the charts, the maps and the page background all use it, and the browser bar follows (`syncBarColour()`). The single accent is `--sun` (#ffcf5c): alerts, the primary button, the focus ring, the compass needle.
- **Typeface**: Bricolage Grotesque (variable weight and width), self-hosted in `web/fonts/` with its licence, so the CSP's `font-src 'self'` holds. Numbers use the width axis (condensed) and `tabular-nums`.
- **Charts and maps** are drawn on `<canvas>` (`fitCanvas()` sizes them for the device pixel ratio). Scrubbing goes through `scrub()` in `lib.js`: a mouse drags at once; a finger has to move sideways first, so vertical swipes still scroll the page (`touch-action: pan-y`). Charts are also keyboard-operable (arrow keys, Home/End) and announce the value under the cursor via `aria-valuetext`.
- **Formatting and text**: always through `i18n.js`/`lib.js` (see "Languages"); a value and its unit are written with a space, temperatures as `14.3°` (only Fahrenheit names its scale), a missing value as `–`.
- **Installable as a home-screen app**: `apple-mobile-web-app-capable`/`mobile-web-app-capable`, `black-translucent` status bar, `manifest.webmanifest` with the icons. On the Now view `html` takes the sky colour so the strip behind the status bar matches (Safari 26). A device that added the icon before a change of name or icon has to remove and re-add it.
- **Accessibility and preferences** (`styles.css`): a 3 px `--sun` focus ring on every control; `prefers-reduced-motion` drops the moving transitions and makes the cursor spring and map flights jump; `prefers-contrast: more` makes secondary text full strength and rules stronger; `prefers-reduced-transparency` replaces the blurred surfaces with solid ones; font sizes are in `rem`.

## Hard constraints – do not break

- **No secrets in the browser.** The public API never exposes the HA URL, token, coordinates or entity IDs. The one deliberate, narrow exception is the authenticated admin surface: `GET /api/admin/settings` still never echoes the real HA token back (only a `tokenSet` boolean). The other deliberate, narrow exception is `station.publicLocation` (see "Rain radar" above): an admin-opt-in, ~10 km-rounded approximate location, separate from `station.latitude`/`longitude`, which stay server-side-only as always.
- **Content-Security-Policy** (`index.js`) allows only `'self'` (plus inline styles and data: images). Don't add CDNs, Google Fonts, analytics or any external requests; bundle assets instead.
- **The public API stays read-only.** Everything under `/api/*` is GET-only except `/api/admin/*`, which is the one deliberate exception: authenticated (session cookie, enforced server-side), restart-required to take effect, and always overridden by anything already set in `config.yaml`. No other endpoint may change HA or the config.
- **Keep the dependency footprint small.** The server depends only on `yaml` and `suncalc`; the frontend has no dependencies at all. Discuss before adding any. (The rain radar's bz2 decompression shells out to the image's `bunzip2` binary instead of an npm package — see "Rain radar" above.)
- **Non-root container.** The image runs as `node` (UID 1000) and deployments may override this with `user:`, so code must never assume root or write anywhere except `DATA_DIR`.
- **Keep `DemoSource` in sync** with any change to the data-source interface; demo mode is the main way to test.
- **Port 47813** is the default everywhere: `config.js`, `Dockerfile`, compose, README. Change all of them together.
- **English everywhere except the two translation tables** (`web/i18n.js`, `server/src/i18n.js`), and every visible string in both languages.

## Configuration & environment

- Config file: `CONFIG_PATH` (default `/config/config.yaml`). It is optional: if it's missing, everything comes from the admin page, and the server never creates one. Demo mode is then not forced; the server falls back to **demo mode** (with a warning, not a crash) only while, after merging in any admin-set settings, the data source still isn't configured anywhere – so a source saved on the admin page switches to real data after the restart. Only `server.demo: true` or `DEMO=1` force demo mode.
- Environment overrides: `HA_URL`, `HA_TOKEN`, `ECOWITT_HOST`, `PORT`, `DEMO`, `DATA_DIR` (default `/data`), `PUBLIC_DIR` (default `/app/public` in the image, `web/` in a checkout), `TZ`.
- `config/config.example.yaml` is the single source of truth for options. When adding an option, update it, `config.js` and the README together. A `ui.design` left in a config from before v2.0.0 is ignored with a warning.
- `config/config.yaml` and `.env` are gitignored and must never be committed. `DATA_DIR/admin.json` (password hash, session secret, admin-set HA/sensor/DWD settings) is runtime state, same category as `DATA_DIR/alerts.json` — never committed either, and never seed it by hand.

## Maintainer's deployment (for context)

- TrueNAS SCALE, installed via "Install via YAML" (Docker Compose) using the GHCR image.
- Host path `/mnt/docker/wetterstation/{config,data}`, container run with `user: "950:950"` to match the folder owner.
- Ecowitt pushes to HA every 60 s; recommended `ui.refresh_seconds: 30` and `stale_after_seconds: 300`.
- Update: pull the new image, then redeploy or recreate the container. Pulling alone doesn't replace the running container.

## Known gaps / ideas backlog

- Alert rules written by an admin or in config.yaml as plain strings are shown as written in every language; only rules with per-language texts (`{ en, de }`, like the built-in ones) follow the visitor's language. Editing a built-in rule on the admin page turns it into plain strings in the admin's language.
- The UI has two languages. Adding a third means a new table in `web/i18n.js`, a `LANGS`/`LOCALES` entry and the default-alert texts in `server/src/i18n.js`, and `COMPASS_POINTS` for it.
- The History page's "today" min/max comes from cached raw history (≤ 60 s old).
- Alert messages use canonical units, not the visitor's units.
- Lightning distance is always shown in km (no miles option).
- Test coverage is deliberately narrow (pure server logic via `node:test`) — the HTTP layer, `dwd.js` and the whole frontend remain untested; verify them in demo mode.
- `dwd.js`'s `ww` → condition mapping is an approximate grouping of DWD's documented code ranges, not an exact WMO table lookup; edge codes fall into the nearest sensible bucket.
- DWD's `R101` (precipitation probability) drives `pop` for the DWD forecast path; if a future MOSMIX revision renames/drops that element, `pop` silently falls back to `null` (the frontend shows `–`).
- `station.devices[].signal` is shown as `n of 4` (Ecowitt convention).
- Rain radar has no wind layer (see "Rain radar") and no forecast frames: DWD's nowcast (RADVOR "RV") comes on a different, larger grid in a tar archive, so it isn't a drop-in addition to the RY loop. `radar.test.js` covers frame-stamp parsing and the directory-listing selection, `radolan.test.js` the decoding; no test covers the bz2 fetch/shell-out path.
- The admin username is fixed as `admin` (no UI to change it, only the password). There's also no live reconnect: any settings save restarts the whole process, same as editing `config.yaml` would.
- 2FA is TOTP-only (no backup/recovery codes, no WebAuthn/passkeys) and single-admin by design.
- In demo mode with no `config.yaml` sensors and nothing saved via the admin page, `cfg.sensors` gets filled with `DEMO_SENSORS` only if it was completely empty beforehand — so saving even one sensor via the admin page while otherwise relying on demo mode leaves the rest of `DEMO_SENSORS` unfilled. Not an issue outside of demo mode.
- Per-IP login/password-change throttling uses `req.socket.remoteAddress`, which is the proxy's address, not the real client's, behind a reverse proxy — it still throttles, just coarser.
