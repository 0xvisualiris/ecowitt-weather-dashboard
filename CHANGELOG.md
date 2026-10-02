# Changelog

Production releases of the Ecowitt Weather Dashboard. Versions follow [Semantic Versioning](https://semver.org).
Development pre-releases (`-dev.N`) are listed on the [releases page](https://github.com/0xvisualiris/ecowitt-weather-dashboard/releases).

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
