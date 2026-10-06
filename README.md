# Jarvis – persönliches Lebens-Dashboard

Live: https://claude.ai/artifact/WUF8y1CoqbaiANbhBpCfbv (privat, nur für den Besitzer)

`index.html` ist der Quellcode der Artifact-Seite auf claude.ai. Die Seite läuft ohne eigenen Server und nutzt diese Funktionen der Artifact-Laufzeit:

- **db:** speichert alle Einträge. Lesen und Schreiben ist nur für den Besitzer erlaubt.
- **mcp:** Live-Daten aus Google Calendar (`list_events`), Gmail (`search_threads`) und Notion (`notion-search`).
- **sample:** der Jarvis-Chat, das Morgen-Briefing und das Wochen-Review.

## Bereiche

| Tab | Inhalt |
| --- | --- |
| Heute | Briefing, Habits mit Streaks, Top-3-Prioritäten, Termine (7 Tage), ungelesene Mails |
| Ziele & Habits | Ziele mit Fortschritt, Habit-Heatmap (8 Wochen), Streaks und Rekorde |
| Gesundheit | Wasser, Protein, Schritte, Schlaf, Aufstehzeit, Wochen-Trainingsplan, 14-Tage-Verläufe |
| Finanzen | Monatsbilanz, Budget je Kategorie, Buchungen, Abos, Investments |
| Studium & Content | Prüfungs-Countdown, Stundenplan, Content-Pipeline (Idee → Gepostet), Notion-Seiten |
| Wochen-Review | Wochenstatistik und gespeicherte Auswertungen von Jarvis |

## Datenmodell (db)

`config/main`, `days/<YYYY-MM-DD>`, `plan/week`, `months/<YYYY-MM>`, `goals/*`, `subscriptions/*`, `investments/*`, `exams/*`, `schedule/*`, `content/*`, `reviews/<YYYY-Www>`

## Aktualisieren

`index.html` bearbeiten und über Claude Code mit dem Artifact-Tool erneut auf dieselbe URL veröffentlichen. Die gespeicherten Daten bleiben dabei erhalten.
