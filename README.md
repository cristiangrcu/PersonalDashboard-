# LifeOS

Persönliches Lebens-Dashboard mit Jarvis als Assistent: Habits, Gesundheit, Finanzen, Studium, Content, dazu Kalender, Gmail und Notion als Fenster.

- **Online:** https://lifeos-cristian.vercel.app (Login mit Passwort)
- **claude.ai-Version:** https://claude.ai/artifact/WUF8y1CoqbaiANbhBpCfbv (privat)

`index.html` ist eine einzige Quelldatei für beide Versionen. Die Seite erkennt, wo sie läuft:

| Laufzeit | Speicher | Kalender / Gmail / Notion | Jarvis-Chat |
| --- | --- | --- | --- |
| claude.ai (Artifact) | Artifact-Datenbank | claude.ai-Connectors | claude.ai |
| Vercel | Upstash Redis über `/api/db` | eigene Verbindungen über `/api/google/*` und `/api/notion` | Claude-API über `/api/ask` (optional) |
| lokal geöffnete Datei | Browser (`localStorage`) | – | – |

## Bereiche

| Tab | Inhalt |
| --- | --- |
| Heute | Briefing, Habits mit Streaks, Top-3, Fenster für Kalender, Gmail und Notion |
| Ziele & Habits | Ziele mit Fortschritt, Habit-Heatmap (8 Wochen), Streaks und Rekorde |
| Gesundheit | Wasser, Protein, Schritte, Schlaf, Trainingsplan, 14-Tage-Verläufe |
| Finanzen | Monatsbilanz, Budget je Kategorie, Buchungen, Abos, Investments |
| Studium & Content | Prüfungs-Countdown, Stundenplan, Content-Pipeline |
| Wochen-Review | Wochenstatistik und gespeicherte Auswertungen von Jarvis |

## Vercel-Einrichtung

Umgebungsvariablen im Vercel-Projekt `lifeos` (Settings → Environment Variables):

| Variable | Zweck |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Datenbank. Werden gesetzt, wenn du unter Storage „Upstash Redis“ mit dem Projekt verbindest. |
| `APP_PASSWORD` | Dein Login-Passwort. Ändern meldet alle Geräte ab. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth-Client (Webanwendung) aus der Google Cloud Console. Weiterleitungs-URL: `https://lifeos-cristian.vercel.app/api/google/callback`. Gmail API und Calendar API müssen aktiviert sein. |
| `NOTION_TOKEN` | Schlüssel einer internen Notion-Integration (nur Lesen). Seiten in Notion über „Verbindungen“ mit der Integration teilen. |
| `ANTHROPIC_API_KEY` | Optional, für den Jarvis-Chat auf Vercel. |
| `APP_URL` | Optional. Feste Basis-URL für die Google-Weiterleitung, falls du eine eigene Domain nutzt. |

Google und Notion sind nur lesend verbunden. Der Google-Refresh-Token liegt serverseitig in Redis, nie im Browser.

## Entwicklung

- `npm run build` schreibt `dist/` (Seite mit HTML-Gerüst, Favicon und Logo).
- `npm test` testet die API-Funktionen offline mit simulierten Antworten von Redis, Google und Notion.
- Jeder Push auf den Production-Branch wird von Vercel automatisch deployt.
- Das Artifact aktualisierst du über Claude Code mit dem Artifact-Tool auf derselben URL. Die gespeicherten Daten bleiben dabei erhalten.

## Datenmodell

`config/main`, `days/<YYYY-MM-DD>`, `plan/week`, `months/<YYYY-MM>`, `goals/*`, `subscriptions/*`, `investments/*`, `exams/*`, `schedule/*`, `content/*`, `reviews/<YYYY-Www>`
