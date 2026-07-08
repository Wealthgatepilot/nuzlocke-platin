/* Nuzlocke Tracker – Platin
   Reines Vanilla-JS, State in localStorage. */
(function () {
  'use strict';

  // ===================== Storage =====================
  const KEYS = {
    checkpoints: 'nz_checkpoints',
    team:        'nz_team',
    encounters:  'nz_encounters',
    markets:     'nz_markets',
    settings:    'nz_settings',
  };

  const state = {};
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function load() {
    for (const k in KEYS) {
      const raw = localStorage.getItem(KEYS[k]);
      if (raw) { try { state[k] = JSON.parse(raw); continue; } catch (e) { /* fällt durch */ } }
      state[k] = clone(DEFAULT_DATA[k]);
      save(k);
    }
  }
  const save = k => localStorage.setItem(KEYS[k], JSON.stringify(state[k]));
  const saveAll = () => { for (const k in KEYS) save(k); };

  // ===================== Helfer =====================
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const normKey = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

  // ===================== Pokédex-Lookup =====================
  function dexLookup(species) {
    if (typeof POKEDEX === 'undefined') return null;
    const key = normKey(species);
    if (!key) return null;
    if (POKEDEX[key]) return POKEDEX[key];
    if (typeof POKEDEX_ALIASES !== 'undefined' && POKEDEX_ALIASES[key] && POKEDEX[POKEDEX_ALIASES[key]]) {
      return POKEDEX[POKEDEX_ALIASES[key]];
    }
    return null;
  }

  // ===================== Evolutions-Familien (Dupe-/Art-Klausel) =====================
  let FAMILY = null; // key -> { rep, members:[{key,name}] }
  let PREVO = null;  // key -> { key, name }  (Vorentwicklung)
  function speciesKey(species) {
    const d = dexLookup(species);
    return d ? normKey(d.name) : normKey(species);
  }
  function buildFamilyIndex() {
    FAMILY = {}; PREVO = {};
    if (typeof POKEDEX === 'undefined') return;
    const adj = {}, nameOf = {};
    for (const key in POKEDEX) {
      nameOf[key] = POKEDEX[key].name;
      adj[key] = adj[key] || new Set();
      (POKEDEX[key].evolution || []).forEach(e => {
        const tk = normKey(e.to);
        if (!tk) return;
        adj[key].add(tk);
        (adj[tk] = adj[tk] || new Set()).add(key);
        if (!nameOf[tk]) nameOf[tk] = (POKEDEX[tk] && POKEDEX[tk].name) || e.to;
        PREVO[tk] = { key: key, name: POKEDEX[key].name }; // key entwickelt sich zu tk
      });
    }
    const seen = new Set();
    for (const key in adj) {
      if (seen.has(key)) continue;
      const comp = [], stack = [key];
      seen.add(key);
      while (stack.length) {
        const n = stack.pop(); comp.push(n);
        (adj[n] || new Set()).forEach(m => { if (!seen.has(m)) { seen.add(m); stack.push(m); } });
      }
      // Entwicklungsstufe = Anzahl Vorentwicklungen; nach Stufe sortieren, dann Dex-Nr.
      const dep = k => { let d = 0, c = k, g = 0; while (PREVO[c] && g < 12) { c = PREVO[c].key; d++; g++; } return d; };
      const members = comp.map(k => ({ key: k, name: nameOf[k] || k }))
        .sort((a, b) => (dep(a.key) - dep(b.key)) || ((POKEDEX[a.key] ? POKEDEX[a.key].id : 999) - (POKEDEX[b.key] ? POKEDEX[b.key].id : 999)));
      const rep = comp.slice().sort()[0];
      comp.forEach(k => { FAMILY[k] = { rep, members }; });
    }
  }
  function familyOf(species) {
    const k = speciesKey(species);
    if (!k) return null;
    if (FAMILY && FAMILY[k]) return FAMILY[k];
    return { rep: k, members: [{ key: k, name: species }] }; // Unbekannt -> Einzeltier
  }
  function prevoOf(species) {
    const k = speciesKey(species);
    return (PREVO && PREVO[k]) ? PREVO[k] : null;
  }
  function allEncounters() {
    const e = state.encounters;
    return [...e.routes, ...e.static, ...e.fossils, ...e.honeyTrees, ...(e.gifts || [])];
  }
  function caughtSpeciesKeySet() {
    const s = new Set();
    allEncounters().forEach(x => { if (x.status === 'caught' && x.species && x.species.trim()) s.add(speciesKey(x.species)); });
    return s;
  }
  // Dupe-/Art-Klausel gilt NUR für Routen. Eine Routen-Begegnung, die aufgelöst ist
  // (gefangen ODER gescheitert), verbraucht die ganze Familie. Statisch/Honig/Fossil/
  // Geschenke sind komplett ausgenommen (weder Dupe noch verbrauchend).
  const ROUTE_CLAIM = x => (x.status === 'caught' || x.status === 'failed') && x.species && x.species.trim();
  function routeClaims() {
    const m = {}; // fam.rep -> id der ersten claimenden Routen-Begegnung
    state.encounters.routes.forEach(x => {
      if (ROUTE_CLAIM(x)) { const fam = familyOf(x.species); if (fam && m[fam.rep] === undefined) m[fam.rep] = x.id; }
    });
    return m;
  }
  function routeClaimedSpeciesKeys() {
    const s = new Set();
    state.encounters.routes.forEach(x => { if (ROUTE_CLAIM(x)) s.add(speciesKey(x.species)); });
    return s;
  }

  // ===================== Defensive Typ-Effektivität (Gen 4) =====================
  // Gibt { multiplikator: [Angriffstyp, ...] } für die übergebenen (Verteidigungs-)Typen zurück.
  function typeMatchups(types) {
    if (typeof TYPECHART === 'undefined' || typeof TYPES_DE === 'undefined' || !types || !types.length) return null;
    const groups = {};
    TYPES_DE.forEach(a => {
      let m = 1;
      types.forEach(t => { const row = TYPECHART[a]; if (row && row[t] !== undefined) m *= row[t]; });
      (groups[m] = groups[m] || []).push(a);
    });
    return groups;
  }

  // ===================== UI-Status =====================
  const ui = { tab: 'progress', subtab: 'routes', openMarkets: new Set(), teamSearch: '' };

  const ENC_CATS = {
    routes:     { label: 'Routen',     hasNote: false, honey: false },
    static:     { label: 'Statisch',   hasNote: true,  honey: false },
    fossils:    { label: 'Fossilien',  hasNote: true,  honey: false },
    honeyTrees: { label: 'Honigbäume', hasNote: false, honey: true  },
    gifts:      { label: 'Geschenke',  hasNote: true,  honey: false },
  };

  const STATUS = {
    open:   { label: 'Offen',      cls: 'open',   next: 'caught' },
    caught: { label: 'Gefangen',   cls: 'caught', next: 'failed' },
    failed: { label: 'Gescheitert', cls: 'failed', next: 'open' },
  };

  // ===================== Cap =====================
  const activeCheckpoint = () => state.checkpoints.find(c => !c.completed) || null;

  function renderCap() {
    const cp = activeCheckpoint();
    const el = $('#capDisplay');
    if (!cp) {
      el.className = 'cap-display postgame';
      el.innerHTML = '<span class="cap-lv">–</span> <span class="cap-name">Kein Cap (Post-Game)</span>';
      return;
    }
    el.className = 'cap-display';
    el.innerHTML =
      `Cap <span class="cap-lv">Lv ${cp.aceLevel}</span> <span class="cap-name">${esc(cp.label)}</span>` +
      `<span class="cap-rule">Nur 1 Pokémon darf Lv ${cp.aceLevel} erreichen · alle anderen ≤ Lv ${cp.aceLevel - 2}</span>`;
  }

  // ===================== Fortschritt =====================
  function renderProgress() {
    const list = $('#checkpointList');
    const active = activeCheckpoint();
    list.innerHTML = state.checkpoints.map((c, i) => {
      const meta = [c.location, c.gymType].filter(Boolean).join(' · ');
      const cls = ['card', 'cp-card'];
      if (c.completed) cls.push('done');
      else if (c === active) cls.push('active');
      return `<li class="${cls.join(' ')}">
        <button class="cp-check" data-action="cp-toggle" data-id="${c.id}">${c.completed ? '✓' : ''}</button>
        <div class="cp-main">
          <div class="cp-label">${esc(c.label)}${c === active ? '<span class="active-badge">AKTIV</span>' : ''}</div>
          <div class="cp-meta">${esc(meta)}</div>
        </div>
        <span class="cp-ace">Lv ${c.aceLevel}</span>
        <div class="cp-actions">
          <button class="mini-btn up"   data-action="cp-up"   data-id="${c.id}" ${i === 0 ? 'disabled style=opacity:.3' : ''}>▲</button>
          <button class="mini-btn down" data-action="cp-down" data-id="${c.id}" ${i === state.checkpoints.length - 1 ? 'disabled style=opacity:.3' : ''}>▼</button>
          <button class="mini-btn" data-action="cp-edit" data-id="${c.id}">✎</button>
          <button class="mini-btn" data-action="cp-del"  data-id="${c.id}">🗑</button>
        </div>
      </li>`;
    }).join('');
  }

  // ===================== Team =====================
  function renderTeam() {
    const list = $('#teamList');
    if (!state.team.length) {
      list.innerHTML = '<li class="card" style="color:var(--text-dim);text-align:center">Noch keine Pokémon. Setze eine Begegnung auf „Gefangen" oder tippe auf „+ Pokémon hinzufügen".</li>';
      return;
    }
    const q = (ui.teamSearch || '').toLowerCase().trim();
    const team = q ? state.team.filter(p => ((p.species || '') + ' ' + (p.nickname || '')).toLowerCase().includes(q)) : state.team;
    if (!team.length) {
      list.innerHTML = `<li class="card" style="color:var(--text-dim);text-align:center">Keine Treffer für „${esc(ui.teamSearch)}".</li>`;
      return;
    }
    list.innerHTML = team.map(p => {
      const hasSp = !!(p.species && p.species.trim());
      const evos = hasSp ? ((dexLookup(p.species) || {}).evolution || []) : [];
      const prevo = hasSp ? prevoOf(p.species) : null;
      const sub = [];
      if (p.origin) sub.push('gefangen: ' + esc(p.origin));
      if (p.nickname && p.nickname.trim()) sub.push('„' + esc(p.nickname) + '"');
      return `<li class="card team-card">
        <div class="team-main">
          <div class="team-nick ${hasSp ? '' : 'empty'}">${hasSp ? esc(p.species) : '(keine Spezies)'}</div>
          ${sub.length ? `<div class="team-species">${sub.join(' · ')}</div>` : ''}
        </div>
        ${evos.length ? `<button class="mini-btn evolve" data-action="team-evolve" data-id="${p.id}" title="Entwickeln">⬆️</button>` : ''}
        ${prevo ? `<button class="mini-btn devolve" data-action="team-devolve" data-id="${p.id}" title="Zurück-Entwickeln">⬇️</button>` : ''}
        ${hasSp ? `<button class="mini-btn" data-action="dex" data-species="${esc(p.species)}">ℹ️</button>` : ''}
        <button class="mini-btn" data-action="team-edit" data-id="${p.id}">✎</button>
        <button class="mini-btn" data-action="team-del"  data-id="${p.id}">🗑</button>
      </li>`;
    }).join('');
  }

  // ===================== Begegnungen =====================
  function renderEncounters() {
    // Sub-Tab-Leiste
    document.querySelectorAll('.subtab').forEach(b =>
      b.classList.toggle('active', b.dataset.subtab === ui.subtab));

    const cat = ENC_CATS[ui.subtab];
    const items = state.encounters[ui.subtab];

    // Fortschritt
    const caught = items.filter(x => x.status === 'caught').length;
    const failed = items.filter(x => x.status === 'failed').length;
    const open   = items.length - caught - failed;
    $('#encProgress').innerHTML =
      `<span class="pg-caught"><b>${caught}</b> gefangen</span>` +
      `<span class="pg-failed"><b>${failed}</b> gescheitert</span>` +
      `<span class="pg-open"><b>${open}</b> offen</span>` +
      `<span>Gesamt <b>${items.length}</b></span>`;

    // Honig-Steuerung
    const hc = $('#honeyControls');
    if (cat.honey) {
      const max = state.settings.honeyTreeMax;
      const over = items.length > max;
      hc.hidden = false;
      hc.innerHTML =
        `<div><span class="honey-count ${over ? 'over' : ''}">${items.length} / ${max}</span> Begegnungen
           ${over ? `<div class="honey-warn">⚠️ Du bist über dem Limit von ${max}.</div>` : ''}</div>
         <button class="mini-btn" data-action="honey-max" title="Limit ändern">⚙️</button>`;
    } else {
      hc.hidden = true;
    }

    // Liste
    const list = $('#encounterList');
    if (!items.length) {
      list.innerHTML = `<li class="card" style="color:var(--text-dim);text-align:center">Keine Einträge. Tippe unten auf „+ Eintrag hinzufügen".</li>`;
      return;
    }
    const isRoutes = ui.subtab === 'routes';
    const claims = isRoutes ? routeClaims() : null;
    const idName = {};
    if (isRoutes) state.encounters.routes.forEach(x => { idName[x.id] = x.name; });
    list.innerHTML = items.map(it => {
      const st = STATUS[it.status] || STATUS.open;
      const hasSp = !!(it.species && it.species.trim());
      let dupeHtml = '';
      if (isRoutes && hasSp) {
        const fam = familyOf(it.species);
        if (fam && claims[fam.rep] !== undefined && claims[fam.rep] !== it.id) {
          dupeHtml = `<div class="dupe-badge">⚠️ Dupe – Familie schon auf Route dran: ${esc(idName[claims[fam.rep]] || '?')}</div>`;
        }
      }
      return `<li class="card enc-card">
        <div class="enc-top">
          <div class="enc-name">${esc(it.name)}${it.note ? `<span class="enc-note">${esc(it.note)}</span>` : ''}</div>
          <button class="mini-btn" data-action="enc-edit" data-id="${it.id}">✎</button>
          <button class="mini-btn" data-action="enc-del"  data-id="${it.id}">🗑</button>
        </div>
        <div class="enc-row2">
          <input class="enc-species-input" type="text" placeholder="Spezies (randomisiert)…"
                 value="${esc(it.species)}" data-action="enc-species" data-id="${it.id}">
          ${hasSp ? `<button class="mini-btn" data-action="dex" data-species="${esc(it.species)}">ℹ️</button>` : ''}
          <button class="status-pill ${st.cls}" data-action="enc-status" data-id="${it.id}">${st.label}</button>
        </div>
        ${dupeHtml}
      </li>`;
    }).join('');
  }

  // ===================== Märkte =====================
  function renderMarkets() {
    const list = $('#marketList');
    if (!state.markets.length) {
      list.innerHTML = '<li class="card" style="color:var(--text-dim);text-align:center">Keine Städte.</li>';
      return;
    }
    list.innerHTML = state.markets.map(m => {
      const open = ui.openMarkets.has(m.id);
      const chips = (m.items || []).map((item, idx) =>
        `<span class="chip">${esc(item)}<button data-action="market-delitem" data-id="${m.id}" data-idx="${idx}">✕</button></span>`
      ).join('');
      return `<li class="card market-card ${open ? 'open' : ''}">
        <button class="market-head" data-action="market-toggle" data-id="${m.id}">
          <span class="market-town">${esc(m.town)}</span>
          <span class="market-count">${(m.items || []).length} Items</span>
          <span>${open ? '▲' : '▼'}</span>
        </button>
        <div class="market-body">
          <div class="chip-list">${chips || '<span style="color:var(--text-dim);font-size:.85rem">noch nichts eingetragen</span>'}</div>
          <div class="chip-add">
            <input type="text" placeholder="Item hinzufügen…" data-additem="${m.id}">
            <button class="mini-btn" data-action="market-additem" data-id="${m.id}">＋</button>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="tool-btn" data-action="market-rename" data-id="${m.id}">Stadt umbenennen</button>
            <button class="tool-btn" data-action="market-del" data-id="${m.id}">Stadt löschen</button>
          </div>
        </div>
      </li>`;
    }).join('');
  }

  // ===================== Pokédex-Modal =====================
  let dexStack = [];   // Navigations-Historie (Spezies-Namen)
  let dexCurrent = null;

  function openDex(species) {
    const overlay = $('#modalOverlay');
    if (overlay.hidden) dexStack = [];             // frisch geöffnet
    else if (dexCurrent) dexStack.push(dexCurrent); // innerhalb navigiert -> merken
    renderDexContent(species);
    overlay.hidden = false;
  }
  function dexBack() {
    const prev = dexStack.pop();
    if (prev) renderDexContent(prev);
  }

  function renderDexContent(species) {
    dexCurrent = species;
    const box = $('#modalContent');
    const backBtn = dexStack.length
      ? `<button class="dex-back" data-action="dex-back">‹ zurück zu ${esc(dexStack[dexStack.length - 1])}</button>`
      : '';
    const d = dexLookup(species);
    if (!d) {
      box.innerHTML = backBtn +
        `<div class="dex-head"><span class="dex-name">${esc(species)}</span></div>
         <div class="dex-notfound">Nicht in der Datenbank gefunden. Prüfe die Schreibweise (deutscher Name) oder schau online nach.</div>
         <a class="dex-link" target="_blank" rel="noopener"
            href="https://www.bulbapedia.bulbagarden.net/w/index.php?search=${encodeURIComponent(species)}">Auf Bulbapedia suchen ↗</a>`;
      return;
    }

    const types = d.types.map(t => `<span class="type-tag">${esc(t)}</span>`).join('');

    const evo = (d.evolution && d.evolution.length)
      ? d.evolution.map(e => `<div class="dex-evo"><b class="evo-link" data-action="dex" data-species="${esc(e.to)}">→ ${esc(e.to)} ›</b> <span class="evo-cond">${esc(e.text || '')}</span></div>`).join('')
      : '<div class="dex-empty">Entwickelt sich nicht weiter.</div>';

    const lvl = (d.levelUpMoves && d.levelUpMoves.length)
      ? `<table class="move-table">${d.levelUpMoves.map(m =>
          `<tr><td class="lv">${m.level === 1 ? 'Lv&nbsp;1' : 'Lv&nbsp;' + m.level}</td><td>${esc(m.move)}</td></tr>`).join('')}</table>`
      : '<div class="dex-empty">Keine Level-Attacken.</div>';

    const tm = (d.machineMoves && d.machineMoves.length)
      ? `<table class="move-table">${d.machineMoves.map(m =>
          `<tr><td class="tm">${esc(m.number)}</td><td>${esc(m.move)}</td></tr>`).join('')}</table>`
      : '<div class="dex-empty">Keine TM/VM-Attacken.</div>';

    const serebii = `https://www.serebii.net/pokedex-dp/${String(d.id).padStart(3, '0')}.shtml`;

    const fam = familyOf(d.name);
    const claimedSet = routeClaimedSpeciesKeys();
    const anyClaimed = fam.members.some(m => claimedSet.has(m.key));
    const famHtml =
      `<div class="dex-section-title">Evo-Familie · Dupe-Klausel (nur Routen)</div>` +
      (anyClaimed
        ? `<div class="dupe-banner">⚠️ Diese Familie war schon auf einer Route dran → Routen-Dupe (Reroll). Statisch/Honig/Fossil/Geschenk gehen weiter.</div>`
        : `<div class="ok-banner">✓ Familie noch frei – auf einer Route fangbar.</div>`) +
      `<div class="fam-list">${fam.members.map(m => {
        const cur = m.key === speciesKey(d.name);
        return `<span class="fam-member ${claimedSet.has(m.key) ? 'caught' : ''} ${cur ? 'current' : ''}"${cur ? '' : ` data-action="dex" data-species="${esc(m.name)}"`}>${claimedSet.has(m.key) ? '✓ ' : ''}${esc(m.name)}</span>`;
      }).join('')}</div>`;

    const mg = typeMatchups(d.types);
    let matchHtml = '';
    if (mg) {
      const order = [4, 2, 0.5, 0.25, 0];
      const label = { 4: '4× – sehr anfällig', 2: '2× – schwach', 0.5: '½× – resistent', 0.25: '¼× – stark resistent', 0: '0× – immun' };
      const cls = { 4: 'weak4', 2: 'weak2', 0.5: 'res2', 0.25: 'res4', 0: 'immune' };
      const rows = order.filter(x => mg[x] && mg[x].length).map(x =>
        `<div class="tm-row"><span class="tm-mult ${cls[x]}">${label[x]}</span>` +
        `<span class="tm-types">${mg[x].map(t => `<span class="tm-type">${esc(t)}</span>`).join('')}</span></div>`);
      if (mg[1] && mg[1].length) {
        rows.push(`<div class="tm-row"><span class="tm-mult neutral">1× – normal</span><span class="tm-neutral">${mg[1].map(t => esc(t)).join(', ')}</span></div>`);
      }
      matchHtml = `<div class="dex-section-title">Typ-Effektivität (Verteidigung)</div>${rows.join('')}`;
    }

    box.innerHTML = backBtn +
      `<div class="dex-head"><span class="dex-name">${esc(d.name)}</span><span class="dex-no">#${String(d.id).padStart(3, '0')}</span></div>
       <div class="dex-types">${types}</div>
       ${d._incomplete ? '<div class="dex-notfound" style="margin-bottom:8px">Hinweis: Daten teilweise aus Diamant/Perl (kein vollständiger Platin-Datensatz).</div>' : ''}
       ${matchHtml}
       ${famHtml}
       <div class="dex-section-title">Entwicklung</div>${evo}
       <div class="dex-section-title">Level-Attacken <span class="lv1-tag">(Lv 1 = von Beginn / nachlernbar)</span></div>${lvl}
       <div class="dex-section-title">TM / VM</div>${tm}
       <a class="dex-link" target="_blank" rel="noopener" href="${serebii}">Auf Serebii.net ansehen ↗</a>`;
  }
  const closeModal = () => { $('#modalOverlay').hidden = true; dexStack = []; dexCurrent = null; };

  // ===================== Generischer Prompt-Dialog =====================
  let promptCb = null;
  function openPrompt(title, fields, cb) {
    promptCb = cb;
    $('#promptTitle').textContent = title;
    $('#promptFields').innerHTML = fields.map(f => {
      if (f.type === 'select') {
        return `<div class="prompt-field"><label>${esc(f.label)}</label><select data-pk="${f.key}">${
          f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      }
      const t = f.type === 'number' ? 'number' : 'text';
      return `<div class="prompt-field"><label>${esc(f.label)}</label>
        <input data-pk="${f.key}" type="${t}" value="${esc(f.value == null ? '' : f.value)}"
          ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}></div>`;
    }).join('');
    $('#promptOverlay').hidden = false;
    const first = $('#promptFields').querySelector('input,select');
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closePrompt() { $('#promptOverlay').hidden = true; promptCb = null; }
  function submitPrompt() {
    const vals = {};
    $('#promptFields').querySelectorAll('[data-pk]').forEach(el => vals[el.dataset.pk] = el.value.trim());
    const cb = promptCb; closePrompt(); if (cb) cb(vals);
  }

  // ===================== Navigation =====================
  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === 'tab-' + tab));
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.nav === tab));
  }

  // Springt zur ersten noch offenen Begegnung der aktuellen Kategorie
  function scrollToFirstOpen() {
    const cards = document.querySelectorAll('#encounterList .enc-card');
    for (const c of cards) {
      const pill = c.querySelector('.status-pill');
      if (pill && pill.classList.contains('open')) { c.scrollIntoView({ block: 'center' }); return; }
    }
  }

  function renderAll() {
    renderCap();
    renderProgress();
    renderTeam();
    renderEncounters();
    renderMarkets();
  }

  // ===================== Export / Import / Reset =====================
  function exportData() {
    const dump = { _meta: { app: 'nuzlocke-platin', version: 1, exported: new Date().toISOString() } };
    for (const k in KEYS) dump[KEYS[k]] = state[k];
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuzlocke-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      let d;
      try { d = JSON.parse(r.result); }
      catch (e) { alert('Import fehlgeschlagen: Datei ist kein gültiges JSON.'); return; }
      const present = Object.values(KEYS).filter(k => d[k] != null);
      if (!present.length) { alert('Import fehlgeschlagen: keine bekannten Daten in der Datei.'); return; }
      if (!confirm('Aktuelle Daten mit diesem Backup überschreiben? Das kann nicht rückgängig gemacht werden.')) return;
      for (const k in KEYS) { if (d[KEYS[k]] != null) state[k] = d[KEYS[k]]; }
      ensureStructure(); saveAll(); renderAll();
      alert('Import erfolgreich.');
    };
    r.readAsText(file);
  }

  function newRun() {
    if (!confirm('NEUER RUN: Alle Pokémon, Begegnungen, Märkte und der Fortschritt werden gelöscht und auf die Standardwerte zurückgesetzt. Fortfahren?')) return;
    if (!confirm('Wirklich sicher? Tipp: Vorher per Export ein Backup sichern. Endgültig zurücksetzen?')) return;
    for (const k in KEYS) state[k] = clone(DEFAULT_DATA[k]);
    saveAll(); ui.openMarkets.clear(); renderAll(); switchTab('progress');
  }

  // ===================== Findhelfer =====================
  const findCp = id => state.checkpoints.find(c => c.id === id);
  const findTeam = id => state.team.find(p => p.id === id);
  const findEnc = id => state.encounters[ui.subtab].find(x => x.id === id);
  const findMarket = id => state.markets.find(m => m.id === id);
  function findEncAnywhere(id) {
    for (const cat of ['routes', 'static', 'fossils', 'honeyTrees', 'gifts']) {
      const f = state.encounters[cat].find(x => x.id === id);
      if (f) return f;
    }
    return null;
  }

  // Auto-Team-Sync: eine Begegnung auf "Gefangen" (mit Spezies) erscheint automatisch im Team.
  // Verknüpfte Team-Einträge tragen fromEncounter; manuell angelegte nicht.
  function syncTeamForEncounter(enc) {
    const idx = state.team.findIndex(p => p.fromEncounter === enc.id);
    const shouldExist = enc.status === 'caught' && enc.species && enc.species.trim();
    if (shouldExist) {
      if (idx === -1) state.team.push({ id: uid(), species: enc.species.trim(), fromEncounter: enc.id, origin: enc.name });
      else { state.team[idx].species = enc.species.trim(); state.team[idx].origin = enc.name; }
    } else if (idx !== -1) {
      state.team.splice(idx, 1);
    }
    save('team');
  }

  // ===================== Event-Handling =====================
  document.addEventListener('click', e => {
    // Backdrop-Klick schließt Modals
    if (e.target.id === 'modalOverlay') { closeModal(); return; }
    if (e.target.id === 'promptOverlay') { closePrompt(); return; }

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) { switchTab(navBtn.dataset.nav); if (navBtn.dataset.nav === 'encounters') setTimeout(scrollToFirstOpen, 60); return; }

    const subBtn = e.target.closest('[data-subtab]');
    if (subBtn) { ui.subtab = subBtn.dataset.subtab; renderEncounters(); setTimeout(scrollToFirstOpen, 60); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;

    switch (act) {
      // ---- global ----
      case 'open-map': window.open('https://pkmnmap4.web.app/', '_blank', 'noopener'); break;
      case 'export': exportData(); break;
      case 'import': $('#importFile').click(); break;
      case 'new-run': newRun(); break;
      case 'modal-close': closeModal(); break;
      case 'prompt-cancel': closePrompt(); break;
      case 'prompt-ok': submitPrompt(); break;
      case 'dex': openDex(el.dataset.species); break;
      case 'dex-back': dexBack(); break;

      // ---- Checkpoints ----
      case 'cp-toggle': {
        const c = findCp(id); c.completed = !c.completed; save('checkpoints');
        renderCap(); renderProgress(); break;
      }
      case 'cp-up': {
        const i = state.checkpoints.findIndex(c => c.id === id);
        if (i > 0) { const a = state.checkpoints; [a[i - 1], a[i]] = [a[i], a[i - 1]]; save('checkpoints'); renderCap(); renderProgress(); }
        break;
      }
      case 'cp-down': {
        const i = state.checkpoints.findIndex(c => c.id === id);
        if (i < state.checkpoints.length - 1) { const a = state.checkpoints; [a[i + 1], a[i]] = [a[i], a[i + 1]]; save('checkpoints'); renderCap(); renderProgress(); }
        break;
      }
      case 'cp-add':
        openPrompt('Checkpoint hinzufügen', [
          { key: 'label', label: 'Bezeichnung', placeholder: 'z. B. Arena 9 – XY' },
          { key: 'location', label: 'Ort', placeholder: 'Stadt / Route' },
          { key: 'gymType', label: 'Typ (optional)', placeholder: 'z. B. Drache' },
          { key: 'aceLevel', label: 'Ass-Level', type: 'number', value: 50 },
        ], v => {
          if (!v.label) return;
          state.checkpoints.push({ id: uid(), type: 'custom', label: v.label, location: v.location, gymType: v.gymType, aceLevel: parseInt(v.aceLevel, 10) || 0, completed: false });
          save('checkpoints'); renderCap(); renderProgress();
        });
        break;
      case 'cp-edit': {
        const c = findCp(id);
        openPrompt('Checkpoint bearbeiten', [
          { key: 'label', label: 'Bezeichnung', value: c.label },
          { key: 'location', label: 'Ort', value: c.location },
          { key: 'gymType', label: 'Typ (optional)', value: c.gymType || '' },
          { key: 'aceLevel', label: 'Ass-Level', type: 'number', value: c.aceLevel },
        ], v => {
          c.label = v.label; c.location = v.location; c.gymType = v.gymType;
          c.aceLevel = parseInt(v.aceLevel, 10) || 0;
          save('checkpoints'); renderCap(); renderProgress();
        });
        break;
      }
      case 'cp-del': {
        const c = findCp(id);
        if (confirm(`Checkpoint „${c.label}" löschen?`)) {
          state.checkpoints = state.checkpoints.filter(x => x.id !== id);
          save('checkpoints'); renderCap(); renderProgress();
        }
        break;
      }

      // ---- Team ----
      case 'team-add':
        openPrompt('Pokémon hinzufügen', [
          { key: 'species', label: 'Spezies', placeholder: 'z. B. Glurak' },
          { key: 'nickname', label: 'Spitzname (optional)', placeholder: 'egal' },
        ], v => {
          if (!v.species && !v.nickname) return;
          state.team.push({ id: uid(), species: v.species, nickname: v.nickname });
          save('team'); renderTeam();
        });
        break;
      case 'team-edit': {
        const p = findTeam(id);
        openPrompt('Pokémon bearbeiten', [
          { key: 'species', label: 'Spezies', value: p.species },
          { key: 'nickname', label: 'Spitzname (optional)', value: p.nickname || '' },
        ], v => { p.species = v.species; p.nickname = v.nickname; save('team'); renderTeam(); });
        break;
      }
      case 'team-del': {
        const p = findTeam(id);
        if (confirm(`„${p.nickname || p.species || 'Eintrag'}" aus dem Team entfernen?`)) {
          state.team = state.team.filter(x => x.id !== id); save('team'); renderTeam();
        }
        break;
      }
      case 'team-evolve': {
        const p = findTeam(id);
        const evos = ((dexLookup(p.species) || {}).evolution) || [];
        if (!evos.length) break;
        const doEvolve = newSp => {
          p.species = newSp;
          if (p.fromEncounter) {
            const enc = findEncAnywhere(p.fromEncounter);
            if (enc) { enc.species = newSp; save('encounters'); }
          }
          save('team'); renderTeam(); renderEncounters();
        };
        if (evos.length === 1) {
          doEvolve(evos[0].to);
        } else {
          openPrompt('Entwicklung wählen', [
            { key: 'evo', label: p.species + ' entwickelt sich zu', type: 'select', options: evos.map(e => e.to), value: evos[0].to },
          ], v => { if (v.evo) doEvolve(v.evo); });
        }
        break;
      }
      case 'team-devolve': {
        const p = findTeam(id);
        const pre = prevoOf(p.species);
        if (!pre) break;
        p.species = pre.name;
        if (p.fromEncounter) {
          const enc = findEncAnywhere(p.fromEncounter);
          if (enc) { enc.species = pre.name; save('encounters'); }
        }
        save('team'); renderTeam(); renderEncounters();
        break;
      }

      // ---- Begegnungen ----
      case 'enc-status': {
        const it = findEnc(id);
        it.status = (STATUS[it.status] || STATUS.open).next;
        save('encounters'); syncTeamForEncounter(it); renderEncounters(); renderTeam();
        break;
      }
      case 'enc-add': {
        const cat = ENC_CATS[ui.subtab];
        const fields = [{ key: 'name', label: 'Name / Ort', placeholder: cat.honey ? 'z. B. Honigbaum 1' : 'z. B. Route 240' }];
        if (cat.hasNote) fields.push({ key: 'note', label: 'Notiz (optional)', placeholder: 'z. B. Level / Bedingung' });
        fields.push({ key: 'species', label: 'Spezies (optional)', placeholder: 'randomisiert' });
        const defName = cat.honey ? 'Honigbaum ' + (state.encounters.honeyTrees.length + 1) : '';
        if (cat.honey) fields[0].value = defName;
        openPrompt('Eintrag hinzufügen', fields, v => {
          if (!v.name) return;
          const obj = { id: uid(), name: v.name, species: v.species || '', status: 'open' };
          if (cat.hasNote) obj.note = v.note || '';
          state.encounters[ui.subtab].push(obj);
          save('encounters'); renderEncounters();
        });
        break;
      }
      case 'enc-edit': {
        const it = findEnc(id);
        const cat = ENC_CATS[ui.subtab];
        const fields = [{ key: 'name', label: 'Name / Ort', value: it.name }];
        if (cat.hasNote) fields.push({ key: 'note', label: 'Notiz', value: it.note || '' });
        openPrompt('Eintrag bearbeiten', fields, v => {
          it.name = v.name; if (cat.hasNote) it.note = v.note;
          save('encounters'); syncTeamForEncounter(it); renderEncounters(); renderTeam();
        });
        break;
      }
      case 'enc-del': {
        const it = findEnc(id);
        if (confirm(`„${it.name}" löschen?`)) {
          state.encounters[ui.subtab] = state.encounters[ui.subtab].filter(x => x.id !== id);
          const ti = state.team.findIndex(p => p.fromEncounter === id);
          if (ti !== -1) { state.team.splice(ti, 1); save('team'); }
          save('encounters'); renderEncounters(); renderTeam();
        }
        break;
      }
      case 'honey-max':
        openPrompt('Honigbaum-Limit', [
          { key: 'max', label: 'Maximale Begegnungen', type: 'number', value: state.settings.honeyTreeMax },
        ], v => {
          const m = parseInt(v.max, 10);
          if (m >= 0) { state.settings.honeyTreeMax = m; save('settings'); renderEncounters(); }
        });
        break;

      // ---- Märkte ----
      case 'market-toggle':
        if (ui.openMarkets.has(id)) ui.openMarkets.delete(id); else ui.openMarkets.add(id);
        renderMarkets();
        break;
      case 'market-additem': {
        const input = document.querySelector(`[data-additem="${id}"]`);
        const val = (input.value || '').trim();
        if (!val) return;
        const m = findMarket(id); m.items = m.items || []; m.items.push(val);
        save('markets'); renderMarkets();
        break;
      }
      case 'market-delitem': {
        const m = findMarket(id); m.items.splice(parseInt(el.dataset.idx, 10), 1);
        save('markets'); renderMarkets();
        break;
      }
      case 'market-add':
        openPrompt('Stadt hinzufügen', [{ key: 'town', label: 'Stadtname', placeholder: 'z. B. Kampfzone' }], v => {
          if (!v.town) return;
          const nm = { id: uid(), town: v.town, items: [] };
          state.markets.push(nm); ui.openMarkets.add(nm.id); save('markets'); renderMarkets();
        });
        break;
      case 'market-rename': {
        const m = findMarket(id);
        openPrompt('Stadt umbenennen', [{ key: 'town', label: 'Stadtname', value: m.town }], v => {
          if (v.town) { m.town = v.town; save('markets'); renderMarkets(); }
        });
        break;
      }
      case 'market-del': {
        const m = findMarket(id);
        if (confirm(`Stadt „${m.town}" mit allen Items löschen?`)) {
          state.markets = state.markets.filter(x => x.id !== id);
          ui.openMarkets.delete(id); save('markets'); renderMarkets();
        }
        break;
      }
    }
  });

  // Spezies-Eingabe (feuert bei Blur/Enter)
  document.addEventListener('change', e => {
    const sp = e.target.closest('[data-action="enc-species"]');
    if (sp) {
      const it = findEnc(sp.dataset.id);
      if (it) { it.species = e.target.value; save('encounters'); syncTeamForEncounter(it); renderEncounters(); renderTeam(); }
    }
  });

  // Enter-Taste in Eingabefeldern
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.matches('#promptFields input')) { e.preventDefault(); submitPrompt(); }
    else if (e.target.matches('[data-additem]')) {
      e.preventDefault();
      const btn = document.querySelector(`[data-action="market-additem"][data-id="${e.target.dataset.additem}"]`);
      if (btn) btn.click();
    }
  });

  // Datei-Import
  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  // ===================== Fangraten-Rechner (Gen 4) =====================
  const BALLS = [
    { id: 'poke',    name: 'Pokéball',    mult: 1 },
    { id: 'super',   name: 'Superball',   mult: 1.5 },
    { id: 'hyper',   name: 'Hyperball',   mult: 2 },
    { id: 'meister', name: 'Meisterball', master: true },
    { id: 'netz',    name: 'Netzball',    cond: 'type' },
    { id: 'tauch',   name: 'Tauchball',   cond: 'toggle', mult: 3.5, toggleLabel: 'Beim Angeln / Surfen' },
    { id: 'nest',    name: 'Nestball',    cond: 'level' },
    { id: 'wieder',  name: 'Wiederball',  cond: 'toggle', mult: 3, toggleLabel: 'Art schon gefangen', autoCaught: true },
    { id: 'timer',   name: 'Timerball',   cond: 'turns' },
    { id: 'flott',   name: 'Flottball',   cond: 'toggle', mult: 4, toggleLabel: 'Erster Zug' },
    { id: 'finster', name: 'Finsterball', cond: 'toggle', mult: 3.5, toggleLabel: 'Nachts / in Höhle' },
    { id: 'luxus',   name: 'Luxusball',   mult: 1 },
    { id: 'premier', name: 'Premierball', mult: 1 },
    { id: 'heil',    name: 'Heilball',    mult: 1 },
  ];
  const ballById = id => BALLS.find(b => b.id === id);

  function currentBallMult(ball) {
    if (!ball) return 1;
    if (ball.master) return Infinity;
    if (!ball.cond) return ball.mult;
    const sit = $('#crSituational');
    switch (ball.cond) {
      case 'type': {
        const d = dexLookup($('#crSpecies').value);
        const t = d ? d.types : [];
        return (t.indexOf('Wasser') >= 0 || t.indexOf('Käfer') >= 0) ? 3 : 1;
      }
      case 'toggle': {
        const cb = sit.querySelector('input[type=checkbox]');
        return (cb && cb.checked) ? ball.mult : 1;
      }
      case 'level': {
        const lv = parseInt((sit.querySelector('input[type=number]') || {}).value, 10) || 1;
        return Math.max(1, (40 - lv) / 10);
      }
      case 'turns': {
        const tn = parseInt((sit.querySelector('input[type=number]') || {}).value, 10) || 1;
        return Math.min(4, (tn + 10) / 10);
      }
      default: return ball.mult || 1;
    }
  }

  // Gen-4-Fangwahrscheinlichkeit pro Wurf
  function catchChance(rate, hpFrac, statusMult, ballMult) {
    if (ballMult === Infinity) return 1;
    const a = Math.floor(((3 - 2 * hpFrac) * rate * ballMult / 3) * statusMult);
    if (a >= 255) return 1;
    if (a <= 0) return 0;
    const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / a));
    return Math.pow(b / 65536, 4);
  }

  function renderCatchSituational(ball) {
    const box = $('#crSituational');
    if (!ball || ball.master || !ball.cond) { box.innerHTML = ''; return; }
    if (ball.cond === 'type') {
      box.innerHTML = `<div class="cr-note">Netzball: automatisch ×3 bei Wasser-/Käfer-Pokémon, sonst ×1.</div>`;
    } else if (ball.cond === 'toggle') {
      const checked = ball.autoCaught && caughtSpeciesKeySet().has(speciesKey($('#crSpecies').value)) ? 'checked' : '';
      box.innerHTML = `<label class="cr-check"><input type="checkbox" ${checked}> ${esc(ball.toggleLabel)} (×${ball.mult})</label>`;
    } else if (ball.cond === 'level') {
      box.innerHTML = `<label class="cr-label">Level des wilden Pokémon <input type="number" min="1" max="100" value="20"></label>
        <div class="cr-note">Nestball: ×(40 − Level) ⁄ 10, mindestens ×1.</div>`;
    } else if (ball.cond === 'turns') {
      box.innerHTML = `<label class="cr-label">Runden im Kampf <input type="number" min="1" max="99" value="1"></label>
        <div class="cr-note">Timerball: ×(Runden + 10) ⁄ 10 – steigt pro Runde, max ×4 ab Runde 30.</div>`;
    }
  }

  function recalcCatch() {
    const rate = parseInt($('#crRate').value, 10) || 0;
    const hp = parseInt($('#crHp').value, 10) || 1;
    $('#crHpVal').textContent = hp + ' %';
    const statusMult = parseFloat($('#crStatus').value) || 1;
    const ball = ballById($('#crBall').value);
    const ballMult = currentBallMult(ball);
    const p = catchChance(rate, hp / 100, statusMult, ballMult);
    const box = $('#crResult');
    if (ballMult === Infinity) {
      box.innerHTML = `<div class="cr-big ok">Garantierter Fang (Meisterball)</div>`;
      return;
    }
    const pct = p * 100;
    const a = Math.floor(((3 - 2 * (hp / 100)) * rate * ballMult / 3) * statusMult);
    const forN = (p >= 1 || p <= 0) ? 0 : Math.ceil(Math.log(0.05) / Math.log(1 - p));
    const cls = pct >= 100 ? 'ok' : (pct >= 30 ? 'mid' : 'low');
    const ballStr = (ballMult % 1) ? ballMult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') : String(ballMult);
    box.innerHTML =
      `<div class="cr-big ${cls}">${pct >= 100 ? '≈ 100 % (sicher)' : pct.toFixed(1) + ' %'}<span class="cr-sub">pro Wurf</span></div>
       <div class="cr-detail">Fangwert a = ${a >= 255 ? '≥ 255 (sicher)' : a} · Ball ×${ballStr} · Status ×${String(statusMult).replace('.', ',')}</div>
       ${forN ? `<div class="cr-detail">≈ ${forN} ${forN === 1 ? 'Ball' : 'Bälle'} für 95 % Gesamt-Chance</div>` : ''}`;
  }

  function initCatch() {
    const sel = $('#crBall');
    sel.innerHTML = BALLS.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    renderCatchSituational(ballById(sel.value));
    $('#crSpecies').addEventListener('input', () => {
      const d = dexLookup($('#crSpecies').value);
      const hint = $('#crRateHint');
      if (d) { $('#crRate').value = d.catchRate; hint.textContent = `${d.name}: Fangrate ${d.catchRate}`; hint.className = 'cr-hint found'; }
      else if ($('#crSpecies').value.trim()) { hint.textContent = 'Nicht gefunden – Fangrate manuell eintragen.'; hint.className = 'cr-hint'; }
      else { hint.textContent = ''; }
      renderCatchSituational(ballById(sel.value));
      recalcCatch();
    });
    sel.addEventListener('change', () => { renderCatchSituational(ballById(sel.value)); recalcCatch(); });
    ['crRate', 'crHp', 'crStatus'].forEach(idd => {
      $('#' + idd).addEventListener('input', recalcCatch);
      $('#' + idd).addEventListener('change', recalcCatch);
    });
    $('#crSituational').addEventListener('input', recalcCatch);
    $('#crSituational').addEventListener('change', recalcCatch);
    recalcCatch();
  }

  // Ältere Speicherstände ohne neue Kategorien nachrüsten
  function ensureStructure() {
    if (state.encounters && !state.encounters.gifts) {
      state.encounters.gifts = clone(DEFAULT_DATA.encounters.gifts);
      save('encounters');
    }
  }

  // ===================== Init =====================
  load();
  ensureStructure();
  buildFamilyIndex();
  renderAll();
  initCatch();
  $('#teamSearch').addEventListener('input', e => { ui.teamSearch = e.target.value; renderTeam(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
