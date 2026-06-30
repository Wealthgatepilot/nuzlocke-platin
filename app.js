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

  // ===================== UI-Status =====================
  const ui = { tab: 'progress', subtab: 'routes', openMarkets: new Set() };

  const ENC_CATS = {
    routes:     { label: 'Routen',     hasNote: false, honey: false },
    static:     { label: 'Statisch',   hasNote: true,  honey: false },
    fossils:    { label: 'Fossilien',  hasNote: true,  honey: false },
    honeyTrees: { label: 'Honigbäume', hasNote: false, honey: true  },
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
      list.innerHTML = '<li class="card" style="color:var(--text-dim);text-align:center">Noch keine Pokémon. Tippe unten auf „+ Pokémon hinzufügen".</li>';
      return;
    }
    list.innerHTML = state.team.map(p => {
      const hasSp = !!(p.species && p.species.trim());
      return `<li class="card team-card">
        <div class="team-main">
          <div class="team-nick">${esc(p.nickname || '(ohne Namen)')}</div>
          <div class="team-species ${hasSp ? '' : 'empty'}">${hasSp ? esc(p.species) : 'keine Spezies'}</div>
        </div>
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
    list.innerHTML = items.map(it => {
      const st = STATUS[it.status] || STATUS.open;
      const hasSp = !!(it.species && it.species.trim());
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
  function openDex(species) {
    const d = dexLookup(species);
    const box = $('#modalContent');
    if (!d) {
      box.innerHTML =
        `<div class="dex-head"><span class="dex-name">${esc(species)}</span></div>
         <div class="dex-notfound">Nicht in der Datenbank gefunden. Prüfe die Schreibweise (deutscher Name) oder schau online nach.</div>
         <a class="dex-link" target="_blank" rel="noopener"
            href="https://www.bulbapedia.bulbagarden.net/w/index.php?search=${encodeURIComponent(species)}">Auf Bulbapedia suchen ↗</a>`;
      $('#modalOverlay').hidden = false;
      return;
    }

    const types = d.types.map(t => `<span class="type-tag">${esc(t)}</span>`).join('');

    const evo = (d.evolution && d.evolution.length)
      ? d.evolution.map(e => `<div class="dex-evo"><b>→ ${esc(e.to)}</b> <span class="evo-cond">${esc(e.text || '')}</span></div>`).join('')
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

    box.innerHTML =
      `<div class="dex-head"><span class="dex-name">${esc(d.name)}</span><span class="dex-no">#${String(d.id).padStart(3, '0')}</span></div>
       <div class="dex-types">${types}</div>
       ${d._incomplete ? '<div class="dex-notfound" style="margin-bottom:8px">Hinweis: Daten teilweise aus Diamant/Perl (kein vollständiger Platin-Datensatz).</div>' : ''}
       <div class="dex-section-title">Entwicklung</div>${evo}
       <div class="dex-section-title">Level-Attacken <span class="lv1-tag">(Lv 1 = von Beginn / nachlernbar)</span></div>${lvl}
       <div class="dex-section-title">TM / VM</div>${tm}
       <a class="dex-link" target="_blank" rel="noopener" href="${serebii}">Auf Serebii.net ansehen ↗</a>`;
    $('#modalOverlay').hidden = false;
  }
  const closeModal = () => { $('#modalOverlay').hidden = true; };

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
      saveAll(); renderAll();
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

  // ===================== Event-Handling =====================
  document.addEventListener('click', e => {
    // Backdrop-Klick schließt Modals
    if (e.target.id === 'modalOverlay') { closeModal(); return; }
    if (e.target.id === 'promptOverlay') { closePrompt(); return; }

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) { switchTab(navBtn.dataset.nav); return; }

    const subBtn = e.target.closest('[data-subtab]');
    if (subBtn) { ui.subtab = subBtn.dataset.subtab; renderEncounters(); return; }

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
          { key: 'nickname', label: 'Spitzname', placeholder: 'z. B. Bello' },
          { key: 'species', label: 'Spezies (randomisiert)', placeholder: 'z. B. Glurak' },
        ], v => {
          if (!v.nickname && !v.species) return;
          state.team.push({ id: uid(), nickname: v.nickname, species: v.species });
          save('team'); renderTeam();
        });
        break;
      case 'team-edit': {
        const p = findTeam(id);
        openPrompt('Pokémon bearbeiten', [
          { key: 'nickname', label: 'Spitzname', value: p.nickname },
          { key: 'species', label: 'Spezies', value: p.species },
        ], v => { p.nickname = v.nickname; p.species = v.species; save('team'); renderTeam(); });
        break;
      }
      case 'team-del': {
        const p = findTeam(id);
        if (confirm(`„${p.nickname || p.species || 'Eintrag'}" aus dem Team entfernen?`)) {
          state.team = state.team.filter(x => x.id !== id); save('team'); renderTeam();
        }
        break;
      }

      // ---- Begegnungen ----
      case 'enc-status': {
        const it = findEnc(id);
        it.status = (STATUS[it.status] || STATUS.open).next;
        save('encounters'); renderEncounters();
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
          save('encounters'); renderEncounters();
        });
        break;
      }
      case 'enc-del': {
        const it = findEnc(id);
        if (confirm(`„${it.name}" löschen?`)) {
          state.encounters[ui.subtab] = state.encounters[ui.subtab].filter(x => x.id !== id);
          save('encounters'); renderEncounters();
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
      if (it) { it.species = e.target.value; save('encounters'); renderEncounters(); }
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

  // ===================== Init =====================
  load();
  renderAll();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
