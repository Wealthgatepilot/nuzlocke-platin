# Nuzlocke Tracker – Pokémon Platin (Randomizer)

Mobile-first PWA als persönlicher Tracker für eine Pokémon-Platin-Randomizer-Nuzlocke.
Reines HTML/CSS/JS, **kein Build-Schritt**, läuft direkt über GitHub Pages und ist offline-/installierbar.

## Funktionen
- **Fortschritt:** geordnete Checkpoint-Liste (Arenen + Barry-Kämpfe), abhakbar; steuert den angezeigten Level-Cap.
- **Team:** Pokémon mit Spitzname & Spezies; ℹ️ zeigt Entwicklung + Level-/TM-Attacken (Original-Platin-Daten).
- **Begegnungen:** Routen, statische Encounter, Fossilien, Honigbäume – je mit Status (Offen/Gefangen/Gescheitert) und Fortschrittszähler.
- **Märkte:** pro Stadt frei eintragbare Item-Liste.
- **Backup:** Export/Import als JSON. Daten liegen lokal im `localStorage`.
- Alle vorbefüllten Listen sind im UI editierbar (Randomizer-tauglich).

## Dateien
| Datei | Zweck |
|-------|-------|
| `index.html`, `style.css`, `app.js` | App |
| `data.js` | Spiel-Defaults (Checkpoints, Orte, Fossilien, Märkte) |
| `pokedex.js` | Auto-generierte Gen-4-Daten (Entwicklung, Attacken, TM/VM) |
| `manifest.json`, `sw.js`, `icon.svg` | PWA / Offline |
| `tools/generate-pokedex.ps1` | Generator für `pokedex.js` (nur Entwicklung) |

## `pokedex.js` neu erzeugen
Daten stammen aus der [PokéAPI](https://pokeapi.co) (Datenstand version-group *platinum*), gecacht unter `%TEMP%\pokeapi-cache`.

```powershell
# voller Lauf (alle 493):
powershell -ExecutionPolicy Bypass -File tools/generate-pokedex.ps1
# Testbereich:
powershell -ExecutionPolicy Bypass -File tools/generate-pokedex.ps1 -StartId 1 -EndId 5 -OutFile sample.js
```

Der `tools/`-Ordner und `.ps1` werden von GitHub Pages ignoriert und stören die App nicht.

## Datenquellen
Spieldaten (Arenen-/Barry-Level, Orte, deutsche Namen) aus Bulbapedia, Serebii und PokéWiki; Pokémon-Lerndaten aus der PokéAPI.
Da es ein Randomizer ist, sind **nur Spezies** zufällig – alle vorbefüllten Werte sind im UI korrigierbar.
