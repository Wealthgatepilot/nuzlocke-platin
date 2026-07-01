<#
  build-my-run.ps1
  Erzeugt eine Import-/Backup-Datei (mein-run-backup.json) mit dem AKTUELLEN Run:
  - Routen in der vom Nutzer dokumentierten Reihenfolge (danach der v2-Rest, offen)
  - Statische/Fossilien/Honigbäume: nur die genannten Spezies gefüllt
  - Team automatisch aus allen "gefangenen" Einträgen (verknüpft via fromEncounter)

  Enthält NUR nz_encounters + nz_team -> Import überschreibt Checkpoints/Märkte NICHT.
#>
$ErrorActionPreference = 'Stop'
$OutFile = Join-Path (Join-Path $PSScriptRoot '..') 'mein-run-backup.json'

# ---- Routen (Reihenfolge = wie dokumentiert; dann v2-Rest offen) ----
# st: caught | failed | open
$routesDef = @(
  @{n='Wahrheitsufer';      sp='Sichlor';    st='caught'; note='Vorplatz See der Wahrheit'}
  @{n='Route 201';          sp='Pikachu';    st='caught'}
  @{n='Route 202';          sp='Ninjask';    st='caught'}
  @{n='Route 219';          sp='Azumarill';  st='caught'}
  @{n='Zweiblattdorf';      sp='Bronzel';    st='caught'; note='Angeln'}
  @{n='Route 204';          sp='Rihorn';     st='caught'}
  @{n='Route 203';          sp='Skuntank';   st='caught'}
  @{n='Erzelingen-Tor';     sp='Krawumms';   st='caught'; note='Höhle'}
  @{n='Erzelingen-Mine';    sp='Despotar';   st='caught'; note='Höhle'}
  @{n='Route 207';          sp='Mauzi';      st='caught'}
  @{n='Verwüsteter Pfad';   sp='Arkani';     st='caught'; note='Höhle'}
  @{n='Kraftwerk';          sp='Papungha';   st='caught'; note='Valley Windworks'}
  @{n='Route 205';          sp='Sandamer';   st='caught'}
  @{n='Ewigwald';           sp='Arceus';     st='caught'; note='Eterna Forest'}
  @{n='Altes Anwesen';      sp='Tuska';      st='caught'; note='Old Chateau'}
  @{n='Ewigenau';           sp='Frosdedje';  st='caught'; note='Angeln'}
  @{n='Route 211 (West)';   sp='Baldorfish'; st='caught'}
  @{n='Route 206';          sp='Honweisel';  st='caught'}
  @{n='Bizarre Höhle';      sp='Magnayen';   st='caught'; note='Wayward Cave'}
  @{n='Kraterberg';         sp='Omot';       st='caught'; note='Mt. Coronet'}
  @{n='Route 208';          sp='Pionskora';  st='caught'}
  @{n='Route 209';          sp='Manaphy';    st='caught'}
  @{n='Trostu-Ruinen';      sp='';           st='failed'; note='Icognito'}
  @{n='Turm der Ruhenden';  sp='Bojelin';    st='failed'; note='Lost Tower'}
  @{n='Route 210 (Süd)';    sp='Lavados';    st='caught'}
  @{n='Route 215';          sp='Tauboss';    st='failed'}
  @{n='Route 214';          sp='Makuhita';   st='caught'}
  @{n='Maniac-Tunnel';      sp='Bibor';      st='caught'}
  # --- Frontier (offen), in deiner Reihenfolge ---
  @{n='Kühnheitsufer';      sp='';           st='open';   note='Vorplatz See der Kühnheit'}
  @{n='Route 213';          sp='';           st='open'}
  @{n='Weideburg';          sp='';           st='open';   note='Stadt – Angeln'}
  @{n='Route 212 (Süd)';    sp='';           st='open'}
  @{n='Route 210 (Nord)';   sp='';           st='open'}
  @{n='Elyses';             sp='';           st='open';   note='Stadt – Angeln'}
  @{n='Route 211 (Ost)';    sp='';           st='open'}
  @{n='Route 218';          sp='';           st='open'}
  @{n='Fleetburg';          sp='';           st='open';   note='Stadt – Angeln'}
  @{n='Eiseninsel';         sp='';           st='open';   note='Iron Island'}
  @{n='Feurio-Hütte';       sp='';           st='open';   note='Fuego Ironworks'}
  # --- Rest in v2-Reihenfolge (noch nicht erreicht), offen ---
  @{n='Großmoor';           sp='';           st='open';   note='Safari-Zone'}
  @{n='Route 212 (Nord)';   sp='';           st='open'}
  @{n='Trophäengarten';     sp='';           st='open'}
  @{n='Route 220';          sp='';           st='open';   note='Surfen'}
  @{n='Route 221';          sp='';           st='open'}
  @{n='Route 216';          sp='';           st='open'}
  @{n='Route 217';          sp='';           st='open'}
  @{n='Stärkeufer';         sp='';           st='open';   note='Vorplatz See der Stärke'}
  @{n='Route 222';          sp='';           st='open'}
  @{n='Sonnewik';           sp='';           st='open';   note='Stadt – Angeln'}
  @{n='Route 223';          sp='';           st='open';   note='Surfen'}
  @{n='Siegesstraße';       sp='';           st='open';   note='Victory Road'}
  @{n='Route 224';          sp='';           st='open';   note='Post-Game'}
  @{n='Route 225';          sp='';           st='open';   note='Post-Game'}
  @{n='Route 226';          sp='';           st='open';   note='Post-Game'}
  @{n='Route 227';          sp='';           st='open';   note='Post-Game'}
  @{n='Kahlberg';           sp='';           st='open';   note='Post-Game · Stark Mountain'}
  @{n='Route 228';          sp='';           st='open';   note='Post-Game'}
  @{n='Route 229';          sp='';           st='open';   note='Post-Game'}
  @{n='Erholungsareal';     sp='';           st='open';   note='Post-Game'}
  @{n='Route 230';          sp='';           st='open';   note='Post-Game'}
  @{n='Scheidequelle';      sp='';           st='open';   note='Post-Game'}
  @{n='Höhle der Umkehr';   sp='';           st='open';   note='Post-Game'}
)

# ---- Statische Encounter (Standardliste; nur Rotom gefüllt) ----
$staticDef = @(
  @{n='Driftlon – Kraftwerk Blütenhain';  note='Freitags nach Mars-Kampf, Lv 15'; sp='';           st='open'}
  @{n='Rotom – Altes Herrenhaus';          note='Nachts, Lv 20';                   sp='Schlukwech'; st='caught'}
  @{n='Spiritomb – Heiliger Turm';         note='Route 209, Lv 25';                sp='';           st='open'}
  @{n='Selfe – See der Stärke';            note='Lv 50 (Lake Acuity)';             sp='';           st='open'}
  @{n='Vesprit – See der Wahrheit';        note='Roamend, Lv 50 (Lake Verity)';    sp='';           st='open'}
  @{n='Tobutz – See der Kühnheit';         note='Lv 50 (Lake Valor)';              sp='';           st='open'}
  @{n='Giratina – Zerrwelt';               note='Lv 47';                           sp='';           st='open'}
  @{n='Dialga – Speerspitze';              note='Post-Game, Lv 70';                sp='';           st='open'}
  @{n='Palkia – Speerspitze';              note='Post-Game, Lv 70';                sp='';           st='open'}
  @{n='Heatran – Kahlberg';                note='Post-Game, Lv 50';                sp='';           st='open'}
  @{n='Regigigas – Blizzach-Tempel';       note='Lv 1';                            sp='';           st='open'}
  @{n='Regirock – Felsengipfel-Ruine';     note='Lv 30';                           sp='';           st='open'}
  @{n='Regice – Eisberg-Ruine';            note='Lv 30';                           sp='';           st='open'}
  @{n='Registeel – Eisen-Ruine';           note='Lv 30';                           sp='';           st='open'}
  @{n='Cresselia – Vollmondinsel';         note='Roamend, Lv 50';                  sp='';           st='open'}
  @{n='Arktos – Sinnoh (Roamend)';         note='Lv 60';                           sp='';           st='open'}
  @{n='Zapdos – Sinnoh (Roamend)';         note='Lv 60';                           sp='';           st='open'}
  @{n='Lavados – Sinnoh (Roamend)';        note='Lv 60';                           sp='';           st='open'}
)

# ---- Fossilien (Standardliste; deine 3 gefüllt) ----
$fossilDef = @(
  @{n='Schädelstein → Koknodon';      note='Untergrund (ungerade Trainer-ID)'; sp='Pionskora'; st='caught'}
  @{n='Panzerstein → Schilditas';     note='Untergrund (gerade Trainer-ID)';   sp='';          st='open'}
  @{n='Spiralstein → Amonitas';       note='Untergrund (nach Nationaldex)';    sp='Traumato';  st='caught'}
  @{n='Kuppelstein → Kabuto';         note='Untergrund (nach Nationaldex)';    sp='Smogmog';   st='caught'}
  @{n='Uralt-Bernstein → Aerodactyl'; note='Untergrund (nach Nationaldex)';    sp='';          st='open'}
  @{n='Klauenstein → Liliep';         note='Untergrund (nach Nationaldex)';    sp='';          st='open'}
  @{n='Wurzelstein → Armaldo';        note='Untergrund (nach Nationaldex)';    sp='';          st='open'}
)

# ---- Honigbäume (3, wie dokumentiert) ----
$honeyDef = @(
  @{n='Honigbaum – Kraftwerk';  note=''; sp='Golbat';   st='caught'}
  @{n='Honigbaum – Route 205';  note=''; sp='';         st='open'}
  @{n='Honigbaum – Flori';      note=''; sp='Granbull';  st='caught'}
)

# ---- Aufbau ----
function Build-List($def, $prefix) {
  $i = 0; $out = @()
  foreach ($e in $def) {
    $i++
    $id = ('{0}{1:D2}' -f $prefix, $i)
    $o = [ordered]@{ id = $id; name = $e.n; species = $e.sp; status = $e.st }
    if ($e.note) { $o.note = $e.note }
    $out += [pscustomobject]$o
  }
  return ,$out
}

$routes  = Build-List $routesDef 'r'
$statics = Build-List $staticDef 's'
$fossils = Build-List $fossilDef 'f'
$honey   = Build-List $honeyDef  'h'

# Team aus allen "caught"+Spezies-Einträgen (verknüpft via fromEncounter)
$team = @()
foreach ($cat in @($routes, $statics, $fossils, $honey)) {
  foreach ($e in $cat) {
    if ($e.status -eq 'caught' -and $e.species -and $e.species.Trim()) {
      $team += [pscustomobject][ordered]@{
        id            = ('t' + $e.id)
        species       = $e.species
        fromEncounter = $e.id
        origin        = $e.name
      }
    }
  }
}

$backup = [ordered]@{
  _meta = [ordered]@{ app = 'nuzlocke-platin'; version = 1; note = 'Aktueller Run-Import (Routen + Team). Ueberschreibt Checkpoints/Maerkte NICHT.'; exported = (Get-Date).ToString('s') }
  nz_encounters = [ordered]@{ routes = $routes; static = $statics; fossils = $fossils; honeyTrees = $honey }
  nz_team = $team
}

$json = $backup | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ("Geschrieben: {0}" -f $OutFile)
Write-Host ("Routen: {0}  |  gefangen: {1}  |  gescheitert: {2}" -f $routes.Count, ($routes | Where-Object {$_.status -eq 'caught'}).Count, ($routes | Where-Object {$_.status -eq 'failed'}).Count)
Write-Host ("Team-Mitglieder: {0}" -f $team.Count)
