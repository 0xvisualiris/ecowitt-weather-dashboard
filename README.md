# Wetterstation

Öffentliche Web-Oberfläche für eine Wetterstation, deren Daten in **Home Assistant** liegen (getestet mit Ecowitt WS90 + WH57 + Gateway über die Ecowitt-Integration, funktioniert aber mit beliebigen Sensoren).

Ein einzelner Docker-Container liefert die Oberfläche und eine kleine, schreibgeschützte API aus. Der Home-Assistant-Token und die HA-Adresse bleiben auf dem Server, der Browser sieht nur fertige Messwerte.

Die Oberfläche hat fünf Bereiche: Übersicht, Verlauf (Tag/Woche/Monat/Jahr), Details je Messwert, Warnungen und Einstellungen (nur Einheiten).

## Schnellstart

```bash
git clone <dieses-repo> wetterstation && cd wetterstation
mkdir -p config
cp config/config.example.yaml config/config.yaml   # Entity-IDs anpassen
cp .env.example .env                               # HA_TOKEN eintragen
docker compose up -d --build
```

Danach ist die Seite unter `http://<host>:47813` erreichbar.

**Ohne Konfiguration ausprobieren:** Fehlt `config/config.yaml`, startet der Container im Demo-Modus mit synthetischen Daten.

```bash
docker build -t wetterstation .
docker run --rm -p 47813:47813 wetterstation
```

## Konfiguration

Alles wird in `config/config.yaml` eingestellt. Die Datei [`config/config.example.yaml`](config/config.example.yaml) erklärt jede Option. Die wichtigsten Punkte:

1. **`homeassistant`**: URL und Token. Den Token am besten per Umgebungsvariable `HA_TOKEN` übergeben, in der YAML steht dann `token: ${HA_TOKEN}`.
2. **`sensors`**: Die Entity-IDs deiner Sensoren, zu finden in HA unter *Entwicklerwerkzeuge → Zustände*. Sensoren, die du nicht hast, lässt du einfach weg; die zugehörigen Karten werden dann ausgeblendet.
3. **`station.devices`**: Die Geräte mit Batterie- und Signal-Entitäten. Diese erscheinen auf der Details-Seite und in der Fußzeile.
4. **`alerts`**: Die Warnregeln mit ihren Schwellwerten. Sie werden nur serverseitig ausgewertet, der Verlauf wird in `/data` gespeichert.
5. **`forecast.entity`**: Eine `weather.*`-Entität für die 5-Tage-Vorhersage.

Einheiten werden automatisch erkannt und umgerechnet (°F, mph, inHg, in, mi usw.). Besucher wählen ihre Anzeige-Einheiten selbst; das wird nur in ihrem Browser gespeichert.

Nach Änderungen an der Konfiguration: `docker compose restart`.

### Umgebungsvariablen

| Variable      | Bedeutung                                           | Standard              |
|---------------|-----------------------------------------------------|-----------------------|
| `HA_TOKEN`    | Long-Lived Access Token                             | –                     |
| `HA_URL`      | überschreibt `homeassistant.url`                    | –                     |
| `CONFIG_PATH` | Pfad zur YAML                                       | `/config/config.yaml` |
| `DATA_DIR`    | Speicherort des Warnungs-Verlaufs                   | `/data`               |
| `PORT`        | Port im Container                                   | `47813`                |
| `DEMO`        | `1` erzwingt den Demo-Modus                         | –                     |
| `TZ`          | Zeitzone (sonst `station.timezone` bzw. die aus HA) | –                     |

### Voraussetzungen in Home Assistant

- **Recorder aktiv:** Er liefert den 24-h-Verlauf. Für Woche, Monat, Jahr und die Rekorde werden die Langzeitstatistiken genutzt; dafür brauchen die Sensoren eine `state_class`, was bei der Ecowitt-Integration der Fall ist.
- **Regen und Blitze als Tageszähler:** Diese Werte werden aus Zählern berechnet, die um Mitternacht zurückgesetzt werden (`rain_daily`, `lightning_count`).
- **Eigener Benutzer empfohlen:** Lege in HA einen eigenen Benutzer ohne Admin-Rechte an und erstelle den Token für diesen Benutzer.

## Kiosk / Tablet

Mit `http://<host>:47813/?kiosk=1` wird nur die Übersicht ohne Navigation angezeigt. Ein Tipp auf den Stationsnamen schaltet in den Vollbildmodus. Die Werte aktualisieren sich automatisch.

## TrueNAS SCALE

Unter *Apps → Discover Apps → ⋮ → Install via YAML* lässt sich der Container als eigene App installieren:

1. Das Image bauen und in eine Registry pushen, z. B. `docker build -t ghcr.io/<user>/wetterstation:latest . && docker push …`. Alternativ auf dem NAS selbst per Shell bauen.
2. Ein Dataset für die Konfiguration anlegen, z. B. `/mnt/pool/apps/wetterstation/config`, und dort die `config.yaml` ablegen.
3. Folgende YAML einfügen und anpassen:

```yaml
services:
  wetterstation:
    image: ghcr.io/<user>/wetterstation:latest
    restart: unless-stopped
    ports: ["47813:47813"]
    environment:
      HA_TOKEN: "<token>"
      TZ: Europe/Berlin
    volumes:
      - /mnt/pool/apps/wetterstation/config:/config:ro
      - /mnt/pool/apps/wetterstation/data:/data
```

Der Container läuft als Benutzer `node` (UID 1000). Das Daten-Dataset muss für UID 1000 beschreibbar sein.

## Öffentlich erreichbar machen

Den Container hinter einen Reverse Proxy mit HTTPS stellen (z. B. Nginx Proxy Manager, Traefik, Caddy oder Cloudflare Tunnel). Die API ist ausschließlich lesend, gibt keine Koordinaten, Tokens oder Entity-IDs heraus und setzt eine strikte Content-Security-Policy. Die Schriften werden aus dem Container ausgeliefert, es gibt also keine Anfragen an Google Fonts.

## API

Alle Endpunkte sind `GET`. Werte kommen in °C, km/h, hPa, mm und km zurück.

| Endpunkt                                          | Inhalt                                                                        |
|---------------------------------------------------|-------------------------------------------------------------------------------|
| `/api/config`                                     | Stationsinfo, verfügbare Messwerte, UI-Einstellungen                          |
| `/api/current`                                    | aktuelle Werte, Tages-Min/Max, Regensummen, Sparklines, Vorhersage, Sonne/Mond, aktive Warnungen |
| `/api/history?metric=temp&range=day`              | Verlauf und Kennzahlen; `metric` = temp, hum, wind, rain, press, solar, uv, light; `range` = day, week, month, year |
| `/api/detail?metric=temp`                         | Tageswerte, Rekorde, Sensorinfo                                               |
| `/api/records`                                    | Rekorde seit Inbetriebnahme                                                   |
| `/api/alerts`                                     | Status der Warnregeln und Verlauf                                             |
| `/healthz`                                        | Healthcheck                                                                   |

## Entwicklung

```bash
# Server im Demo-Modus (Port 47813)
cd server && npm install && DEMO=1 npm run dev
# Frontend mit Hot Reload, leitet /api an :47813 weiter
cd web && npm install && npm run dev
```

**Aufbau:**

- `server/`: Node 22 ohne Framework, nur `yaml` und `suncalc` als Abhängigkeiten. Die Verbindung zu HA läuft über den eingebauten WebSocket-Client.
- `web/`: Vite, React und TypeScript. Diagramme sind eigenes SVG ohne Chart-Bibliothek.

Die Oberfläche ist auf Deutsch.
