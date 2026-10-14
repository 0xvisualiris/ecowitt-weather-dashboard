# Changelog

Production releases of the Ecowitt Weather Dashboard. Versions follow [Semantic Versioning](https://semver.org).
Development pre-releases (`-dev.N`) are listed on the [releases page](https://github.com/0xvisualiris/ecowitt-weather-dashboard/releases).

## v1.5.2 – 2026-10-14

### Fixed
- Himmel: the Vorhersage chart is now a plain line chart with a temperature scale, like the Verlauf charts, with the chance of rain in its own strip below. The landscape it replaces was hard to read, with stripes in the sky and labels on top of the line. (#46)
- Himmel: on iPhone the strip behind the status bar on Jetzt now shows the sky colour instead of a dark band above it. (#46)
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
- **Choose the design on the admin page.** Under Erscheinungsbild/Appearance you pick Klassisch/Classic or Himmel for all visitors, or set `ui.design: himmel` in `config.yaml` (default `classic`). Existing installations keep the classic design until you switch. While the classic design is active, Himmel can be previewed at `/himmel/`. (#38)
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
- **Rain radar.** A new "Regenradar" screen shows DWD's RADOLAN rain radar for Germany, updated every 5 minutes, on a base map with borders, federal states, rivers, lakes and place labels. Rain is coloured by rain rate with a legend in mm/h, and the last two hours can be played back as a loop or scrubbed through. (#26, #30)
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
- **Language toggle.** The interface can now be switched between German and English, for visitors and the admin alike, from Einstellungen/Settings and from the admin page header. The choice is saved per browser, independently of the units preference. Alert rule content (its own label, description and message text — whether the built-in defaults or your own) is never machine-translated; it's shown exactly as written. (#17)
- Station info (timezone, demo-mode indicator) moved from the Einstellungen/Settings screen to the admin page's existing Station section, alongside name/subtitle/altitude/devices. (#16)

### Fixed
- Corrected the documented and example hardware name from "Ecowitt WS90" to the actual "Ecowitt WH90" throughout the README, `CLAUDE.md`, the example config and demo data. (#15)

### Upgrade
No `config.yaml` changes required. If you've customized `config/config.example.yaml`'s commented-out `ws90_*` entity-ID examples, those placeholders are now named `wh90_*` — update your own config to match if you copied them literally (your actual entity IDs from Home Assistant are unaffected either way).

    docker compose pull && docker compose up -d

## v1.1.0 – 2026-10-04

### New
- **Forecast calculated from DWD, not just a Home Assistant weather entity.** The "Vorhersage" card can now use [DWD](https://www.dwd.de) MOSMIX (a real weather model, not just raw data) for a station you pick, with the next few hours nudged toward your own station's live reading. Each day now also shows a small condition icon. Falls back to a `weather.*` entity, same as before, if left unset. (#4)
- **Admin page** at `/#/admin/login` (linked from the header) as an alternative to editing `config.yaml`: set the Home Assistant URL/token, sensor entity IDs, DWD station ID, alert rules and station/device info from the dashboard itself. Default login `admin`/`admin`, with a password change required before anything else. Anything already set in `config.yaml` (or an `HA_URL`/`HA_TOKEN` environment variable) always wins and shows as locked. A freshly started container with nothing configured anywhere now opens directly on this page instead of an empty demo dashboard. (#5, #10)
- **CSV export** on the Verlauf (history) screen — exports the currently viewed metric/range, formatted for German-locale Excel/LibreOffice. (#11)

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
- Screens: Übersicht (overview), Verlauf (history for day / week / month / year with all-time records), Details, Warnungen (alerts) and Einstellungen (settings).
- Per-visitor units: °C/°F, km/h, m/s, mph, Bft, hPa/mmHg/inHg, mm/in. Home Assistant units are converted automatically.
- Configurable alerts (lightning nearby, frost, gusts, heavy rain, high UV) with a persisted history.
- 5-day forecast from a `weather.*` entity, sun and moon data.
- Kiosk mode via `?kiosk=1`.
- Demo mode with synthetic data when no configuration is present.
- Home Assistant token, coordinates and entity IDs stay on the server; strict Content Security Policy, no external requests.
