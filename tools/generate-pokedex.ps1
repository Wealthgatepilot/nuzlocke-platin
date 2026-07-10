<#
  generate-pokedex.ps1
  Erzeugt pokedex.js aus der PokeAPI (pokeapi.co), Datenstand version-group "platinum".

  Pro Pokemon: id, name (de), nameEn, types (de), evolution, levelUpMoves, machineMoves.

  Caching:    alle API-Antworten werden als JSON auf Platte gecacht (Re-Runs nutzen Cache).
  Throttling: ~80 ms Pause vor jedem ECHTEN Netz-Request.
  Robust:     fehlende Daten werden uebersprungen/markiert (_incomplete) statt zu crashen.

  Beispiele:
    powershell -File generate-pokedex.ps1 -StartId 1 -EndId 5 -OutFile ..\sample.js
    powershell -File generate-pokedex.ps1            # voller Lauf 1..493 -> ..\pokedex.js
#>
param(
  [int]$StartId = 1,
  [int]$EndId = 493,
  [string]$OutFile,
  [string]$CacheDir = (Join-Path $env:TEMP 'pokeapi-cache'),
  [int]$ThrottleMs = 80
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = 'https://pokeapi.co/api/v2'

# Gen-4-Fangraten-Overrides: in ORAS (Gen 6) auf 3 geaendert; PokeAPI liefert nur den neuen Wert.
# Betroffene National-Dex 1..493: Kyogre 382, Groudon 383 (je 5), Dialga 483, Palkia 484 (je 30).
$GEN4_CATCH = @{ 382 = 5; 383 = 5; 483 = 30; 484 = 30 }

# Gen-4-Basiswerte-Overrides: in Gen 6 (X/Y) gebufft; PokeAPI liefert nur die neuen Werte.
# Reihenfolge je Array: HP, Angriff, Verteidigung, Sp.-Angriff, Sp.-Verteidigung, Initiative. (Quelle: Serebii updatedstats)
$GEN4_STATS = @{
  12=@(60,45,50,80,80,70);   15=@(65,80,40,45,80,75);   18=@(83,80,75,70,70,91)
  25=@(35,55,30,50,40,90);   26=@(60,90,55,90,80,100);  31=@(90,82,87,75,85,76)
  34=@(81,92,77,85,75,85);   36=@(95,70,73,85,90,60);   40=@(140,70,45,75,50,45)
  45=@(75,80,85,100,90,50);  62=@(90,85,95,70,90,70);   65=@(55,50,45,135,85,120)
  71=@(80,105,65,100,60,70); 76=@(80,110,130,55,65,45); 181=@(90,75,75,115,90,55)
  182=@(75,80,85,90,100,50); 184=@(100,50,80,50,80,50); 189=@(75,55,70,55,85,110)
  267=@(60,70,50,90,50,65);  295=@(104,91,63,91,63,68); 398=@(85,120,70,50,50,100)
  407=@(60,70,55,125,105,90)
}

if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
if (-not $OutFile) { $OutFile = Join-Path $PSScriptRoot '..\pokedex.js' }

# --- In-Memory-Memo-Caches ---
$script:typeDe    = @{}   # type-name    -> de
$script:itemDe    = @{}   # item-name    -> de
$script:moveInfo  = @{}   # move-name    -> @{ de=...; machine=... }
$script:speciesDe = @{}   # species-name -> de

# Statistik
$script:netCount = 0

# --- Cache-Dateiname aus URL ---
function Get-CacheName($url) {
  $p = $url -replace '^https?://pokeapi\.co/api/v2/', ''
  $p = $p.TrimEnd('/')
  $p = $p -replace '[^A-Za-z0-9]+', '_'
  return (Join-Path $CacheDir ($p + '.json'))
}

# --- Robuster GET mit Cache + Retry ---
function Get-Api($url) {
  $cf = Get-CacheName $url
  if (Test-Path $cf) {
    try { return ([System.IO.File]::ReadAllText($cf, [System.Text.Encoding]::UTF8) | ConvertFrom-Json) } catch {}
  }
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      Start-Sleep -Milliseconds $ThrottleMs
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30
      $bytes = $resp.RawContentStream.ToArray()
      $content = [System.Text.Encoding]::UTF8.GetString($bytes)
      $script:netCount++
      # UTF-8 ohne BOM schreiben
      [System.IO.File]::WriteAllText($cf, $content, (New-Object System.Text.UTF8Encoding($false)))
      return ($content | ConvertFrom-Json)
    } catch {
      if ($attempt -ge 3) { throw }
      Start-Sleep -Milliseconds (400 * $attempt)
    }
  }
}

# --- Deutschen Namen aus names[]-Array ziehen ---
function Get-DeName($namesArray, $fallback) {
  if ($namesArray) {
    foreach ($n in $namesArray) {
      if ($n.language.name -eq 'de') { return $n.name }
    }
  }
  return $fallback
}

function Get-TypeDe($name) {
  if ($script:typeDe.ContainsKey($name)) { return $script:typeDe[$name] }
  $t = Get-Api "$base/type/$name"
  $de = Get-DeName $t.names $name
  $script:typeDe[$name] = $de
  return $de
}

function Gen-Num($genName) {
  switch ($genName) {
    'generation-i'    { return 1 }
    'generation-ii'   { return 2 }
    'generation-iii'  { return 3 }
    'generation-iv'   { return 4 }
    'generation-v'    { return 5 }
    'generation-vi'   { return 6 }
    'generation-vii'  { return 7 }
    'generation-viii' { return 8 }
    'generation-ix'   { return 9 }
    default { return 99 }
  }
}

# Gen-4-Typen ueber past_types (Fee-Umtypungen ab Gen 6 rueckgaengig machen)
function Get-Gen4Types($p) {
  $chosen = $null
  if ($p.past_types) {
    $bestNum = 999; $best = $null
    foreach ($pt in $p.past_types) {
      $gn = Gen-Num $pt.generation.name
      if ($gn -ge 4 -and $gn -lt $bestNum) { $bestNum = $gn; $best = $pt }
    }
    if ($best) { $chosen = $best.types }
  }
  if (-not $chosen) { $chosen = $p.types }
  return @($chosen | Sort-Object { $_.slot } | ForEach-Object { $_.type.name })
}

function Get-ItemDe($name) {
  if (-not $name) { return $null }
  if ($script:itemDe.ContainsKey($name)) { return $script:itemDe[$name] }
  $it = Get-Api "$base/item/$name"
  $de = Get-DeName $it.names $name
  $script:itemDe[$name] = $de
  return $de
}

function Get-SpeciesDe($name) {
  if ($script:speciesDe.ContainsKey($name)) { return $script:speciesDe[$name] }
  $sp = Get-Api "$base/pokemon-species/$name"
  $de = Get-DeName $sp.names $name
  $script:speciesDe[$name] = $de
  return $de
}

$script:locDe = @{}
function Get-LocationDe($name) {
  if (-not $name) { return $null }
  if ($script:locDe.ContainsKey($name)) { return $script:locDe[$name] }
  $de = $name
  try {
    $loc = Get-Api "$base/location/$name"
    $de = Get-DeName $loc.names $null
    if (-not $de) {
      # Fallback: aus dem Bezeichner einen lesbaren Namen machen
      $de = ((($name -replace '-', ' ').Trim()) -split ' ' | ForEach-Object {
        if ($_.Length -gt 0) { $_.Substring(0,1).ToUpper() + $_.Substring(1) } else { $_ } }) -join ' '
    }
  } catch {}
  $script:locDe[$name] = $de
  return $de
}

# --- Move-Info: deutscher Name + TM/VM-Nummer (platinum) ---
function Get-MoveInfo($moveName) {
  if ($script:moveInfo.ContainsKey($moveName)) { return $script:moveInfo[$moveName] }
  $m = Get-Api "$base/move/$moveName"
  $de = Get-DeName $m.names $moveName
  $machine = $null
  if ($m.machines) {
    foreach ($mc in $m.machines) {
      if ($mc.version_group.name -eq 'platinum') {
        try {
          $machObj = Get-Api $mc.machine.url
          $itemName = $machObj.item.name   # z.B. tm03 / hm03
          if ($itemName -match '^(tm|hm)(\d+)$') {
            $kind = if ($matches[1] -eq 'hm') { 'VM' } else { 'TM' }
            $machine = ('{0}{1:D2}' -f $kind, [int]$matches[2])
          } else {
            $machine = $itemName.ToUpper()
          }
        } catch {}
        break
      }
    }
  }
  $info = @{ de = $de; machine = $machine }
  $script:moveInfo[$moveName] = $info
  return $info
}

# --- Knoten fuer species in der Evolution-Chain finden ---
function Find-ChainNode($node, $speciesName) {
  if ($node.species.name -eq $speciesName) { return $node }
  foreach ($child in $node.evolves_to) {
    $r = Find-ChainNode $child $speciesName
    if ($r) { return $r }
  }
  return $null
}

# --- Lesbaren deutschen Evolutions-Text bauen ---
function Build-EvoText($d) {
  $trigger = $d.trigger.name
  $parts = @()
  switch ($trigger) {
    'level-up' {
      if ($d.min_level) { $parts += ('ab Lv. {0}' -f [int]$d.min_level) }
      else { $parts += 'Level-Aufstieg' }
    }
    'use-item' {
      $itemDe = Get-ItemDe $d.item.name
      if ($itemDe) { $parts += $itemDe } else { $parts += 'Item benutzen' }
    }
    'trade' {
      $parts += 'Tausch'
      if ($d.held_item) { $parts += ('mit ' + (Get-ItemDe $d.held_item.name)) }
    }
    default { $parts += $trigger }
  }
  if ($d.min_happiness)      { $parts += ('Freundschaft >= ' + [int]$d.min_happiness) }
  if ($d.min_beauty)         { $parts += 'hohe Schoenheit' }
  if ($d.time_of_day -eq 'day')   { $parts += '(Tag)' }
  if ($d.time_of_day -eq 'night') { $parts += '(Nacht)' }
  if ($d.known_move)         { $parts += ('kennt ' + (Get-MoveInfo $d.known_move.name).de) }
  if ($d.held_item -and $trigger -ne 'trade') { $parts += ('haelt ' + (Get-ItemDe $d.held_item.name)) }
  if ($d.location)           { $parts += ('bei ' + (Get-LocationDe $d.location.name)) }
  if ($d.needs_overworld_rain) { $parts += '(bei Regen)' }
  if ($d.gender -eq 1)       { $parts += '(Weibchen)' }
  if ($d.gender -eq 2)       { $parts += '(Maennchen)' }
  return ($parts -join ' ')
}

# --- JS-String escapen ---
function Esc($s) {
  if ($null -eq $s) { return '' }
  return ($s -replace '\\', '\\' -replace '"', '\"')
}

# --- Lookup-Key normalisieren (muss app.js spiegeln) ---
function Norm($s) {
  if ($null -eq $s) { return '' }
  return (($s.ToLower().Trim()) -replace '\s+', ' ')
}

# ============================ Hauptlauf ============================
$entries = @()      # geordnete Liste der erzeugten JS-Bloecke
$aliases = @()      # "en":"key"
$incompleteList = @()
$failed = @()

Write-Host ("Erzeuge Pokedex fuer id {0}..{1} ..." -f $StartId, $EndId)

for ($id = $StartId; $id -le $EndId; $id++) {
  try {
    $p  = Get-Api "$base/pokemon/$id"
    $sp = Get-Api $p.species.url

    $nameDe = Get-DeName $sp.names $p.name
    $nameEn = $p.name
    $incomplete = $false

    # --- Typen (de, Gen-4-Stand) ---
    $typesDe = @()
    foreach ($tn in (Get-Gen4Types $p)) {
      $typesDe += (Get-TypeDe $tn)
    }

    # --- Evolution ---
    $evo = @()
    try {
      $chain = (Get-Api $sp.evolution_chain.url).chain
      $node = Find-ChainNode $chain $sp.name
      if ($node) {
        foreach ($child in $node.evolves_to) {
          # Entwicklungs-Ziele ausserhalb des National-Dex (Nr. > 493) gibt es in Platin nicht
          $childId = 0
          if ($child.species.url -match '/pokemon-species/(\d+)/') { $childId = [int]$matches[1] }
          if ($childId -eq 0 -or $childId -gt 493) { continue }
          $d = $child.evolution_details[0]
          # Leere/triggerlose "Entwicklung" (PokeAPI-Quirk, z.B. Phione->Manaphy) ueberspringen
          if (-not $d -or -not $d.trigger -or [string]::IsNullOrEmpty($d.trigger.name)) { continue }
          $toDe = Get-SpeciesDe $child.species.name
          $evo += [pscustomobject]@{
            to       = $toDe
            trigger  = $d.trigger.name
            minLevel = if ($d.min_level) { [int]$d.min_level } else { $null }
            item     = if ($d.item) { Get-ItemDe $d.item.name } else { $null }
            text     = Build-EvoText $d
          }
        }
      }
    } catch { $incomplete = $true }

    # --- Moves: erst platinum, sonst diamond-pearl ---
    function Collect-Moves($vg) {
      $lvl = @(); $mac = @()
      foreach ($mv in $p.moves) {
        $details = $mv.version_group_details | Where-Object { $_.version_group.name -eq $vg }
        if (-not $details) { continue }
        $info = Get-MoveInfo $mv.move.name
        foreach ($d in $details) {
          if ($d.move_learn_method.name -eq 'level-up') {
            $lvl += [pscustomobject]@{ level = [int]$d.level_learned_at; move = $info.de }
          } elseif ($d.move_learn_method.name -eq 'machine') {
            if ($info.machine) { $mac += [pscustomobject]@{ number = $info.machine; move = $info.de } }
          }
        }
      }
      return @{ lvl = $lvl; mac = $mac }
    }

    $mset = Collect-Moves 'platinum'
    if (($mset.lvl.Count + $mset.mac.Count) -eq 0) {
      $mset = Collect-Moves 'diamond-pearl'
      if (($mset.lvl.Count + $mset.mac.Count) -gt 0) { $incomplete = $true }
    }

    # level-up: dedupe (level,move), sort level dann name
    $lvlUp = $mset.lvl | Sort-Object level, move -Unique
    # machine: dedupe number, sort TM vor VM dann Nummer
    $macMoves = $mset.mac | Sort-Object number -Unique |
      Sort-Object @{ Expression = { if ($_.number -like 'VM*') { 1 } else { 0 } } },
                  @{ Expression = { [int]($_.number -replace '\D','') } }

    # --- JS-Block bauen ---
    $key = Norm $nameDe
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('  "').Append((Esc $key)).Append('": { ')
    [void]$sb.Append('id: ').Append($id).Append(', ')
    [void]$sb.Append('name: "').Append((Esc $nameDe)).Append('", ')
    [void]$sb.Append('nameEn: "').Append((Esc $nameEn)).Append('", ')
    [void]$sb.Append('types: [').Append((($typesDe | ForEach-Object { '"' + (Esc $_) + '"' }) -join ', ')).Append('], ')
    $capture = if ($GEN4_CATCH.ContainsKey($id)) { $GEN4_CATCH[$id] } elseif ($null -ne $sp.capture_rate) { [int]$sp.capture_rate } else { 0 }
    [void]$sb.Append('catchRate: ').Append($capture).Append(',')
    # Basiswerte (Gen-4-Override falls in Gen 6 geaendert)
    if ($GEN4_STATS.ContainsKey($id)) {
      $a = $GEN4_STATS[$id]; $bs = @{ hp=$a[0]; atk=$a[1]; def=$a[2]; spa=$a[3]; spd=$a[4]; spe=$a[5] }
    } else {
      $bs = @{ hp=0; atk=0; def=0; spa=0; spd=0; spe=0 }
      foreach ($s in $p.stats) {
        switch ($s.stat.name) {
          'hp'              { $bs.hp  = [int]$s.base_stat }
          'attack'          { $bs.atk = [int]$s.base_stat }
          'defense'         { $bs.def = [int]$s.base_stat }
          'special-attack'  { $bs.spa = [int]$s.base_stat }
          'special-defense' { $bs.spd = [int]$s.base_stat }
          'speed'           { $bs.spe = [int]$s.base_stat }
        }
      }
    }
    $bst = $bs.hp + $bs.atk + $bs.def + $bs.spa + $bs.spd + $bs.spe
    [void]$sb.Append(' baseStats: { hp: ' + $bs.hp + ', atk: ' + $bs.atk + ', def: ' + $bs.def + ', spa: ' + $bs.spa + ', spd: ' + $bs.spd + ', spe: ' + $bs.spe + ' }, bst: ' + $bst + ',')
    if ($incomplete) { [void]$sb.Append(' _incomplete: true,') }
    [void]$sb.Append("`n")

    # evolution
    [void]$sb.Append('    evolution: [')
    $evoStrs = @()
    foreach ($e in $evo) {
      $ml = if ($null -eq $e.minLevel) { 'null' } else { [string]$e.minLevel }
      $itm = if ($null -eq $e.item) { 'null' } else { '"' + (Esc $e.item) + '"' }
      $evoStrs += ('{ to: "' + (Esc $e.to) + '", trigger: "' + (Esc $e.trigger) + '", minLevel: ' + $ml + ', item: ' + $itm + ', text: "' + (Esc $e.text) + '" }')
    }
    [void]$sb.Append(($evoStrs -join ', ')).Append("],`n")

    # levelUpMoves
    [void]$sb.Append('    levelUpMoves: [')
    $lvlStrs = @()
    foreach ($m in $lvlUp) { $lvlStrs += ('{ level: ' + $m.level + ', move: "' + (Esc $m.move) + '" }') }
    [void]$sb.Append(($lvlStrs -join ', ')).Append("],`n")

    # machineMoves
    [void]$sb.Append('    machineMoves: [')
    $macStrs = @()
    foreach ($m in $macMoves) { $macStrs += ('{ number: "' + (Esc $m.number) + '", move: "' + (Esc $m.move) + '" }') }
    [void]$sb.Append(($macStrs -join ', ')).Append("]`n")

    [void]$sb.Append('  }')
    $entries += $sb.ToString()

    if ($nameEn -and (Norm $nameEn) -ne $key) { $aliases += ('  "{0}": "{1}"' -f (Esc (Norm $nameEn)), (Esc $key)) }
    if ($incomplete) { $incompleteList += ("#{0} {1}" -f $id, $nameDe) }

    Write-Host ("  [{0,3}] {1,-14} ev:{2} lvl:{3} tm:{4}{5}" -f $id, $nameDe, $evo.Count, $lvlUp.Count, $macMoves.Count, $(if($incomplete){' (!)'}else{''}))
  } catch {
    $failed += ("#{0}: {1}" -f $id, $_.Exception.Message)
    Write-Host ("  [{0,3}] FEHLER: {1}" -f $id, $_.Exception.Message) -ForegroundColor Red
  }
}

# --- Gen-4-Typentabelle bauen (17 Typen, ohne Fee; Stahl resistiert Geist & Unlicht) ---
$STD_TYPES = @('normal','fire','water','grass','electric','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel')
$chartRaw = @{}
foreach ($a in $STD_TYPES) {
  $t = Get-Api "$base/type/$a"
  $rel = @{}
  foreach ($x in $t.damage_relations.double_damage_to) { if ($STD_TYPES -contains $x.name) { $rel[$x.name] = '2' } }
  foreach ($x in $t.damage_relations.half_damage_to)   { if ($STD_TYPES -contains $x.name) { $rel[$x.name] = '0.5' } }
  foreach ($x in $t.damage_relations.no_damage_to)     { if ($STD_TYPES -contains $x.name) { $rel[$x.name] = '0' } }
  $chartRaw[$a] = $rel
}
# Gen-4-Korrektur (Steel-Nerf kam erst Gen 6):
$chartRaw['ghost']['steel'] = '0.5'
$chartRaw['dark']['steel']  = '0.5'

$typeLines = @()
foreach ($a in $STD_TYPES) {
  $pairs = @()
  foreach ($d in $chartRaw[$a].Keys) {
    $pairs += ('"' + (Esc (Get-TypeDe $d)) + '": ' + $chartRaw[$a][$d])
  }
  $typeLines += ('  "' + (Esc (Get-TypeDe $a)) + '": { ' + ($pairs -join ', ') + ' }')
}
$typesDeList = (($STD_TYPES | ForEach-Object { '"' + (Esc (Get-TypeDe $_)) + '"' }) -join ', ')

# --- Datei schreiben ---
$out = New-Object System.Text.StringBuilder
[void]$out.Append("// AUTO-GENERIERT aus der PokeAPI (version-group: platinum). Nicht von Hand editieren.`n")
[void]$out.Append("// Erzeugt von tools/generate-pokedex.ps1`n")
[void]$out.Append(("// Eintraege: {0}  |  unvollstaendig: {1}  |  fehlgeschlagen: {2}`n`n" -f $entries.Count, $incompleteList.Count, $failed.Count))
[void]$out.Append("const POKEDEX = {`n")
[void]$out.Append(($entries -join ",`n"))
[void]$out.Append("`n};`n`n")
[void]$out.Append("const POKEDEX_ALIASES = {`n")
[void]$out.Append(($aliases -join ",`n"))
[void]$out.Append("`n};`n`n")
[void]$out.Append("// Gen-4-Typentabelle: TYPECHART[Angriffstyp][Verteidigungstyp] = Multiplikator (nur != 1)`n")
[void]$out.Append("const TYPECHART = {`n")
[void]$out.Append(($typeLines -join ",`n"))
[void]$out.Append("`n};`n`n")
[void]$out.Append("const TYPES_DE = [" + $typesDeList + "];`n`n")
[void]$out.Append("if (typeof module !== 'undefined') { module.exports = { POKEDEX, POKEDEX_ALIASES, TYPECHART, TYPES_DE }; }`n")

[System.IO.File]::WriteAllText($OutFile, $out.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host ("Fertig. {0} Eintraege -> {1}" -f $entries.Count, $OutFile) -ForegroundColor Green
Write-Host ("Netz-Requests: {0} (Rest aus Cache: {1})" -f $script:netCount, $CacheDir)
if ($incompleteList.Count) { Write-Host ("Unvollstaendig ({0}): {1}" -f $incompleteList.Count, ($incompleteList -join ', ')) -ForegroundColor Yellow }
if ($failed.Count)         { Write-Host ("Fehlgeschlagen ({0}): {1}" -f $failed.Count, ($failed -join '; ')) -ForegroundColor Red }
