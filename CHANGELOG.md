# Changelog

Production releases of the Ecowitt Weather Dashboard. Versions follow [Semantic Versioning](https://semver.org).
Development pre-releases (`-dev.N`) are listed on the [releases page](https://github.com/0xvisualiris/ecowitt-weather-dashboard/releases).

## v2.1.0 – 2026-10-23

### Security
- The container now runs Node.js 22.23.4, which fixes CVE-2026-111497 ("Node2Shell"), an out-of-bounds write in Node's Brotli decoder that could crash the process, leak memory or allow remote code execution. v2.0.2 and earlier shipped a vulnerable runtime. (#71)

### New
- The sensor fields on the admin page suggest entities from Home Assistant as you type, the best fit for each reading first (by unit, device class and name). Under each field the page says what the reading expects, or shows the chosen sensor with its current value, and warns when its unit doesn't fit or the entity doesn't exist. The battery and signal fields of the devices suggest every sensor. Suggestions need a working Home Assistant connection. (#70)

### Fixed
- Outside demo mode, the admin page showed "null" under the "Manage station" heading. (#70)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v2.0.2 – 2026-10-19

### Fixed
- Without a `config.yaml`, a data source set on the admin page (Ecowitt gateway or Home Assistant) never took effect and the dashboard kept showing demo data. `config.yaml` is optional again; demo mode is only used until a data source is configured. (#67)

### Upgrade
No `config.yaml` changes required. If you created an empty `config.yaml` only to work around this, you can remove it.

    docker compose pull && docker compose up -d

## v2.0.1 – 2026-10-19

### Fixed
- In demo mode without a configured subtitle, the station subtitle was German ("Demo-Daten"). It is now "Demo data". (#64)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v2.0.0 – 2026-10-19

### Breaking changes
- Himmel is now the only design. The classic card dashboard and the `ui.design` option are removed. A `ui.design` left in `config.yaml` is ignored with a log line, a design saved on the admin page is ignored, and `/himmel/` redirects to `/`. (#61)
- In the API (`/api/config`, `/api/current`, `/api/alerts`), alert texts (label, description, banner, message, log title and text) can now be `{ en, de }` objects instead of strings. (#61)
- When no station name is set, the default is "Weather Station" instead of "Wetterstation". (#61)

### New
- The dashboard speaks English and German. Each visitor picks a language under Settings; without a choice, the browser's language decides. All views, the admin page, map labels and CSV files follow it. (#61)
- The built-in alert rules come in both languages, and their messages are filled in per language. Rules you write yourself are shown as written, or can be given once per language, for example `label: { en: Frost, de: Frost }`. (#61)
- Page addresses are English: `#/history`, `#/forecast`, `#/radar`, `#/alerts`, `#/settings`, `#/admin`. The German addresses and the classic `#/details/<metric>` still work, so bookmarks and home-screen apps keep working. (#61)

### Improved
- `ui.default_units` (starting units for new visitors) and `ui.stale_after_seconds` (the status turns amber when the station stops reporting) now work in Himmel; before, only the classic design used them. (#61)
- The example `config.yaml` is in English and no longer sets alert rules, so a copied example uses the bilingual built-in rules and keeps them editable on the admin page. (#61)
- The Docker image no longer has a frontend build step; the frontend is plain HTML, CSS and JavaScript. New screenshots in the README. (#61)

### Fixed
- The example `config.yaml` no longer sets the station's subtitle, altitude and commissioning date, so copying it no longer locks those fields on the admin page. (#60)

### Upgrade
Remove `ui.design` from your `config.yaml` if it is set; it is ignored otherwise. If you copied the alert rules from the old example `config.yaml`, they are German only and lock the alerts on the admin page: delete the `alerts:` block to use the built-in rules in both languages. Anything reading alert texts from the API must accept `{ en, de }` objects.

    docker compose pull && docker compose up -d

## v1.6.1 – 2026-10-19

### Fixed
- The browser tab, the Himmel header while the page loads, and the name of the app on a phone's home screen always said "Wetterstation". They now show the station name set in `config.yaml` or on the admin page. A phone that already has the app on its home screen keeps the old name until it is removed and added again. (#57)
- The example `config.yaml` no longer sets a station name, so copying it no longer locks the name field on the admin page. (#57)

### Upgrade
No `config.yaml` changes required. To change the name on the admin page, remove `station.name` from your `config.yaml`, because a value set there locks the field.

    docker compose pull && docker compose up -d

## v1.6.0 – 2026-10-19

### New
- The dashboard can read an Ecowitt gateway (GW1100, GW2000, GW3000, WS3900, … with current firmware) directly over its local HTTP API, so Home Assistant is no longer required. It detects the paired sensors itself and keeps its own history in `DATA_DIR/ecowitt`, so charts, records and CSV export work as with Home Assistant. Choose the source on the admin page or in `config.yaml` (#53):
  - `source`: `homeassistant` or `ecowitt`. If unset, Home Assistant is used when its URL and token are set, otherwise the gateway when `ecowitt.host` is set.
  - `ecowitt.host` (or the `ECOWITT_HOST` environment variable): the gateway's IP or hostname.
  - `ecowitt.poll_seconds` (default `30`), `ecowitt.rain_gauge` (`auto` | `piezo` | `tipping`, default `auto`), `ecowitt.pressure` (`relative` | `absolute`, default `relative`), `ecowitt.keep_raw_days` (default `10`).
  - Without Home Assistant there is no time zone or location to take from it, so set `station.timezone` (or `TZ`) and `station.latitude`/`longitude`.

### Fixed
- The dashboard no longer hangs with stale or no data after the Home Assistant connection dies without closing, for example after HA's host reboots, while HA is still starting, or behind a proxy that never answers. It now notices within a minute and reconnects. (#52)

### Improved
- CLAUDE.md describes how to use the agent-skills plugin with this project. No change to the dashboard itself. (#54)

### Upgrade
No `config.yaml` changes required. Existing Home Assistant setups keep working unchanged. To switch to the gateway, see the new `source` and `ecowitt` options in `config/config.example.yaml`.

    docker compose pull && docker compose up -d

## v1.5.3 – 2026-10-14

### Fixed
- Himmel: on iPhone (Safari 26) the strip behind the status bar on the Now view still showed a dark band instead of the sky colour. (#49)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.5.2 – 2026-10-14

### Fixed
- Himmel: the Forecast chart is now a plain line chart with a temperature scale, like the History charts, with the chance of rain in its own strip below. The landscape it replaces was hard to read, with stripes in the sky and labels on top of the line. (#46)
- Himmel: on iPhone the strip behind the status bar on the Now view now shows the sky colour instead of a dark band above it. (#46)
- Himmel: swiping up or down over a chart on a phone scrolls the page instead of moving the chart. A sideways swipe still moves through the day, and a tap moves the cursor to that spot. (#46)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.5.1 – 2026-10-13

Documentation release. No changes to the dashboard itself.

### Improved
- The README now shows one screenshot of each design. Screenshots of every screen of both designs are on the new [wiki page](https://github.com/0xvisualiris/ecowitt-weather-dashboard/wiki/Screenshots). (#42)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.5.0 – 2026-10-13

### New
- **A second design, "Himmel".** It draws the last 24 hours as a landscape whose ridge is the temperature, under a sky that follows the sun; drag across it to move through the day. It has the same screens as the existing design plus an hour-by-hour forecast for the next three days, its own admin page and a kiosk mode (`?kiosk=1`). German only. (#38)
- **Choose the design on the admin page.** Under Appearance you pick Classic or Himmel for all visitors, or set `ui.design: himmel` in `config.yaml` (default `classic`). Existing installations keep the classic design until you switch. While the classic design is active, Himmel can be previewed at `/himmel/`. (#38)
- New API endpoint `/api/forecast/hourly` with the next 72 hours, from the DWD forecast when a station is set and otherwise derived from the daily forecast. (#38)

### Improved
- New app icon, also used when the dashboard is installed to the home screen. (#38)
- The project is now released under the MIT License. (#38)
- The README screenshots are retaken and show both designs. (#39)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.4.1 – 2026-10-13

Documentation release. No changes to the dashboard itself.

### Improved
- The README now shows screenshots of every screen (History, Details, Rain radar, Alerts, Settings, the admin page and two phone views), and the Overview screenshot is up to date. (#35)
- The release instructions for contributors now state that a production release includes the version tag and the GitHub release. (#34)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.4.0 – 2026-10-13

### New
- **Rain radar.** A new "Rain radar" screen shows DWD's RADOLAN rain radar for Germany, updated every 5 minutes, on a base map with borders, federal states, rivers, lakes and place labels. Rain is coloured by rain rate with a legend in mm/h, and the last two hours can be played back as a loop or scrubbed through. (#26, #30)
- **Approximate home location for the radar.** The admin page can set an optional public location (about 10 km accuracy), picked on a map. The radar then opens zoomed in on your area, draws 25/50/100 km rings around it and tells you the rain rate there or the distance and direction to the nearest rain. This is separate from your station's real coordinates, which stay private as always. (#26, #30)
- **Map picker for the DWD forecast station.** Instead of typing a station ID on the admin page, pick the station on a map or search for it by name. Every station DWD publishes a forecast for is offered (about 2,800), including the ones with alphanumeric IDs such as `L771`. (#25, #27, #30, #31)
- **Two-factor authentication for the admin login.** Optional TOTP, off by default, set up from a new card on the admin page; turning it off requires the current password. The README now explains how to recover admin access after a forgotten password or a lost 2FA device. (#23)
- **Install to the home screen.** On iOS and Android the dashboard can be installed with its own icon and launches full screen without the browser's address bar. (#24)

### Improved
- The rain radar and the station map can be zoomed and panned with the mouse, a pinch or the +/− buttons, with momentum when you let go. A plain mouse wheel or a one-finger drag still scrolls the page; use a mouse drag, two fingers, or Ctrl/Cmd + wheel to move the map. (#27, #29, #30)
- The selection highlight in the navigation, the range, unit and language pickers and the metric chips now slides to the new choice instead of jumping. (#28, #29)
- Better on phones: larger touch targets, press feedback on buttons and cards, the navigation scrolls the selected tab into view, the records table stacks instead of scrolling sideways, and layouts hold down to 320 px wide. (#29)
- Accessibility: charts can be stepped through with the arrow keys, the "reduce motion", "reduce transparency" and "increase contrast" system settings are respected, faint text is easier to read, and the page language follows the language switch. (#29)
- Text entered on the admin page (station name and subtitle, alert texts, device names) is now length-limited; an over-long entry is rejected with a message naming the field. (#30)

### Fixed
- Forecast stations were shown up to about 45 km away from their real position on the station map. (#31)
- The station map showed stations far outside Germany; it is now limited to stations within 50 km of the border. (#27)
- The forecast card cut conditions down to a single letter on narrow phones. (#29)
- The header looked cramped under the status bar once the dashboard was installed to the home screen on iOS. (#24)
- Clicking the map to set the public location stored a spot beside the one you clicked. (#30)
- The example config pointed to a DWD station list that no longer exists; it now points to the map on the admin page. (#31)

### Upgrade
No `config.yaml` changes required — every new option is opt-in and set from the admin page.

    docker compose pull && docker compose up -d

## v1.3.0 – 2026-10-05

### Improved
- **Liquid Glass redesign.** Cards, navigation, buttons, chips, segmented controls, pills, banners and tooltips now render as translucent, refractive glass (matching Apple's iOS 26 design language) instead of flat dark fills. Pure visual change — no new dependencies, no behavior change, no config changes. Browsers without `backdrop-filter` support fall back to the previous flat, fully opaque look automatically. (#20)

### Upgrade
No `config.yaml` changes required.

    docker compose pull && docker compose up -d

## v1.2.0 – 2026-10-05

### New
- **Language toggle.** The interface can now be switched between German and English, for visitors and the admin alike, from Settings and from the admin page header. The choice is saved per browser, independently of the units preference. Alert rule content (its own label, description and message text — whether the built-in defaults or your own) is never machine-translated; it's shown exactly as written. (#17)
- Station info (timezone, demo-mode indicator) moved from the Settings screen to the admin page's existing Station section, alongside name/subtitle/altitude/devices. (#16)

### Fixed
- Corrected the documented and example hardware name from "Ecowitt WS90" to the actual "Ecowitt WH90" throughout the README, `CLAUDE.md`, the example config and demo data. (#15)

### Upgrade
No `config.yaml` changes required. If you've customized `config/config.example.yaml`'s commented-out `ws90_*` entity-ID examples, those placeholders are now named `wh90_*` — update your own config to match if you copied them literally (your actual entity IDs from Home Assistant are unaffected either way).

    docker compose pull && docker compose up -d

## v1.1.0 – 2026-10-04

### New
- **Forecast calculated from DWD, not just a Home Assistant weather entity.** The "Forecast" card can now use [DWD](https://www.dwd.de) MOSMIX (a real weather model, not just raw data) for a station you pick, with the next few hours nudged toward your own station's live reading. Each day now also shows a small condition icon. Falls back to a `weather.*` entity, same as before, if left unset. (#4)
- **Admin page** at `/#/admin/login` (linked from the header) as an alternative to editing `config.yaml`: set the Home Assistant URL/token, sensor entity IDs, DWD station ID, alert rules and station/device info from the dashboard itself. Default login `admin`/`admin`, with a password change required before anything else. Anything already set in `config.yaml` (or an `HA_URL`/`HA_TOKEN` environment variable) always wins and shows as locked. A freshly started container with nothing configured anywhere now opens directly on this page instead of an empty demo dashboard. (#5, #10)
- **CSV export** on the History screen — exports the currently viewed metric/range, formatted for German-locale Excel/LibreOffice. (#11)

### Improved
- Detail's "Heute" (today) min/max now reflects your station's live reading immediately, instead of only catching up once the cached history refreshes (up to 60 seconds later).

### Upgrade
No `config.yaml` changes required — every new option is opt-in. If you want the new DWD-based forecast, set `forecast.dwd_station_id` (or use the admin page). If you'd rather configure Home Assistant/alerts/station info through the browser instead of `config.yaml`, visit `/#/admin/login` and change the default password immediately; put the dashboard behind HTTPS (see "Making it public" in the README) before relying on the admin login if it's reachable beyond your own LAN.

    docker compose pull && docker compose up -d

## v1.0.1 – 2026-10-02

Maintenance release. No changes to the dashboard itself.

### Improved
- Releases are now versioned. Each production version is published as its own image tag (for example `:1.0.1`) next to `latest`, so you can pin a version and roll back if needed. (#1)
- Development builds for testing are published as `:dev` and `:X.Y.Z-dev.N`. They are not intended for production use. (#1)
- Added this changelog. (#1)

### Upgrade
No changes to `config.yaml` needed.

    docker compose pull && docker compose up -d

## v1.0.0 – 2026-10-02

First versioned release. This is the state of the dashboard before release versioning was introduced; nothing changes for existing installations.

### New
- Public, read-only dashboard for a weather station in Home Assistant, served from a single Docker container (amd64 and arm64).
- Screens: Overview, History (day / week / month / year with all-time records), Details, Alerts and Settings.
- Per-visitor units: °C/°F, km/h, m/s, mph, Bft, hPa/mmHg/inHg, mm/in. Home Assistant units are converted automatically.
- Configurable alerts (lightning nearby, frost, gusts, heavy rain, high UV) with a persisted history.
- 5-day forecast from a `weather.*` entity, sun and moon data.
- Kiosk mode via `?kiosk=1`.
- Demo mode with synthetic data when no configuration is present.
- Home Assistant token, coordinates and entity IDs stay on the server; strict Content Security Policy, no external requests.
