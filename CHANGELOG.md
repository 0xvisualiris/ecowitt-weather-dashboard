# Changelog

Production releases of the Ecowitt Weather Dashboard. Versions follow [Semantic Versioning](https://semver.org).
Development pre-releases (`-dev.N`) are listed on the [releases page](https://github.com/0xvisualiris/ecowitt-weather-dashboard/releases).

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
