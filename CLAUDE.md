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

- [SemVer](https://semver.org), one version for the whole project. The tag is the source of truth; `server/package.json` and `web/package.json` carry the same version and are bumped at each production release.
- Pick the next version from the changes since the last production release:
  - **MAJOR**: breaking change for deployments (renamed/removed config keys or env vars, changed port, changed volume layout, API response changes that break consumers).
  - **MINOR**: new feature, screen, metric, config option or alert capability.
  - **PATCH**: bug fixes, styling, docs, dependency bumps.
- Dev versions are pre-releases of the *upcoming* production version: `v1.1.0-dev.1`, `v1.1.0-dev.2`, … If a later merge raises the bump level (e.g. a feature lands after only fixes), continue with the higher target: `v1.0.1-dev.2` → `v1.1.0-dev.1`.
- Baseline: the state of `main` before this workflow was introduced is `v1.0.0`.

### Merging into `dev` (every merge)

1. Branch from the latest `dev`: `feature/<short-name>` or `fix/<short-name>`.
2. Before opening the PR: `cd web && npm run build` must pass and the change must be checked in demo mode.
3. Open a PR into `dev`, then merge it (squash merge, PR title becomes the commit message).
4. Tag the merge commit with the next dev version and push the tag: `git tag -a v1.1.0-dev.3 -m "v1.1.0-dev.3" && git push origin v1.1.0-dev.3`.
5. Create a GitHub **pre-release** with release notes for just this merge: `gh release create v1.1.0-dev.3 --prerelease --target dev --title "v1.1.0-dev.3" --notes-file <file>`.

The `v*` tag makes CI build and publish the image as `ghcr.io/0xvisualiris/ecowitt-weather-dashboard:1.1.0-dev.3`, which can be deployed for testing without touching `latest`. Every push to `dev` also updates the moving `:dev` image tag, so a test container can simply track `:dev`.

### Releasing to production (`dev` → `main`)

Only when the user asks for a production release.

1. Create `release/vX.Y.Z` from `dev`. Bump `version` in `server/package.json` and `web/package.json` (and their lockfiles) with `npm version <x.y.z> --no-git-tag-version`; npm reformats `"engines"` in `server/package.json`, so restore the one-line form.
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

## What this is

A public, read-only web dashboard for a personal weather station whose data lives in **Home Assistant** (HA). One Docker container serves a static React frontend plus a small Node API. The backend holds the HA URL and token; the browser never sees them, nor coordinates or entity IDs.

- Hardware it was built for: Ecowitt WH90 (temp, humidity, ultrasonic wind, piezo rain, solar/UV), Ecowitt WH57 (lightning) and an Ecowitt gateway (pressure), via the HA Ecowitt integration. Any HA sensors work.
- Hobby project, vibe-coded with AI, not actively maintained. Keep changes simple and dependency-light.
- Repo: `0xvisualiris/ecowitt-weather-dashboard`. Image: `ghcr.io/0xvisualiris/ecowitt-weather-dashboard:latest`.
- **UI supports German and English**, switchable per visitor (`web/src/i18n.ts`). Code, comments and docs are in English.

## Repository layout

```
Dockerfile                  multi-stage build (web → server deps → runtime), node:22-alpine
docker-compose.yml          local build + run
.github/workflows/docker-publish.yml   builds amd64+arm64 image, pushes to GHCR on push to main / v* tags
config/config.example.yaml  fully commented example config (the reference for all options)
server/                     Node 22 backend, ESM, plain JS, no framework
  src/index.js              HTTP server, routes, static files + SPA fallback, security headers, gzip
  src/config.js             loads YAML, ${ENV} substitution, defaults, validation, SENSOR_KEYS, DEFAULT_ALERTS
  src/ha.js                 HomeAssistantSource: HA WebSocket client
  src/demo.js               DemoSource: synthetic data, same interface as HomeAssistantSource
  src/dwd.js                DwdForecast: fetches/parses a DWD MOSMIX_L station KMZ, bias-corrects near-term with the live reading
  src/radolan.js            decodeRadolan: parses a DWD RADOLAN composite (ASCII header + binary uint16 grid) into {width,height,grid}
  src/radar.js               RadarSource: fetches+bunzip2s+decodes the DWD RY rain radar composite every 5 min, keeps the latest frame in memory
  src/service.js            WeatherService: all data shaping (current, history, records, detail) + METRICS
  src/alerts.js             AlertEngine: evaluates alert rules, persists log to DATA_DIR/alerts.json
  src/admin.js              AdminStore: login/session/password hashing, optional TOTP 2FA, persists DATA_DIR/admin.json, admin-settable HA/sensor/DWD settings
  src/totp.js               RFC 6238 TOTP (base32, HOTP, verify) on node:crypto only, no new dependency
  src/units.js              unit normalisation to canonical units, compass, German number format
  src/astro.js              sunrise/sunset/day length/sun position/moon via suncalc
  src/util.js               local-time helpers, TTL cache, counter→increment conversion, time-bucketing (bucketLine/bucketCounter), round()
web/                        Vite + React 19 + TypeScript, no UI framework, no chart library
  index.html                favicon link (/favicon.svg – add ?v=N to bust browser favicon cache)
  public/favicon.svg        app icon (also used in README); apple-touch-icon.png/icon-192.png/icon-512.png are PNG renders of it for manifest.webmanifest/iOS homescreen (regenerate by rendering favicon.svg at those sizes, e.g. via a headless browser, if the icon ever changes)
  public/manifest.webmanifest  installable-PWA manifest (name, icons, standalone display, theme/background color)
  public/dwd-stations.json  static DWD station picker data (simplified DE border + ~600 station id/name/lat/lon) — see "Forecast" below for how to regenerate it
  src/main.tsx              entry
  src/App.tsx               shell: hash router, header (live dot, clock), nav, footer, units + lang context, AdminGate
  src/lib.ts                types, useApi/postJson, units + conversion, METRIC_META, locale-aware formatting, SVG path helpers
  src/i18n.ts                German/English string dictionary, LANG/setLang/t(), LangContext, translateApiError()
  src/styles.css            design tokens + all styles (CSS classes, no CSS-in-JS)
  src/components/Chart.tsx  Chart (hover crosshair/tooltip) and Spark (sparklines)
  src/components/ConditionIcon.tsx  small hand-drawn forecast-condition icons, keyed by conditionCode
  src/components/DwdStationMap.tsx  admin-only DWD station picker: hand-drawn SVG map + search, reads public/dwd-stations.json
  src/components/germanyOutline.ts  useGermanyOutline() hook + makeOutlineProjection(), factored out of DwdStationMap.tsx, reused by PublicLocationPicker
  src/components/PublicLocationPicker.tsx  admin-only click-to-pick map for the rain radar's approximate public home location
  src/radolanProjection.ts  lonLatToRadolanPixel(): the RADOLAN polar-stereographic projection, lon/lat → grid pixel
  src/screens/              Dashboard, History, Detail, Radar, Alerts, Settings, AdminLogin, AdminPassword, Admin
```

## Commands

```bash
# Backend in demo mode (no HA needed), port 47813
cd server && npm install && DEMO=1 npm run dev
#   PowerShell: $env:DEMO=1; npm run dev

# Backend against a real HA instance
cd server && CONFIG_PATH=../config/config.yaml HA_TOKEN=... npm run dev

# Frontend dev server with HMR; proxies /api → http://localhost:47813
cd web && npm install && npm run dev

# Type-check + production build of the frontend (output: web/dist)
cd web && npm run build

# Run the backend test suite (util.js, units.js, alerts.js, totp.js, radolan.js)
cd server && npm test

# Run backend serving the built frontend
cd server && DEMO=1 PUBLIC_DIR=../web/dist node src/index.js

# Container
docker compose up -d --build
```

There's **no linter config**, and only a small, deliberately-scoped test suite — `cd server && npm test` (Node's built-in `node:test`, zero dependencies) covers the pure-logic hot spots (`util.js`, `units.js`, `alerts.js`'s condition/message/evaluate logic, `totp.js` against RFC 6238's own test vectors, `radolan.js`'s header/grid decoding against synthetic fixtures), not the HTTP layer or React components. Verify everything else by running in demo mode and checking `/api/*` with curl plus the UI in a browser. `npx tsc -b` in `web/` must pass (strict mode, `noUnusedLocals`).

**Every push to `main` publishes a new `latest` image to GHCR**, so merging to `main` is a production release. Follow the release process above.

## Architecture & data flow

```
Ecowitt → HA (Ecowitt integration, ~60 s) → HA WebSocket push → server (in-memory states)
browser polls /api/current every ui.refresh_seconds; charts fetch /api/history etc.
forecast: DWD MOSMIX_L KMZ (opendata.dwd.de, hourly poll) + live reading → bias-corrected daily forecast
          (falls back to the HA weather.* entity if dwd_station_id isn't set or DWD is unreachable)
rain radar: DWD RADOLAN RY composite (opendata.dwd.de, 5-min poll, bz2 → bunzip2 → binary grid) → /api/radar + /api/radar/grid
```

### Data source interface (`ha.js` and `demo.js` must stay compatible)

- `start()`; `connected` (bool); `lastMessage` (ms)
- `states`: `{ entity_id: { state, attributes, lu, lc } }`, with `lu`/`lc` (last updated/changed) in **milliseconds**
- `forecast`: array of HA daily forecast objects or `null`
- `location()` → `{ latitude, longitude, time_zone }`
- `history(entityIds, start, end)` → `{ entity_id: [{ t: ms, s: state }] }`
- `statistics(ids, start, end, period)` → `{ entity_id: [{ start: ms, mean, min, max, change, state }] }`, where `period` is `hour`, `day` or `month`
- Events: `update`, `status`, `config` (HA `get_config`), `forecast`

HA calls used: `auth`, `get_config`, `subscribe_entities` (compressed diffs `a`/`c`/`r`), `weather/subscribe_forecast` (daily), `history/history_during_period` (`minimal_response`, `no_attributes`), `recorder/statistics_during_period`. Reconnects with exponential backoff (max 60 s).

### Sensors and metrics

- Config `sensors:` maps fixed **sensor keys** (see `SENSOR_KEYS` in `config.js`) to HA entity IDs: `temperature, feels_like, dew_point, humidity, wind_speed, wind_gust, wind_direction, rain_rate, rain_event, rain_daily, rain_weekly, rain_monthly, rain_yearly, pressure, solar_radiation, uv_index, lightning_distance, lightning_time, lightning_count`. Missing keys are allowed, and the UI hides the matching cards.
- `METRICS` in `service.js` defines the 8 UI metrics: `temp, hum, wind, rain, press, solar, uv, light`. Each has a `sensor`, an `agg` (`mean` or `counter`) and optional `recordSensor` (wind records use the gust sensor) or `currentSensor` (light: the current value is the distance; the chart shows strike counts).
- `rain_daily` and `lightning_count` are **daily-reset counters**. Amounts come from `counterIncrements()`, which treats any drop as a reset; for statistics it prefers HA's `change` and falls back to `state`/`max`.
- If `rain_weekly`/`monthly`/`yearly` are missing, they are computed from daily statistics plus today's value.

### Units

The server normalises everything to canonical units in `units.js`: **°C, km/h, hPa, mm, mm/h, km**, based on each entity's `unit_of_measurement`. The browser converts to the visitor's units (`convFor` / `metricConv` in `lib.ts`), which are stored in `localStorage` key `wetterstation.units`. Defaults come from `ui.default_units`.

Never convert units anywhere else. Exception: alert messages are formatted server-side in canonical units.

### Time zone

`process.env.TZ` is set at startup from `station.timezone`, otherwise from HA's `get_config.time_zone`, so plain `Date` methods in the server use station time. The frontend formats every date and time with the station time zone from `/api/config` (`setTimeZone`, `parts()` in `lib.ts`).

### Language (`web/src/i18n.ts`)

- German and English, chosen per visitor and persisted to `localStorage` key `wetterstation.lang` (default `de`). Covers the entire frontend, including the admin screens.
- `LANG` is a module-level mutable variable (`setLang()`), read synchronously by `t(key, vars?)` and by `lib.ts`'s locale-aware formatting functions (`fmt`, `hhmm`, `dateShort`, `dateFmt`, `parts`, `longDate`, `compass`, `uvLabel`, `trendText`, `fmtStat`) — the same pattern already used for time zone (`TZ`/`setTimeZone`). No component needs to subscribe to a context just to call `t()`: `App.tsx`'s `Loaded()` calls `setLang()` once per render before any child renders (same spot as `setTimeZone(cfg.timezone)`), and since nothing downstream is `React.memo`-wrapped, a language change re-renders the whole subtree.
- `LangContext`/`useLang()` exist only so the visible switcher (in `Settings.tsx` for visitors, in `Admin.tsx`'s header for the admin) can call `setLang` without prop-drilling. `LangContext.Provider` wraps *both* branches of `Loaded()` — the admin branch and the visitor branch — unlike `UnitsContext`, which is scoped to the visitor branch only (units are irrelevant to admin screens).
- Three kinds of string, three different treatments:
  - **Static UI chrome** (labels, buttons, headings): a flat dictionary in `i18n.ts`, looked up via `t('namespaced.key', vars?)`. `METRIC_META`'s per-metric labels and `UNIT_OPTIONS`'s group labels are dictionary keys too (`metricLabel()`, and `UNIT_OPTIONS()` is a function, not a static array, since both must re-evaluate per render rather than freeze whatever `LANG` was at module load).
  - **Small enum-like labels emitted by the server** on a shared, cached response (`service.js`'s stat-row `k` slugs, forecast `conditionCode`, `astro.js`'s moon-phase slug): the server sends a stable English slug, never localized text, and the frontend translates it (`statLabel()`, `cond.*`, `moon.*` keys) — safe because a slug carries no language, so the cache stays valid for every visitor regardless of their choice. `service.js`'s `devices()` similarly sends a raw `{value, unit}` reading instead of a pre-formatted string, formatted client-side via `fmtDeviceReading()`/`fmtSignal()`, for the same reason.
  - **Free text** (alert rule label/description/message/banner, whether `DEFAULT_ALERTS` or admin/config-authored): never translated — see "Alerts" below and the Known-gaps note.
- Admin API error messages (`admin.js`'s `{error}` strings) are a small, stable, already-English set — `translateApiError()` in `i18n.ts` pattern-matches them to a translated string rather than the backend emitting error codes, since that set essentially never changes.

### Forecast (`dwd.js`)

- **Picking a station** (`Admin.tsx`'s "Auf Karte auswählen" / `DwdStationMap.tsx`): a hand-drawn, pannable/zoomable SVG map (no mapping library, no map-tile requests — same dependency-light/no-external-request convention as `Chart.tsx`/`ConditionIcon.tsx`) over `public/dwd-stations.json`, fetched lazily only when the picker is opened. Pan/zoom works by moving and scaling the SVG's own `viewBox` (wheel to zoom toward the cursor, drag to pan, a reset-view button once zoomed) — since it's vector, not raster, it stays crisp at any zoom, unlike the radar screen's canvas. That file is static, generated once (not fetched live, and not regenerated automatically by any build step) from DWD's own MOSMIX station catalogue (`mosmix_stationskatalog.cfg` under `dwd.de/DE/leistungen/met_verfahren_mosmix/`, not `opendata.dwd.de` — that catalogue is the full worldwide list, several thousand stations including many without real MOSMIX_L output). It's filtered to **numeric-only station IDs** (DWD's real synoptic network — the alphanumeric IDs in the same catalogue are climate/precipitation-only stations without reliable MOSMIX_L forecasts) and then to stations **within 50 km of the simplified Germany border** (straight-line point-to-polygon distance, not a lon/lat bounding box — a box large enough to reach Germany's actual corners pulls in stations from most of Central Europe, up to ~360 km from the border; a border-distance filter keeps only genuinely nearby cross-border stations), giving ~370 stations. The simplified Germany border in the same file is a Douglas-Peucker-simplified (~200 points, down from ~1600) public-domain country outline, projected the same equirectangular-with-cos(lat)-correction way the component re-derives station dot positions from lat/lon at render time. To regenerate either piece (DWD republishes an updated catalogue occasionally; the border practically never needs it), re-fetch the catalogue/outline, re-run the same numeric-ID filter + border-distance filter + Douglas-Peucker simplification, and overwrite `public/dwd-stations.json` — there's no script checked in for this, it was a one-off data-processing pass.
- `WeatherService.forecast()` tries `DwdForecast.days()` first (when `forecast.dwd_station_id` is configured); if that returns nothing it falls back to the original HA `weather.*`-entity logic (`src.forecast`, populated via `weather/subscribe_forecast` in `ha.js`) unchanged.
- `DwdForecast` fetches `MOSMIX_L_LATEST_<station_id>.kmz` from `opendata.dwd.de` hourly (background `setInterval`, not awaited by `service.js`— same "populate a field, read synchronously" pattern as `ha.js`'s `forecast`/`states`). A KMZ's one entry is read via the zip central-directory record (DWD leaves the local header's size fields at 0) and inflated with Node's built-in `zlib`; the XML is parsed with a couple of targeted regexes (`TimeStep`, `TTT`, `ww`, `R101`), not a general XML library — no new dependency.
- `ww` (DWD's significant-weather code) maps to the same condition vocabulary HA emits (`sunny`, `rainy`, `lightning-rainy`, …) via `conditionCode`; the frontend translates that slug itself (`i18n.ts`'s `cond.*` keys) rather than the server sending localized condition text. A day's representative condition is its hourly rows' most severe `ww`; same-severity ties prefer a daytime hour (so a calm clear day reads as sunny, not merely clear).
- Bias correction: the offset between the live reading and DWD's own value for "now" is applied to the next `forecast.bias_hours` (default 6) of hourly temps, fading to 0 — only the near-term trajectory is nudged; day 2+ stays unmodified MOSMIX. `pop`/condition are never bias-corrected.
- On fetch/parse failure, a warning is logged and the last good result keeps being served (nothing overwrites `DwdForecast.hourly` on failure).

### Rain radar (`radolan.js`, `radar.js`, `web/src/screens/Radar.tsx`)

- **Data**: DWD's RADOLAN RY composite — a national 900×900 km rain-rate grid (1 km/px, polar-stereographic projection), updated every 5 minutes. `RadarSource` fetches `raa01-ry_10000-latest-dwd---bin.bz2` from `opendata.dwd.de` on the same "background interval, populate a field, read synchronously" pattern as `DwdForecast`/`ha.js` — nothing in `service.js` or `index.js` awaits the fetch.
- **Decompression**: DWD only publishes RADOLAN as bz2, and Node has no built-in bzip2 support. Rather than add an npm dependency, `radar.js`'s `bunzip2()` shells out to the system `bunzip2` binary (`child_process.spawn('bunzip2', ['-c'])`, piping the compressed bytes to stdin and collecting stdout) — the Dockerfile installs it (`apk add --no-cache bzip2`, alongside the existing `tzdata`).
- **Decoding** (`radolan.js`'s `decodeRadolan`): a RADOLAN file is an ASCII header (`key=value` fields — `GP` grid dimensions, `PR` precision exponent, `MS` contributing station list, a `DDHHMM` timestamp) terminated by an ETX (0x03) byte, followed by a raw grid of little-endian uint16 values, one per cell. The low 12 bits are the masked value; DWD's fixed sentinel `2500` means "no data". `decodeRadolan` returns `{width, height, timestamp, grid}` where `grid` is a `Uint8Array` with one display-intensity byte per cell (255 = no data, 0 = no rain, 1–254 = `round(mm * 20)` clamped — a display class, not raw mm) rather than the raw uint16s, to keep `/api/radar/grid`'s payload and gzip-compressed size small.
- **Projection** (`web/src/radolanProjection.ts`): RADOLAN's polar-stereographic grid (standard parallel 60°N, reference meridian 10°E, Earth radius 6370.040 km) projects to a near-perfect axis-aligned 900×900 km square. `lonLatToRadolanPixel(lon, lat)` implements DWD's documented formula; it was validated empirically (not just against the formula) by reprojecting this app's own already-verified Germany outline (`germanyOutline.ts`, shared with `DwdStationMap.tsx`) onto a rendered radar frame and confirming the outline traces neatly inside the rain-coverage mask, with the expected radar-range bulge past the political border.
- `/api/radar` returns `{width, height, timestamp}` (503 if no frame has loaded yet); `/api/radar/grid` returns the raw `Uint8Array` as `application/octet-stream` (gzip shrinks a mostly-empty grid from 810,000 to roughly 6.5 KB — `index.js`'s `send()` compressible-type check was widened to include `octet-stream`). The frontend fetches both in parallel and draws the grid into a `<canvas>` via `ImageData`/`putImageData` with a 6-stop color ramp, `image-rendering: pixelated` scaled by CSS percentages for pan/zoom (no re-render per frame) rather than a separate tile layer.
- **Public location / privacy**: auto-centering the radar on "home" would conflict with the hard constraint that the public API never exposes coordinates (see below), so there is a separate, admin-opt-in `station.publicLocation` (`{lat, lon}`, rounded to 0.1° / ~10 km both in the admin UI and again server-side in `admin.js`'s `saveSettings` as defense in depth) — architecturally and in code kept entirely distinct from `station.latitude`/`longitude`, which remain server-side-only and are never sent to the browser. Picked via `PublicLocationPicker.tsx` (click-on-map, reuses `germanyOutline.ts`'s `invert()`) on the admin page's Station section. If unset, the radar just opens showing all of Germany, unzoomed.
- **Known gap**: wind isn't implemented. DWD doesn't have a "wind radar" product — radar detects precipitation, not wind — so a wind layer would need an entirely different, much larger data source (e.g. ICON-D2 GRIB2 model output), deliberately scoped out of this feature.

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

Dashboard sparklines: temp, humidity and pressure in 15-minute buckets, rain in 30-minute buckets, lightning hourly, all over 24 h. The pressure trend is the current value minus the value 3 h ago; "steigend/fallend" uses a ±0.5 hPa threshold.

`_rangeStats` returns stat objects `{ k: label, v: value, kind }`. `kind` (`metric | rain | count | km | rate | time | rainDay | strikes`) tells the frontend how to format the value (`fmtStat` in `lib.ts`).

**CSV export** (`History.tsx`'s `buildCsv`/`downloadCsv`): client-side only, no server endpoint — builds a CSV string from the already-fetched `History.points` for whatever metric/range is currently on screen, in the visitor's currently selected unit (so the file always matches the chart), and triggers a download via a `Blob` + temporary `<a download>`. Semicolon-delimited with German comma-decimal numbers (`fmt()`) and a UTF-8 BOM prefix, so it opens correctly in a German-locale Excel/LibreOffice — consistent with the rest of the UI's formatting, not plain international CSV.

### Alerts (`alerts.js`)

- Rules come from config `alerts:`. Each rule has `all:` or `any:` conditions. A condition has `sensor:` (a sensor key, compared in canonical units) or `entity:` (a raw HA entity), plus a comparison `above | below | at_least | at_most | equals` and an optional `recent: { sensor|entity, minutes }`. `recent` uses the timestamp in the entity's state if there is one, otherwise its `lc`.
- Message templates: `{sensor_key}`, `{sensor_key|time}`, `{sensor_key|compass}`, `{sensor.raw_entity_id}`.
- A rule clears only after its conditions have been false for `alert_settings.clear_after_minutes`.
- Evaluation is debounced 2 s after updates, and also runs every 30 s.
- The log is persisted to `DATA_DIR/alerts.json` (max 200 entries). If the file isn't writable it logs a warning and keeps the log in memory.
- If `alerts:` is omitted, `DEFAULT_ALERTS` applies: lightning < 15 km within 30 min, frost, gust > 60 km/h, rain rate > 10 mm/h, UV ≥ 6. `alerts: []` disables all alerts.
- Rule content (`label`/`description`/`message`/`banner`) is never translated by the language switcher, default or admin/config-authored alike — it's free text, shown exactly as written. The `{sensor_key|time}` filter also always formats in `de-DE` (`alerts.js`), since a composed, persisted log entry has no per-visitor language to re-render in later.

### Admin (`admin.js`)

- `AdminStore` persists `DATA_DIR/admin.json`: username, scrypt password hash + salt, `mustChangePassword`, a session-signing secret, and the admin-settable `settings` (HA url/token, sensor entity IDs, forecast entity/DWD station id/bias hours/label, alert rules, station info + devices). Unlike `alerts.js`, a failed write here **blocks** the action (password change / settings save respond with an error) instead of silently continuing in memory — losing this file is a real security footgun (reverts to `admin`/`admin`), not just a minor UX gap.
- **Precedence**: `config.yaml` always wins, per field. `index.js` computes a `locked` map right after `loadConfig()` (which fields `config.yaml` already set) and merges in `AdminStore`'s settings only for the fields it left blank, before `source`/`dwd` are constructed — so `ha.js`/`dwd.js`/`service.js` need no changes, they just see the final merged `cfg`. `saveSettings()` ignores any field the `locked` map marks, server-side, not just in the UI.
  - `alerts` and the station scalar fields (`name`/`subtitle`/`altitude_m`/`since`) need `config.js` to expose *whether config.yaml explicitly set them* (`cfg._locked`, computed in `loadConfig()`) — unlike `homeassistant.url`, these already have config.js-applied defaults (`DEFAULT_ALERTS`, `'Wetterstation'`, …) by the time `index.js` would otherwise check truthiness, so a plain `!!cfg.X` can't tell "config.yaml set this" apart from "config.js defaulted it". `station.devices` doesn't need this — an empty array unambiguously means config.yaml set none.
  - `homeassistant.url`/`token` are the only fields lockable by an environment variable too (`HA_URL`/`HA_TOKEN`, which always win the `||` in `cfg.homeassistant`), not just config.yaml — `cfg._locked.haUrlEnv`/`haTokenEnv` record which it actually was, so the admin UI's "locked" label can say the right thing (`Admin.tsx`'s `Field` `lockedReason` prop) instead of always blaming config.yaml.
  - `alerts` is all-or-nothing, not per-field: a config.yaml `alerts:` key (including an explicit `alerts: []`) locks the whole list; otherwise the admin's array (or `null`, meaning "use `DEFAULT_ALERTS`") fully replaces it, never merges rule-by-rule. Same for `station.devices`.
  - Rule validation (`all`/`any` required, each condition needs `sensor` or `entity`, id/label/description/level defaulting) is `config.js`'s exported `normalizeAlerts()`, called from both `loadConfig()` (YAML path) and `saveSettings()` (admin-UI path, wrapped in try/catch so a bad rule becomes a `400` with the validation message instead of corrupting `admin.json` or crashing a later boot).
- If, after that merge, Home Assistant is still unconfigured anywhere, `index.js` forces demo mode with a warning instead of crashing — `config.js` no longer throws on a missing HA url/token, specifically so the admin login page stays reachable to fix it. The resulting `needsSetup` flag (`/api/config`) is true exactly in that forced-fallback case — not for a deliberate `server.demo: true` in config.yaml with real HA credentials also present — so the frontend can land first-time visitors on `#/admin/login` without ever redirecting a deployment that's fully configured via config.yaml and doesn't use the admin page.
- Sessions are an HMAC-SHA256-signed cookie (`node:crypto`, zero new dependencies) over an expiry timestamp, verified with `timingSafeEqual`; a simple in-memory per-IP backoff throttles repeated failed logins/password attempts. There's no per-session store, so revocation works by rotating the shared `sessionSecret` (invalidating every outstanding token at once) — `changePassword()` does this and re-issues a fresh cookie for the caller so they stay logged in, and `logout()` does the same without re-issuing one. With a single admin account, "log out" and "log out everywhere" are the same operation.
- Settings changes only take effect at boot (same as `config.yaml`), so a successful `POST /api/admin/settings` responds first, then the process exits after a short delay, relying on the container's restart policy to reload with the new settings — password changes don't restart anything.
- Every `/api/admin/*` route except `/login` and `/session` requires a valid session; every one except `/password` additionally requires `mustChangePassword` to already be false — enforced server-side (`requireSession` in `index.js`), not just hidden in the UI.
- **Two-factor authentication** (`totp.js` + `AdminStore`'s `totp` state): optional, off by default, a hand-rolled RFC 6238 TOTP implementation on `node:crypto` only (base32 encode/decode, HOTP, verify with ±1 step clock-drift tolerance) — no new dependency, no QR code (would need either a real QR encoder or an external rendering service; the admin UI shows the secret as text plus a tappable `otpauth://` link instead). `totp.test.js` checks it against RFC 6238's own published test vectors, not just internal round-trips.
  - `beginTotpSetup()` generates a secret but keeps it **in memory only** (`AdminStore._pendingTotpSecret`, never in `this.state`) until `confirmTotpSetup()` receives a valid code against it — a secret nobody has actually saved in an app never reaches disk, and a server restart mid-setup just means starting over, not a security concern.
  - `verifyLogin(ip, username, password, code)` re-verifies the password every time rather than issuing some partial "password OK, awaiting 2FA" session of its own: if `totp.enabled` and `code` is missing, it returns `{ok:false, needsTotp:true}` (not a failure — `index.js` answers that one with `200`, not `401`, since the password was right); a present-but-wrong code *is* a rate-limited failure (`401`, same `_attempts` throttle as password guesses — a 6-digit code is only 1e6 possibilities, brute-forcing it has to be exactly as expensive as brute-forcing the password). The frontend (`AdminLogin.tsx`) resubmits username+password+code together rather than tracking a separate "awaiting 2FA" step client-side.
  - `disableTotp()` requires the current password, not a code — the one way back in if you've lost the authenticator but still have the password; if you've lost both, see the README's "Forgot the admin password?" (delete `admin.json`).

### API

Everything under `/api/*` except `/api/admin/*` is GET-only (anything else returns 405):

| Endpoint | Returns |
|---|---|
| `/api/config` | public config: station, devices, timezone, available metrics/sensors, alert rule labels, ui |
| `/api/current` | values, today min/max, rain totals, pressureTrend, spark, forecast, astro, devices, active alerts |
| `/api/history?metric=&range=` | `{ metric, range, agg, points: [{t, v, lo?, hi?}], stats }` |
| `/api/detail?metric=` | `{ today: Stat[], record, device }` |
| `/api/records` | all-time records per metric, plus this month |
| `/api/radar` | `{ width, height, timestamp }` for the current rain radar frame (503 if none loaded yet) |
| `/api/radar/grid` | raw `Uint8Array` intensity grid (`application/octet-stream`), pairs with `/api/radar` |
| `/api/alerts` | `{ rules, log }` |
| `/healthz` | `{ ok, connected, lastMessage }` |

`/api/admin/*` (see above) is the one authenticated, non-read-only surface:
`POST /login`, `POST /logout`, `GET /session`, `POST /password`, `GET`/`POST /settings`, `POST /totp/setup`, `POST /totp/enable`, `POST /totp/disable`.

The response types in `web/src/lib.ts` are maintained by hand. There is no shared schema, so any change to an API response shape must be mirrored there.

## Frontend conventions

- **Routing** uses the URL hash: `#/`, `#/verlauf?m=<metric>&r=<day|week|month|year>`, `#/details/<metric>`, `#/warnungen`, `#/einstellungen`, `#/admin/login`, `#/admin/password`, `#/admin`. `?kiosk=1` (query string, not hash) shows only the overview; clicking the header toggles fullscreen. The three admin routes render without the normal header/nav/footer chrome (`AdminGate` in `App.tsx`) and redirect between themselves based on session state obtained once on a cold admin visit, then updated directly from each login/logout/password-change response (never re-fetched right after, which used to race) — a UX convenience only, the real enforcement is server-side. An "Admin" link lives in the header nav, next to the other tabs. If `cfg.needsSetup` is true, landing on the bare dashboard (`#/` or no hash) redirects once to `#/admin/login` instead, so a freshly started container with nothing configured opens on setup rather than an empty demo dashboard; logging out always goes to the dashboard (`#/`), not back to the login screen.
- **Data:** `useApi(url, intervalMs)` polls and also refetches when the tab becomes visible.
- **Formatting:**
  - Always use `fmt()`: locale-aware (de-DE comma decimal / grouping only from 5 digits, or en-US period decimal / normal grouping, per the current language), and a real minus sign (U+2212) in both.
  - Dates use `parts()` / `longDate()` / `clock()` / `hhmm()`, which switch between German and English short names without dots (`Mi`/`Wed`, `Sep`) and date-part ordering based on the current language. Clock stays 24-hour in both languages.
- **Live indicator:** grey and "Veraltet" if `now − current.updated > ui.stale_after_seconds`. `updated` is the max `lu` of the configured sensors, which only changes when a value changes, so on calm nights use 300 s or more.
- **Installable as a home-screen app** (`index.html` + `public/manifest.webmanifest`): `apple-mobile-web-app-capable`/`mobile-web-app-capable` get iOS/Android to launch it standalone (no browser chrome) instead of a plain bookmark; `apple-mobile-web-app-status-bar-style: black-translucent` overlays the status bar on the page instead of reserving an opaque bar for it, matching the glass look. That overlay is exactly why `.page`/`.admin-page`/`.auth-page` add `env(safe-area-inset-top/bottom)` **on top of** their normal padding (`calc(env(...) + padding)`, not `max(env(...), padding)`) — on a notched/Dynamic-Island phone `env(safe-area-inset-top)` alone already exceeds the normal padding, so `max()` would leave zero breathing room below the status bar, which is the cramped look this avoids. A device that already has the icon on its home screen from before this existed needs to remove and re-add it — the installable/standalone decision and the icon are fetched once, at add-time, not on every launch.
- **Design tokens** (in `styles.css`):
  - Background `oklch(0.16 0.008 250)`, base card tint `oklch(0.2 0.008 250)`, border `oklch(0.27 0.01 250)`
  - Accents: amber `oklch(0.8 0.13 70)` (heat, sun, lightning, warnings), blue `oklch(0.8 0.13 230)` (water, wind, cold), green `oklch(0.8 0.13 150)` (ok)
  - Fonts: Geist and Geist Mono, self-hosted via `@fontsource-variable`
  - Radius: cards 26 px (`--glass-radius`), buttons/chips/nav/pills fully pill-shaped
  - Layout: card grid `repeat(auto-fill, minmax(min(100%,300px),1fr))`, no fixed breakpoints
- **Liquid Glass**: every surface (`.card`, `.nav`, `.segs`, `.chip`, `.pill`, `.banner`, `.tip`, `.btn-primary`, `.btn-ghost`) is translucent, not a flat fill — `backdrop-filter: blur(28px) saturate(165%)` (`--glass-blur`) over a low-opacity white gradient tint (`--glass-tint`), a bright 1px top-biased edge, and a soft top-left specular highlight (`.card::before`'s radial-gradient). This only reads as glass because there's something colorful behind it to refract: `body`'s background is three large, soft `radial-gradient` "ambient blobs" (amber top-left, blue top-right, green bottom) over the base `--bg`, `background-attachment: fixed` so they stay put while content scrolls. A selected/active state (`.seg.on`, `.chip.on`, `.pill.on`, `.btn-primary`) swaps the neutral tint for an amber (or blue for `.banner.info`/`.pill.on.info`) tinted glass gradient instead of a flat fill. `.input` is the inverse — a dark recessed glass "well" (`inset box-shadow`, no blur) rather than a raised surface, to read as a field you type into, not a panel. Text and numbers stay fully opaque at all times; only the surface underneath them is glass, so legibility at a glance (this app is also used in kiosk/wall-mounted mode) is unaffected. `@supports not (backdrop-filter: ...)` falls every glass surface back to a flat opaque `--card` fill for browsers without it, rather than leaving anything semi-transparent and hard to read.
- **Charts** are hand-written SVG (`linePath`, `areaPath`, `barsPath`) in an 800×300 viewBox with `preserveAspectRatio="none"`.
  - Hover snaps to the nearest measured point.
  - The tooltip flips to the left in the right quarter of the chart.

## Hard constraints – do not break

- **No secrets in the browser.** The public API never exposes the HA URL, token, coordinates or entity IDs. The one deliberate, narrow exception is the authenticated admin surface: `GET /api/admin/settings` still never echoes the real HA token back (only a `tokenSet` boolean) — admin or not, nobody downloads the actual secret through the API. The other deliberate, narrow exception is `station.publicLocation` (see "Rain radar" above): an admin-opt-in, ~10 km-rounded approximate location, architecturally separate from `station.latitude`/`longitude`, which stay server-side-only as always.
- **Content-Security-Policy** (`index.js`) allows only `'self'` (plus inline styles and data: images). Don't add CDNs, Google Fonts, analytics or any external requests; bundle assets instead.
- **The public API stays read-only.** Everything under `/api/*` is GET-only except `/api/admin/*`, which is the one deliberate exception: authenticated (session cookie, enforced server-side), restart-required to take effect, and always overridden by anything already set in `config.yaml`. No other endpoint may change HA or the config.
- **Keep the dependency footprint small.** The server depends only on `yaml` and `suncalc`; the frontend has no UI or chart libraries. Discuss before adding any. (The rain radar's bz2 decompression shells out to the image's `bunzip2` binary instead of an npm package — see "Rain radar" above — which is the same spirit, not an exception to it.)
- **Non-root container.** The image runs as `node` (UID 1000) and deployments may override this with `user:`, so code must never assume root or write anywhere except `DATA_DIR`.
- **Keep `DemoSource` in sync** with any change to the data-source interface; demo mode is the main way to test.
- **Port 47813** is the default everywhere: `config.js`, `Dockerfile`, compose, `vite.config.ts`, README. Change all of them together.

## Configuration & environment

- Config file: `CONFIG_PATH` (default `/config/config.yaml`). If it's missing (or unreadable for the container user), the server starts in **demo mode**. It also falls back to demo mode (with a warning, not a crash) if, after merging in any admin-set settings, Home Assistant still isn't configured anywhere.
- Environment overrides: `HA_URL`, `HA_TOKEN`, `PORT`, `DEMO`, `DATA_DIR` (default `/data`), `PUBLIC_DIR` (default `/app/public` in the image), `TZ`.
- `config/config.example.yaml` is the single source of truth for options. When adding an option, update it, `config.js` and the README together.
- `config/config.yaml` and `.env` are gitignored and must never be committed. `DATA_DIR/admin.json` (password hash, session secret, admin-set HA/sensor/DWD settings) is runtime state, same category as `DATA_DIR/alerts.json` — never committed either, and never seed it by hand.

## Maintainer's deployment (for context)

- TrueNAS SCALE, installed via "Install via YAML" (Docker Compose) using the GHCR image.
- Host path `/mnt/docker/wetterstation/{config,data}`, container run with `user: "950:950"` to match the folder owner.
- Ecowitt pushes to HA every 60 s; recommended `ui.refresh_seconds: 30` and `stale_after_seconds: 300`.
- Update: pull the new image, then redeploy or recreate the container. Pulling alone doesn't replace the running container.

## Known gaps / ideas backlog

- Alert rule content (label/description/message/banner) is never translated — it's free text written by whoever configured the rule (default or admin/config-authored), shown exactly as written regardless of the visitor's chosen language. Same for the `'de-DE'`-formatted number embedded inside an already-composed, persisted alert log entry (`alerts.js`) — there is no per-visitor language for a shared, immutable log entry to be re-rendered in.
- Detail "Heute" min/max comes from cached raw history (≤ 60 s old) and doesn't merge the live value.
- Alert messages use canonical units, not the visitor's units.
- Lightning distance is always shown in km (no miles option).
- Test coverage is still deliberately narrow (`util.js`/`units.js`/`alerts.js` pure logic only, via `node:test`) — the HTTP layer, `dwd.js`, `admin.js`, and every React component remain untested; `detail()`'s Heute min/max now folds in the live reading, same as `current()`'s `todayRange` already did.
- Forecast condition names are translated client-side from `conditionCode` (`i18n.ts`'s `cond.*` keys — see "Language" above), not sent as text by the server. Each day also gets a small hand-drawn icon (`web/src/components/ConditionIcon.tsx`, switched on `conditionCode`), same convention as the wind compass/sun arc in `Dashboard.tsx` — covers every DWD-reachable slug plus the HA-fallback-only `partlycloudy`/`windy`/`windy-variant`, with an unstyled cloud as the fallback for anything unrecognized.
- `dwd.js`'s `ww` → condition mapping is an approximate grouping of DWD's documented code ranges, not an exact WMO table lookup; edge codes fall into the nearest sensible bucket.
- DWD's `R101` (precipitation probability) drives `pop` for the DWD forecast path; if a future MOSMIX revision renames/drops that element, `pop` silently falls back to `null` per day (frontend already renders that as blank) rather than erroring.
- `station.devices[].signal` is shown as `n/4` when it is an integer 0–4 (Ecowitt convention).
- Rain radar has no wind layer yet (see "Rain radar" above for why). `radolan.js`/`radar.js` are also untested beyond `radolan.test.js`'s pure-decoding tests — no test covers the bz2 fetch/shell-out path.
- The admin username is fixed as `admin` (no UI to change it, only the password). There's also no live reconnect: any settings save restarts the whole process, same as editing `config.yaml` would.
- 2FA is TOTP-only (no backup/recovery codes, no WebAuthn/passkeys) and single-admin by design, same as the account itself. Losing both the password and the authenticator means the README's `admin.json` reset, same as losing just the password.
- In demo mode with no `config.yaml` sensors and nothing saved via the admin page, `cfg.sensors` gets filled with `DEMO_SENSORS` only if it was completely empty beforehand — so saving even one sensor via the admin page while otherwise relying on demo mode leaves the rest of `DEMO_SENSORS` unfilled. Not an issue outside of demo mode.
- Per-IP login/password-change throttling uses `req.socket.remoteAddress`, which is the proxy's address, not the real client's, behind a reverse proxy — it still throttles, just coarser (shared across everyone behind that proxy) than per-visitor.
