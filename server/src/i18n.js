// The languages the dashboard speaks, and the server's German texts.
//
// English is the source language everywhere in the code. The only German the
// server needs is for the built-in alert rules, whose texts are rendered on the
// server for every language; they live here so German stays out of the code.
// The frontend's own translations are in web/i18n.js.

export const LANGS = ['en', 'de'];
export const LOCALES = { en: 'en-GB', de: 'de-DE' };

// German texts of DEFAULT_ALERTS in config.js, by rule id and field.
export const DEFAULT_ALERTS_DE = {
  lightning: {
    label: 'Blitz in der Nähe', description: 'Einschlag näher als 15 km', banner: 'Gewitter in der Nähe',
    message: 'Letzter Blitz {lightning_distance} km entfernt um {lightning_time|time} Uhr · {lightning_count} Einschläge heute',
  },
  frost: {
    label: 'Frost', description: 'Temperatur unter 0 °C oder Taupunkt unter 1 °C', banner: 'Frostgefahr',
    message: 'Temperatur {temperature} °C · Taupunkt {dew_point} °C',
  },
  gust: {
    label: 'Sturmböen', description: 'Böe über 60 km/h', banner: 'Sturmböen',
    message: 'Böe {wind_gust} km/h aus {wind_direction|compass}',
  },
  rain: {
    label: 'Starkregen', description: 'Regenrate über 10 mm/h', banner: 'Starkregen',
    message: 'Regenrate {rain_rate} mm/h · {rain_daily} mm heute',
  },
  uv: {
    label: 'Hoher UV-Index', description: 'UV-Index ab 6', banner: 'Hoher UV-Index',
    message: 'UV-Index {uv_index} · Sonnenschutz empfohlen',
  },
};

// Compass points as each language abbreviates them (German writes O for east).
export const COMPASS_POINTS = {
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  de: ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
};

// A rule's text is either a plain string, shown as written in every language,
// or one string per language ({ en: '…', de: '…' }).
export function textIn(text, lang) {
  if (text == null || typeof text !== 'object') return text ?? '';
  return text[lang] ?? text.en ?? Object.values(text)[0] ?? '';
}
