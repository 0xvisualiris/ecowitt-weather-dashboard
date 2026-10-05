// German/English UI strings. Flat, namespaced dictionary (one file to scan),
// a module-level `LANG` variable read synchronously by `t()` and by the
// locale-aware formatting helpers in lib.ts – the exact same pattern lib.ts
// already uses for time zone (`TZ`/`setTimeZone`), so no component needs to
// subscribe to a context just to call `t()`; only the visible language
// switcher needs `LangContext` to reach `setLang` from deep components.
//
// Scope: every string that is part of the app's own UI chrome. Alert rule
// content (label/description/message/banner, whether from DEFAULT_ALERTS or
// admin/config-authored) is free text written by whoever configured the
// rule and is never translated – same for the number embedded in an
// already-composed, persisted alert log entry. See CLAUDE.md's Admin
// section for why that one can't be re-rendered per visitor after the fact.
import { createContext, useContext } from 'react';

export type Lang = 'de' | 'en';

const STRINGS = {
  // ---- nav / app shell ----
  'nav.dash': { de: 'Übersicht', en: 'Overview' },
  'nav.hist': { de: 'Verlauf', en: 'History' },
  'nav.detail': { de: 'Details', en: 'Details' },
  'nav.alerts': { de: 'Warnungen', en: 'Alerts' },
  'nav.settings': { de: 'Einstellungen', en: 'Settings' },
  'nav.mainAria': { de: 'Hauptnavigation', en: 'Main navigation' },
  'app.serverUnreachable': { de: 'Server nicht erreichbar: {error}', en: 'Server unreachable: {error}' },
  'app.loading': { de: 'Lade …', en: 'Loading…' },
  'app.stale': { de: 'Veraltet', en: 'Stale' },
  'app.lastUpdate': { de: ' · letztes Update {time}', en: ' · last update {time}' },
  'app.live': { de: 'Live', en: 'Live' },
  'app.footerBattery': { de: 'Batterie {v}', en: 'Battery {v}' },
  'app.footerSignal': { de: 'Signal {v}', en: 'Signal {v}' },

  // ---- common, reused across screens ----
  'common.measurementAria': { de: 'Messwert', en: 'Measurement' },
  'common.today': { de: 'heute', en: 'today' },
  'common.yesterday': { de: 'gestern', en: 'yesterday' },
  'common.now': { de: 'jetzt', en: 'now' },

  // ---- dashboard ----
  'dash.noData': { de: 'Keine Daten: {error}', en: 'No data: {error}' },
  'dash.loadingCurrent': { de: 'Lade aktuelle Werte …', en: 'Loading current values…' },
  'dash.cardTemp': { de: 'Außentemperatur', en: 'Outdoor temperature' },
  'dash.feelsLike': { de: 'Gefühlt', en: 'Feels like' },
  'dash.dewPoint': { de: 'Taupunkt', en: 'Dew point' },
  'dash.today': { de: 'Heute', en: 'Today' },
  'dash.ago24h': { de: 'vor 24 h', en: '24 h ago' },
  'dash.forecast': { de: 'Vorhersage', en: 'Forecast' },
  'dash.wind': { de: 'Wind', en: 'Wind' },
  'dash.gust': { de: 'Böe', en: 'Gust' },
  'dash.from': { de: 'aus', en: 'from' },
  'dash.maxGustToday': { de: 'Max. Böe heute {v}', en: 'Max. gust today {v}' },
  'dash.rain': { de: 'Niederschlag', en: 'Precipitation' },
  'dash.rainEvent': { de: 'Ereignis', en: 'Event' },
  'dash.rainWeek': { de: 'Woche', en: 'Week' },
  'dash.rainMonth': { de: 'Monat', en: 'Month' },
  'dash.rainYear': { de: 'Jahr', en: 'Year' },
  'dash.lightning': { de: 'Blitze', en: 'Lightning' },
  'dash.lastAtToday': { de: 'letzter um', en: 'last at' },
  'dash.lastOnDate': { de: 'letzter am', en: 'last on' },
  'dash.strikesToday': { de: '{n} heute', en: '{n} today' },
  'dash.strikesPerHour24h': { de: 'Einschläge / h · 24 h', en: 'Strikes / h · 24 h' },
  'dash.pressure': { de: 'Luftdruck', en: 'Pressure' },
  'dash.relative': { de: 'relativ', en: 'relative' },
  'dash.humidity': { de: 'Luftfeuchte', en: 'Humidity' },
  'dash.todayMinMaxPct': { de: 'Heute {min} – {max} %', en: 'Today {min} – {max} %' },
  'dash.sunUv': { de: 'Sonne & UV', en: 'Sun & UV' },
  'dash.uvIndexAria': { de: 'UV-Index {v}', en: 'UV index {v}' },
  'dash.sunMoon': { de: 'Sonne & Mond', en: 'Sun & Moon' },
  'dash.sunrise': { de: 'Aufgang', en: 'Sunrise' },
  'dash.sunset': { de: 'Untergang', en: 'Sunset' },
  'dash.moon': { de: 'Mond', en: 'Moon' },
  'dash.detailsAria': { de: '{title} – Details öffnen', en: '{title} – open details' },
  'dash.dayLen': { de: '{h} h {m} min', en: '{h}h {m}m' },

  // ---- history ----
  'hist.periodAria': { de: 'Zeitraum', en: 'Time range' },
  'hist.day': { de: 'Tag', en: 'Day' },
  'hist.week': { de: 'Woche', en: 'Week' },
  'hist.month': { de: 'Monat', en: 'Month' },
  'hist.year': { de: 'Jahr', en: 'Year' },
  'hist.exportCsv': { de: 'CSV exportieren', en: 'Export CSV' },
  'hist.notAvailable': { de: 'Verlauf nicht verfügbar: {error}', en: 'History unavailable: {error}' },
  'hist.records': { de: 'Rekorde', en: 'Records' },
  'hist.recordsSince': { de: ' · seit Inbetriebnahme {date}', en: ' · since commissioning {date}' },
  'hist.tableMax': { de: 'Höchstwert', en: 'Maximum' },
  'hist.tableAt': { de: 'am', en: 'on' },
  'hist.tableMin': { de: 'Tiefstwert', en: 'Minimum' },
  'hist.gustSuffix': { de: ' (Böe)', en: ' (gust)' },
  'hist.nearestPrefix': { de: 'nächster ', en: 'nearest ' },
  'hist.unitToday': { de: '{unit} heute', en: '{unit} today' },
  'csv.time': { de: 'Zeit', en: 'Time' },
  'csv.min': { de: 'Min', en: 'Min' },
  'csv.max': { de: 'Max', en: 'Max' },

  // ---- detail ----
  'detail.fullHistory': { de: 'Gesamter Verlauf', en: 'Full history' },
  'detail.strongestGust': { de: 'Stärkste Böe', en: 'Strongest gust' },
  'detail.mostStrikes': { de: 'Meiste Einschläge', en: 'Most strikes' },
  'detail.nextStrike': { de: 'Nächster Einschlag', en: 'Next strike' },
  'detail.thisMonth': { de: 'Dieser Monat', en: 'This month' },
  'detail.maxOnly': { de: 'max. {v}', en: 'max. {v}' },
  'detail.sensor': { de: 'Sensor', en: 'Sensor' },
  'detail.device': { de: 'Gerät', en: 'Device' },
  'detail.battery': { de: 'Batterie', en: 'Battery' },
  'detail.signal': { de: 'Signal', en: 'Signal' },
  'detail.sunProtectionRecommended': { de: 'Sonnenschutz empfohlen', en: 'Sun protection recommended' },
  'detail.protectionFrom3': { de: 'Schutz ab 3 empfohlen', en: 'Protection recommended from 3' },
  'detail.lastAt': { de: 'Letzter {date} um {time}', en: 'Last {date} at {time}' },
  'detail.strikesTodaySuffix': { de: '{n} Einschläge heute', en: '{n} strikes today' },

  // ---- alerts ----
  'alerts.notAvailable': { de: 'Warnungen nicht verfügbar: {error}', en: 'Alerts unavailable: {error}' },
  'alerts.current': { de: 'Aktuelle Lage', en: 'Current status' },
  'alerts.active': { de: 'aktiv', en: 'active' },
  'alerts.none': { de: 'keine', en: 'none' },
  'alerts.noRules': { de: 'Keine Warnregeln konfiguriert.', en: 'No alert rules configured.' },
  'alerts.activeSuffix': { de: ' · aktiv', en: ' · active' },
  'alerts.noneRecorded': { de: 'Bisher keine Warnungen aufgezeichnet.', en: 'No alerts recorded so far.' },

  // ---- settings ----
  'settings.units': { de: 'Einheiten', en: 'Units' },
  'settings.browserOnly': { de: 'Wird nur in diesem Browser gespeichert.', en: 'Only saved in this browser.' },
  'settings.language': { de: 'Sprache', en: 'Language' },

  // ---- admin: login / password ----
  'adminLogin.title': { de: 'Admin-Anmeldung', en: 'Admin login' },
  'adminLogin.username': { de: 'Benutzername', en: 'Username' },
  'adminLogin.password': { de: 'Passwort', en: 'Password' },
  'adminLogin.submit': { de: 'Anmelden', en: 'Sign in' },
  'adminLogin.note': { de: 'Standard: admin / admin. Das Passwort muss danach geändert werden.', en: 'Default: admin / admin. The password must be changed afterward.' },
  'adminLogin.totpCode': { de: '2FA-Code', en: '2FA code' },
  'adminLogin.totpHint': { de: 'Code aus deiner Authenticator-App eingeben.', en: 'Enter the code from your authenticator app.' },
  'adminPassword.mismatch': { de: 'Die Passwörter stimmen nicht überein.', en: "The passwords don't match." },
  'adminPassword.tooShort': { de: 'Das neue Passwort muss mindestens 8 Zeichen lang sein.', en: 'The new password must be at least 8 characters long.' },
  'adminPassword.title': { de: 'Passwort ändern', en: 'Change password' },
  'adminPassword.forcedNote': { de: 'Das Standardpasswort muss vor der weiteren Nutzung geändert werden.', en: 'The default password must be changed before continuing.' },
  'adminPassword.current': { de: 'Aktuelles Passwort', en: 'Current password' },
  'adminPassword.new': { de: 'Neues Passwort', en: 'New password' },
  'adminPassword.newHint': { de: '(mind. 8 Zeichen)', en: '(at least 8 characters)' },
  'adminPassword.confirm': { de: 'Neues Passwort bestätigen', en: 'Confirm new password' },

  // ---- admin: main settings screen ----
  'admin.loadError': { de: 'Fehler: {error}', en: 'Error: {error}' },
  'admin.restarting': { de: 'Gespeichert – der Server startet neu …', en: 'Saved – the server is restarting…' },
  'admin.title': { de: 'Admin-Einstellungen', en: 'Admin settings' },
  'admin.logout': { de: 'Abmelden', en: 'Log out' },
  'admin.totpHeader': { de: 'Zwei-Faktor-Authentifizierung', en: 'Two-factor authentication' },
  'admin.totpActive': { de: 'Aktiv', en: 'Enabled' },
  'admin.totpInactive': { de: 'Nicht aktiviert', en: 'Not enabled' },
  'admin.totpSetupStart': { de: '2FA einrichten', en: 'Set up 2FA' },
  'admin.totpSetupIntro': { de: 'Geheimen Schlüssel in deiner Authenticator-App speichern (z. B. Google Authenticator, Authy, 1Password) – manuell eingeben oder den Link auf diesem Gerät antippen – und den angezeigten Code zur Bestätigung eingeben.', en: 'Save the secret key in your authenticator app (e.g. Google Authenticator, Authy, 1Password) – enter it manually or tap the link on this device – then enter the code it shows to confirm.' },
  'admin.totpSecretLabel': { de: 'Geheimer Schlüssel', en: 'Secret key' },
  'admin.totpLinkLabel': { de: 'In Authenticator-App öffnen', en: 'Open in authenticator app' },
  'admin.totpConfirmLabel': { de: 'Code zur Bestätigung', en: 'Confirmation code' },
  'admin.totpConfirmButton': { de: 'Aktivieren', en: 'Enable' },
  'admin.totpCancelButton': { de: 'Abbrechen', en: 'Cancel' },
  'admin.totpDisableButton': { de: '2FA deaktivieren', en: 'Disable 2FA' },
  'admin.totpDisablePasswordLabel': { de: 'Aktuelles Passwort zur Bestätigung', en: 'Current password to confirm' },
  'admin.totpDisableConfirm': { de: 'Deaktivieren', en: 'Disable' },
  'admin.toDashboard': { de: 'Zum Dashboard', en: 'Go to dashboard' },
  'admin.ha': { de: 'Home Assistant', en: 'Home Assistant' },
  'admin.haUrl': { de: 'URL', en: 'URL' },
  'admin.lockedEnvUrl': { de: 'durch Umgebungsvariable HA_URL festgelegt', en: 'set by the HA_URL environment variable' },
  'admin.lockedEnvToken': { de: 'durch Umgebungsvariable HA_TOKEN festgelegt', en: 'set by the HA_TOKEN environment variable' },
  'admin.lockedConfig': { de: 'in config.yaml festgelegt', en: 'set in config.yaml' },
  'admin.token': { de: 'Long-Lived Access Token', en: 'Long-lived access token' },
  'admin.tokenSetSuffix': { de: ' (bereits gesetzt)', en: ' (already set)' },
  'admin.tokenPlaceholderUnchanged': { de: 'Leer lassen = unverändert', en: 'Leave blank = unchanged' },
  'admin.tokenPlaceholderEnter': { de: 'Token einfügen', en: 'Enter token' },
  'admin.forecast': { de: 'Vorhersage', en: 'Forecast' },
  'admin.dwdStationId': { de: 'DWD-Stations-ID', en: 'DWD station ID' },
  'admin.biasHours': { de: 'Ausgleichsstunden (Live-Messwert)', en: 'Bias hours (live reading)' },
  'admin.forecastEntity': { de: 'Home-Assistant-Wetter-Entität (Rückfallebene)', en: 'Home Assistant weather entity (fallback)' },
  'admin.sourceLabel': { de: 'Quellenangabe (optional)', en: 'Source label (optional)' },
  'admin.egDwd': { de: 'z. B. DWD MOSMIX', en: 'e.g. DWD MOSMIX' },
  'admin.egStationId': { de: 'z. B. 10384', en: 'e.g. 10384' },
  'admin.sensors': { de: 'Sensoren', en: 'Sensors' },
  'admin.station': { de: 'Station', en: 'Station' },
  'admin.name': { de: 'Name', en: 'Name' },
  'admin.subtitle': { de: 'Unterzeile (optional)', en: 'Subtitle (optional)' },
  'admin.altitude': { de: 'Höhe ü. NN in m (optional)', en: 'Altitude above sea level in m (optional)' },
  'admin.since': { de: 'In Betrieb seit (JJJJ-MM-TT, optional)', en: 'In service since (YYYY-MM-DD, optional)' },
  'admin.timezone': { de: 'Zeitzone', en: 'Timezone' },
  'admin.dataSource': { de: 'Datenquelle', en: 'Data source' },
  'admin.demoMode': { de: 'Demo-Modus (synthetische Werte)', en: 'Demo mode (synthetic data)' },
  'admin.devices': { de: 'Geräte', en: 'Devices' },
  'admin.addDevice': { de: 'Gerät hinzufügen', en: 'Add device' },
  'admin.newDevice': { de: 'Neues Gerät', en: 'New device' },
  'admin.remove': { de: 'Entfernen', en: 'Remove' },
  'admin.id': { de: 'ID', en: 'ID' },
  'admin.role': { de: 'Rolle', en: 'Role' },
  'admin.rolePlaceholder': { de: 'z. B. Außensensor', en: 'e.g. outdoor sensor' },
  'admin.shortName': { de: 'Kurzname', en: 'Short name' },
  'admin.batteryEntity': { de: 'Batterie-Entität (optional)', en: 'Battery entity (optional)' },
  'admin.signalEntity': { de: 'Signal-Entität (optional)', en: 'Signal entity (optional)' },
  'admin.metrics': { de: 'Messwerte', en: 'Measurements' },
  'admin.alertsHeader': { de: 'Warnungen', en: 'Alerts' },
  'admin.restoreDefaults': { de: 'Standardregeln wiederherstellen', en: 'Restore default rules' },
  'admin.alertsLocked': { de: 'In config.yaml festgelegt.', en: 'Set in config.yaml.' },
  'admin.addRule': { de: 'Regel hinzufügen', en: 'Add rule' },
  'admin.newRule': { de: 'Neue Regel', en: 'New rule' },
  'admin.label': { de: 'Bezeichnung', en: 'Label' },
  'admin.description': { de: 'Beschreibung', en: 'Description' },
  'admin.level': { de: 'Stufe', en: 'Level' },
  'admin.levelWarning': { de: 'Warnung', en: 'Warning' },
  'admin.levelInfo': { de: 'Info', en: 'Info' },
  'admin.combination': { de: 'Verknüpfung', en: 'Combination' },
  'admin.all': { de: 'Alle (UND)', en: 'All (AND)' },
  'admin.any': { de: 'Eine (ODER)', en: 'Any (OR)' },
  'admin.banner': { de: 'Banner (optional)', en: 'Banner (optional)' },
  'admin.message': { de: 'Meldungstext', en: 'Message text' },
  'admin.messagePlaceholder': { de: 'z. B. Temperatur {temperature} °C', en: 'e.g. Temperature {temperature} °C' },
  'admin.conditions': { de: 'Bedingungen', en: 'Conditions' },
  'admin.addCondition': { de: 'Bedingung hinzufügen', en: 'Add condition' },
  'admin.customEntity': { de: 'Eigene HA-Entität…', en: 'Custom HA entity…' },
  'admin.cmpAbove': { de: 'Über', en: 'Above' },
  'admin.cmpBelow': { de: 'Unter', en: 'Below' },
  'admin.cmpAtLeast': { de: 'Mindestens', en: 'At least' },
  'admin.cmpAtMost': { de: 'Höchstens', en: 'At most' },
  'admin.cmpEquals': { de: 'Gleich', en: 'Equal to' },
  'admin.onlyIfRecent': { de: 'Nur wenn aktuell', en: 'Only if recent' },
  'admin.minutesAbbrev': { de: 'Min.', en: 'min.' },
  'admin.save': { de: 'Speichern & neu starten', en: 'Save & restart' },
  'admin.sensor.temperature': { de: 'Temperatur', en: 'Temperature' },
  'admin.sensor.feels_like': { de: 'Gefühlte Temperatur', en: 'Feels-like temperature' },
  'admin.sensor.dew_point': { de: 'Taupunkt', en: 'Dew point' },
  'admin.sensor.humidity': { de: 'Luftfeuchte', en: 'Humidity' },
  'admin.sensor.wind_speed': { de: 'Windgeschwindigkeit', en: 'Wind speed' },
  'admin.sensor.wind_gust': { de: 'Windböe', en: 'Wind gust' },
  'admin.sensor.wind_direction': { de: 'Windrichtung', en: 'Wind direction' },
  'admin.sensor.rain_rate': { de: 'Regenrate', en: 'Rain rate' },
  'admin.sensor.rain_event': { de: 'Regen (Ereignis)', en: 'Rain (event)' },
  'admin.sensor.rain_daily': { de: 'Regen (Tag)', en: 'Rain (day)' },
  'admin.sensor.rain_weekly': { de: 'Regen (Woche)', en: 'Rain (week)' },
  'admin.sensor.rain_monthly': { de: 'Regen (Monat)', en: 'Rain (month)' },
  'admin.sensor.rain_yearly': { de: 'Regen (Jahr)', en: 'Rain (year)' },
  'admin.sensor.pressure': { de: 'Luftdruck', en: 'Pressure' },
  'admin.sensor.solar_radiation': { de: 'Solarstrahlung', en: 'Solar radiation' },
  'admin.sensor.uv_index': { de: 'UV-Index', en: 'UV index' },
  'admin.sensor.lightning_distance': { de: 'Blitz-Entfernung', en: 'Lightning distance' },
  'admin.sensor.lightning_time': { de: 'Letzter Blitz (Zeitstempel)', en: 'Last strike (timestamp)' },
  'admin.sensor.lightning_count': { de: 'Blitze (Tageszähler)', en: 'Lightning (daily count)' },

  // ---- metric labels (shared across screens) ----
  'metric.temp': { de: 'Temperatur', en: 'Temperature' },
  'metric.hum': { de: 'Luftfeuchte', en: 'Humidity' },
  'metric.wind': { de: 'Wind', en: 'Wind' },
  'metric.rain': { de: 'Niederschlag', en: 'Precipitation' },
  'metric.press': { de: 'Luftdruck', en: 'Pressure' },
  'metric.solar': { de: 'Solarstrahlung', en: 'Solar radiation' },
  'metric.uv': { de: 'UV-Index', en: 'UV index' },
  'metric.light': { de: 'Blitze', en: 'Lightning' },

  // ---- unit-group labels (Settings' Einheiten card) ----
  'unit.temp': { de: 'Temperatur', en: 'Temperature' },
  'unit.wind': { de: 'Windgeschwindigkeit', en: 'Wind speed' },
  'unit.press': { de: 'Luftdruck', en: 'Pressure' },
  'unit.rain': { de: 'Niederschlag', en: 'Precipitation' },
  'unit.perDay': { de: '/Tag', en: '/day' },
  'unit.strikesCount': { de: '{n} Einschläge', en: '{n} strikes' },

  // ---- stat-row slugs emitted by service.js (k field) ----
  'stat.min': { de: 'Minimum', en: 'Minimum' },
  'stat.max': { de: 'Maximum', en: 'Maximum' },
  'stat.mean': { de: 'Mittelwert', en: 'Average' },
  'stat.minShort': { de: 'Min', en: 'Min' },
  'stat.maxShort': { de: 'Max', en: 'Max' },
  'stat.meanShort': { de: 'Mittel', en: 'Avg' },
  'stat.strongestGust': { de: 'Stärkste Böe', en: 'Strongest gust' },
  'stat.yesterdayMean': { de: 'Gestern Ø', en: 'Yesterday avg.' },
  'stat.sumToday': { de: 'Summe heute', en: 'Sum today' },
  'stat.strongest30min': { de: 'Stärkste 30 min', en: 'Strongest 30 min' },
  'stat.rainRate': { de: 'Regenrate', en: 'Rain rate' },
  'stat.yesterday': { de: 'Gestern', en: 'Yesterday' },
  'stat.strikesToday': { de: 'Einschläge heute', en: 'Strikes today' },
  'stat.nearestToday': { de: 'Nächster heute', en: 'Nearest today' },
  'stat.lastStrike': { de: 'Letzter Einschlag', en: 'Last strike' },
  'stat.sum': { de: 'Summe', en: 'Sum' },
  'stat.maxDay': { de: 'Max. Tag', en: 'Max. day' },
  'stat.rainHours': { de: 'Stunden mit Regen', en: 'Hours with rain' },
  'stat.rainDays': { de: 'Regentage', en: 'Rain days' },
  'stat.strikes': { de: 'Einschläge', en: 'Strikes' },
  'stat.nearest': { de: 'Nächster', en: 'Nearest' },
  'stat.lightningHours': { de: 'Stunden mit Blitzen', en: 'Hours with lightning' },
  'stat.thunderDays': { de: 'Gewittertage', en: 'Thunderstorm days' },

  // ---- forecast condition labels, keyed by the HA/DWD condition slug ----
  'cond.clear-night': { de: 'Klar', en: 'Clear' },
  'cond.cloudy': { de: 'Bewölkt', en: 'Cloudy' },
  'cond.exceptional': { de: 'Unwetter', en: 'Severe weather' },
  'cond.fog': { de: 'Nebel', en: 'Fog' },
  'cond.hail': { de: 'Hagel', en: 'Hail' },
  'cond.lightning': { de: 'Gewitter', en: 'Thunderstorm' },
  'cond.lightning-rainy': { de: 'Gewitter', en: 'Thunderstorm' },
  'cond.partlycloudy': { de: 'Heiter', en: 'Partly cloudy' },
  'cond.pouring': { de: 'Starkregen', en: 'Heavy rain' },
  'cond.rainy': { de: 'Regen', en: 'Rain' },
  'cond.snowy': { de: 'Schnee', en: 'Snow' },
  'cond.snowy-rainy': { de: 'Schneeregen', en: 'Sleet' },
  'cond.sunny': { de: 'Sonnig', en: 'Sunny' },
  'cond.windy': { de: 'Windig', en: 'Windy' },
  'cond.windy-variant': { de: 'Windig, bewölkt', en: 'Windy, cloudy' },

  // ---- moon phase labels, keyed by astro.js's slug ----
  'moon.new-moon': { de: 'Neumond', en: 'New moon' },
  'moon.full-moon': { de: 'Vollmond', en: 'Full moon' },
  'moon.first-quarter': { de: 'Erstes Viertel', en: 'First quarter' },
  'moon.last-quarter': { de: 'Letztes Viertel', en: 'Last quarter' },
  'moon.waxing': { de: 'zunehmend', en: 'waxing' },
  'moon.waning': { de: 'abnehmend', en: 'waning' },

  // ---- pressure trend ----
  'trend.rising': { de: 'steigend', en: 'rising' },
  'trend.falling': { de: 'fallend', en: 'falling' },
  'trend.steady': { de: 'gleichbleibend', en: 'steady' },
  'trend.sentence': { de: '{arrow} {delta} {unit} / {hours} h · {word}', en: '{arrow} {delta} {unit} in {hours}h · {word}' },

  // ---- UV ----
  'uv.low': { de: 'niedrig', en: 'low' },
  'uv.moderate': { de: 'mittel', en: 'moderate' },
  'uv.high': { de: 'hoch', en: 'high' },
  'uv.veryHigh': { de: 'sehr hoch', en: 'very high' },
  'uv.extreme': { de: 'extrem', en: 'extreme' },
} satisfies Record<string, { de: string; en: string }>;

export type TKey = keyof typeof STRINGS;

export let LANG: Lang = 'de';
export function setLang(l: Lang) { LANG = l; }

export function t(key: TKey, vars?: Record<string, string | number>): string {
  let s = STRINGS[key][LANG];
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'de', setLang: () => {},
});
export const useLang = () => useContext(LangContext);

// Small, stable, already-English set of error strings `admin.js` returns
// (invalid credentials, rate limiting, password rules, disk-write failures,
// and a couple of alert-rule validation messages that embed the rule's own
// id). Pattern-matched rather than switching the backend to error codes –
// low risk, since these essentially never change – with the original
// message as a fallback for anything unrecognized.
const API_ERROR_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^invalid credentials$/, () => (LANG === 'de' ? 'Ungültige Anmeldedaten' : 'Invalid credentials')],
  [/^too many attempts – try again shortly$/, () => (LANG === 'de' ? 'Zu viele Versuche – bitte kurz warten' : 'Too many attempts – try again shortly')],
  [/^current password is incorrect$/, () => (LANG === 'de' ? 'Aktuelles Passwort ist falsch' : 'Current password is incorrect')],
  [/^new password must be at least (\d+) characters$/, m => (LANG === 'de' ? `Das neue Passwort muss mindestens ${m[1]} Zeichen lang sein` : `The new password must be at least ${m[1]} characters long`)],
  [/^could not save the new password \(DATA_DIR is not writable\) – password was NOT changed$/, () => (LANG === 'de' ? 'Das neue Passwort konnte nicht gespeichert werden (DATA_DIR ist nicht beschreibbar) – Passwort wurde NICHT geändert' : 'Could not save the new password (DATA_DIR is not writable) – password was NOT changed')],
  [/^could not save settings \(DATA_DIR is not writable\)$/, () => (LANG === 'de' ? 'Einstellungen konnten nicht gespeichert werden (DATA_DIR ist nicht beschreibbar)' : 'Could not save settings (DATA_DIR is not writable)')],
  [/^alert "(.+)" needs "all:" or "any:" conditions$/, m => (LANG === 'de' ? `Regel "${m[1]}" benötigt "all:"- oder "any:"-Bedingungen` : `Rule "${m[1]}" needs "all:" or "any:" conditions`)],
  [/^alert "(.+)": each condition needs "sensor:" \(key\) or "entity:" \(HA entity id\)$/, m => (LANG === 'de' ? `Regel "${m[1]}": jede Bedingung braucht "sensor:" (Schlüssel) oder "entity:" (HA-Entität)` : `Rule "${m[1]}": each condition needs "sensor:" (key) or "entity:" (HA entity id)`)],
  [/^not logged in$/, () => (LANG === 'de' ? 'Nicht angemeldet' : 'Not logged in')],
  [/^password change required$/, () => (LANG === 'de' ? 'Passwortänderung erforderlich' : 'Password change required')],
  [/^invalid 2FA code$/, () => (LANG === 'de' ? 'Ungültiger 2FA-Code' : 'Invalid 2FA code')],
  [/^no 2FA setup in progress$/, () => (LANG === 'de' ? 'Keine 2FA-Einrichtung in Arbeit' : 'No 2FA setup in progress')],
  [/^could not save \(DATA_DIR is not writable\) – 2FA was NOT enabled$/, () => (LANG === 'de' ? '2FA konnte nicht gespeichert werden (DATA_DIR ist nicht beschreibbar) – 2FA wurde NICHT aktiviert' : 'Could not save (DATA_DIR is not writable) – 2FA was NOT enabled')],
  [/^could not save \(DATA_DIR is not writable\) – 2FA was NOT disabled$/, () => (LANG === 'de' ? '2FA konnte nicht gespeichert werden (DATA_DIR ist nicht beschreibbar) – 2FA wurde NICHT deaktiviert' : 'Could not save (DATA_DIR is not writable) – 2FA was NOT disabled')],
];

export function translateApiError(message: string): string {
  for (const [re, fn] of API_ERROR_PATTERNS) {
    const m = message.match(re);
    if (m) return fn(m);
  }
  return message;
}
