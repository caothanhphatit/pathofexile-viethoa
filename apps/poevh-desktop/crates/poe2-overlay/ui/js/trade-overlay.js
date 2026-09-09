(function () {
  'use strict';

  const state = {
    revision: -1,
    rawText: '',
    item: null,
    market: null,
    pseudos: [],
    searchGeneration: 0,
    searching: false,
    abortController: null,
    compareOpen: false
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function api(path, options = {}) {
    const token = window.__API_TOKEN__ || '';
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch {
        // Fallback
      }
      throw new Error(msg);
    }
    return res.json();
  }

  function setNotice(message, isError = false) {
    const notice = $('notice');
    const content = $('content');
    if (notice) {
      const titleEl = notice.querySelector('.notice-title') || notice;
      titleEl.textContent = message;
      notice.hidden = false;
      notice.style.display = 'block';
    }
    if (content) {
      content.hidden = true;
      content.style.display = 'none';
    }
  }

  function showToast(msg) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2000);
  }

  function markSearchDirty() {
    state.searchGeneration += 1;
    state.abortController?.abort();
    state.abortController = null;
    state.market = null;
    state.searching = false;
    if ($('matched')) $('matched').textContent = 'Điều kiện đã thay đổi — bấm Search';
    if ($('median')) $('median').textContent = '—';
    if ($('open-trade')) $('open-trade').disabled = true;
    if ($('loading')) $('loading').hidden = true;
    if ($('search-error')) $('search-error').hidden = true;
    if ($('results-table')) $('results-table').hidden = true;
    if ($('empty')) $('empty').hidden = true;
    if ($('search')) $('search').disabled = false;
  }

  function normalizeStatKey(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/\(.*?\)/g, '')               // remove range like (120-149)
      .replace(/[+\-]?\d+(?:\.\d+)?%?/g, '') // remove numbers
      .replace(/[^a-z]/g, ' ')              // keep only letters
      .replace(/\s+/g, ' ')
      .trim();
  }

  function primaryRoll(mod) {
    const parsed = Number(mod?.values?.[0]);
    if (Number.isFinite(parsed)) return parsed;
    const text = String(mod?.text || '').replace(/\([^)]*\)/g, '');
    const match = text.match(/[+-]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function formatRoll(value) {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  }

  // Derived-stat rules follow Awakened PoE Trade's source model: each input
  // modifier contributes to one or more semantic buckets. In particular,
  // all-elemental resistance contributes once to Fire, Cold and Lightning,
  // and Strength/Intelligence contribute 0.5 Life/Mana respectively.
  function derivePseudoStats(mods) {
    const totals = {
      flatLife: 0, flatMana: 0, flatEnergyShield: 0,
      strength: 0, dexterity: 0, intelligence: 0,
      fire: 0, cold: 0, lightning: 0, chaos: 0
    };
    const sources = Object.fromEntries(Object.keys(totals).map((key) => [key, new Set()]));

    const add = (bucket, value, index) => {
      if (!Number.isFinite(value)) return;
      totals[bucket] += value;
      sources[bucket].add(index);
    };

    (mods || []).forEach((mod, index) => {
      const text = String(mod.text || '').replace(/\([^)]*\)/g, '').toLowerCase();
      const value = primaryRoll(mod);
      if (!Number.isFinite(value)) return;

      if (/\bto maximum life\b/.test(text) && !/increased|reduced|less|regenerate|recover|per /.test(text)) {
        add('flatLife', value, index);
      }
      if (/\bto maximum mana\b/.test(text) && !/increased|reduced|less|regenerate|recover|per /.test(text)) {
        add('flatMana', value, index);
      }
      if (/\bto maximum energy shield\b/.test(text) && !/increased|reduced|less|recharge|per /.test(text)) {
        add('flatEnergyShield', value, index);
      }

      if (/\bto all attributes\b/.test(text)) {
        add('strength', value, index); add('dexterity', value, index); add('intelligence', value, index);
      } else if (/\bto strength and dexterity\b/.test(text)) {
        add('strength', value, index); add('dexterity', value, index);
      } else if (/\bto strength and intelligence\b/.test(text)) {
        add('strength', value, index); add('intelligence', value, index);
      } else if (/\bto dexterity and intelligence\b/.test(text)) {
        add('dexterity', value, index); add('intelligence', value, index);
      } else {
        if (/\bto strength\b/.test(text)) add('strength', value, index);
        if (/\bto dexterity\b/.test(text)) add('dexterity', value, index);
        if (/\bto intelligence\b/.test(text)) add('intelligence', value, index);
      }

      if (/\bto all resistances\b/.test(text)) {
        add('fire', value, index); add('cold', value, index); add('lightning', value, index); add('chaos', value, index);
      } else if (/\bto all elemental resistances\b/.test(text)) {
        add('fire', value, index); add('cold', value, index); add('lightning', value, index);
      } else {
        if (/\bto fire and cold resistances\b/.test(text)) {
          add('fire', value, index); add('cold', value, index);
        } else if (/\bto fire and lightning resistances\b/.test(text)) {
          add('fire', value, index); add('lightning', value, index);
        } else if (/\bto cold and lightning resistances\b/.test(text)) {
          add('cold', value, index); add('lightning', value, index);
        } else if (/\bto fire and chaos resistances\b/.test(text)) {
          add('fire', value, index); add('chaos', value, index);
        } else if (/\bto cold and chaos resistances\b/.test(text)) {
          add('cold', value, index); add('chaos', value, index);
        } else if (/\bto lightning and chaos resistances\b/.test(text)) {
          add('lightning', value, index); add('chaos', value, index);
        } else {
          if (/\bto fire resistance\b/.test(text)) add('fire', value, index);
          if (/\bto cold resistance\b/.test(text)) add('cold', value, index);
          if (/\bto lightning resistance\b/.test(text)) add('lightning', value, index);
          if (/\bto chaos resistance\b/.test(text)) add('chaos', value, index);
        }
      }
    });

    const union = (...sets) => [...new Set(sets.flatMap((set) => [...set]))];
    const out = [];
    const push = (key, label, value, contributors, suffix = '') => {
      if (!Number.isFinite(value) || value === 0 || contributors.length === 0) return;
      out.push({ key, label, value: Math.round(value * 10) / 10, contributors, suffix });
    };

    push('total_life', 'TOTAL MAXIMUM LIFE', totals.flatLife + totals.strength * 0.5,
      union(sources.flatLife, sources.strength));
    push('total_mana', 'TOTAL MAXIMUM MANA', totals.flatMana + totals.intelligence * 0.5,
      union(sources.flatMana, sources.intelligence));
    push('total_energy_shield', 'TOTAL MAXIMUM ENERGY SHIELD', totals.flatEnergyShield,
      union(sources.flatEnergyShield));
    push('total_strength', 'TOTAL TO STRENGTH', totals.strength, union(sources.strength));
    push('total_dexterity', 'TOTAL TO DEXTERITY', totals.dexterity, union(sources.dexterity));
    push('total_intelligence', 'TOTAL TO INTELLIGENCE', totals.intelligence, union(sources.intelligence));
    push('total_attributes', 'TOTAL TO ATTRIBUTES', totals.strength + totals.dexterity + totals.intelligence,
      union(sources.strength, sources.dexterity, sources.intelligence));
    push('total_fire_resistance', 'TOTAL TO FIRE RESISTANCE', totals.fire, union(sources.fire), '%');
    push('total_cold_resistance', 'TOTAL TO COLD RESISTANCE', totals.cold, union(sources.cold), '%');
    push('total_lightning_resistance', 'TOTAL TO LIGHTNING RESISTANCE', totals.lightning, union(sources.lightning), '%');
    push('total_chaos_resistance', 'TOTAL TO CHAOS RESISTANCE', totals.chaos, union(sources.chaos), '%');
    const elementalSources = union(sources.fire, sources.cold, sources.lightning);
    push('total_elemental_resistance', 'TOTAL ELEMENTAL RESISTANCE', totals.fire + totals.cold + totals.lightning,
      elementalSources, '%');
    push('total_resistance', 'TOTAL RESISTANCE', totals.fire + totals.cold + totals.lightning + totals.chaos,
      union(sources.fire, sources.cold, sources.lightning, sources.chaos), '%');
    return out;
  }

  function setCompareOpen(open) {
    if (state.compareOpen === open) return;
    state.compareOpen = open;
    const message = open ? 'show-trade-compare' : 'hide-trade-compare';
    if (window.ipc) window.ipc.postMessage(message);
    else if (window.chrome?.webview) window.chrome.webview.postMessage(message);
  }

  function extractTiersFromRaw(rawText) {
    const tiers = {};
    if (!rawText) return tiers;
    const lines = rawText.split(/\r?\n/);
    let currentAffix = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Match: { Prefix Modifier "Vigorous" (Tier: 1) — Life }
      // or { Suffix Modifier "of Destruction" (Tier: 2) — Critical }
      const headerMatch = line.match(/^\{\s*(Prefix|Suffix)\s+Modifier/i);
      if (headerMatch) {
        const type = headerMatch[1].toLowerCase().startsWith('p') ? 'P' : 'S';
        const tierMatch = line.match(/Tier:\s*(\d+)/i);
        const tierNum = tierMatch ? tierMatch[1] : '1';
        currentAffix = `${type}${tierNum}`;
        continue;
      }

      // If line is another section header or separator, end current affix
      if (line.startsWith('{') || line.startsWith('---') || line.startsWith('===')) {
        currentAffix = null;
        continue;
      }

      // If we are in an affix block and line contains a modifier
      if (currentAffix && !line.startsWith('#')) {
        const norm = normalizeStatKey(line);
        if (norm) {
          tiers[norm] = currentAffix;
        }
        tiers[line.toLowerCase()] = currentAffix;
        tiers[line] = currentAffix;
      }
    }
    return tiers;
  }

  function formatModText(text) {
    if (!text) return '';
    return escapeHtml(text.toUpperCase())
      .replace(/(\+?\d+(?:\.\d+)?(?:%| TO | SECONDS?)?)/g, '<strong>$1</strong>');
  }

  // Defensive UI-side guard for older/cached parser responses. Unique lore is
  // normally all-caps prose or quoted text; gameplay properties keep normal
  // casing (or a numeric value) and remain visible.
  function isUniqueFlavourText(text) {
    const value = String(text || '').trim();
    if (!value || value.startsWith('"') || value.endsWith('"')) return true;
    const letters = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    const allCaps = letters.length > 4 && letters === letters.toUpperCase();
    const hasNumber = /\d/.test(value);
    const gameplay = /^(grants|gain|gains|allies|you|your|while|when|cannot|counts as|attacks|spells)\b/i.test(value);
    return allCaps && !hasNumber && !gameplay;
  }

  function renderItem(item) {
    state.item = item;
    const notice = $('notice');
    const content = $('content');
    if (notice) {
      notice.hidden = true;
      notice.style.display = 'none';
    }
    if (content) {
      content.hidden = false;
      content.style.display = 'flex';
    }

    // Title
    const nameEl = $('item-name');
    // PoE Overlay keeps rare/magic headers compact by showing the base type.
    // Named uniques keep their two-line identity (unique name + base type).
    const baseEl = $('base-type');
    const rarity = (item.rarity || 'RARE').toUpperCase();
    const isUnique = rarity === 'UNIQUE';
    const banner = nameEl.closest('.item-banner');
    if (banner) banner.dataset.rarity = rarity.toLowerCase();
    nameEl.textContent = ((isUnique ? item.name : item.base_type) || item.name || item.base_type || 'Trang bị').toUpperCase();
    nameEl.classList.toggle('rarity-unique', isUnique);
    baseEl.classList.toggle('rarity-unique', isUnique);
    $('item-rarity-pill')?.classList.toggle('rarity-unique', isUnique);
    if (isUnique && item.name && item.base_type && item.name !== item.base_type) {
      baseEl.textContent = item.base_type;
      baseEl.style.display = 'block';
    } else {
      baseEl.style.display = 'none';
    }

    // Metadata values
    $('item-rarity-pill').textContent = rarity;
    $('item-ilvl-val').textContent = item.item_level || '—';
    $('item-req-val').textContent = item.requirements_level || (item.requirements?.[0] ? item.requirements[0].replace(/[^0-9]/g, '') : '—');

    const inputsCol = $('col-inputs');
    inputsCol.replaceChildren();

    // 1. Rarity Input Row
    const rRow = document.createElement('div');
    rRow.className = 'input-stack-row';
    const rSelect = document.createElement('select');
    rSelect.className = 'rarity-select-input';
    rSelect.id = 'filter-rarity';
    ['rare', 'magic', 'normal', 'unique', 'any'].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      if (opt === rarity.toLowerCase()) o.selected = true;
      rSelect.appendChild(o);
    });
    rRow.appendChild(rSelect);
    inputsCol.appendChild(rRow);

    // 2. iLvl Input Row
    const ilvlRow = createInputPair('filter-ilvl', item.item_level || '', '');
    inputsCol.appendChild(ilvlRow);

    // 3. Req Level Input Row
    const reqRow = createInputPair('filter-req', '', item.requirements_level || '');
    inputsCol.appendChild(reqRow);

    // Divider spacer matching .poe-divider
    const divSpacer = document.createElement('div');
    divSpacer.className = 'inputs-divider-spacer';
    inputsCol.appendChild(divSpacer);

    // Base stats (Rune Sockets, Quality, Defences)
    const baseStatsBox = $('base-stats-box');
    baseStatsBox.replaceChildren();

    if (item.sockets || item.rune_sockets) {
      const rawSock = item.rune_sockets || item.sockets;
      let numSockets = 1;
      if (typeof rawSock === 'number') {
        numSockets = rawSock;
      } else if (typeof rawSock === 'string') {
        const matches = rawSock.match(/[a-zA-Z]/g);
        numSockets = matches ? matches.length : 1;
      }
      addBaseStatRow(baseStatsBox, inputsCol, 'Rune Sockets', numSockets, numSockets, null);
    }
    if (item.quality != null && item.quality > 0) {
      addBaseStatRow(baseStatsBox, inputsCol, 'Quality', `+${item.quality}%`, item.quality, null);
    }
    if (item.armour > 0) {
      addBaseStatRow(baseStatsBox, inputsCol, 'Armour', item.armour, item.armour, '2.8');
    }
    if (item.energy_shield > 0) {
      addBaseStatRow(baseStatsBox, inputsCol, 'Energy Shield', item.energy_shield, item.energy_shield, '4.8');
    }
    if (item.evasion > 0) {
      addBaseStatRow(baseStatsBox, inputsCol, 'Evasion Rating', item.evasion, item.evasion, '3.5');
    }
    if (item.spirit > 0) {
      // Spirit is a base property in PoE2 unique items, not an explicit mod.
      // Keep it in the item card so it cannot be mistaken for a trade stat.
      const spiritRow = document.createElement('div');
      spiritRow.className = 'base-stat-row';
      spiritRow.innerHTML = `<div class="base-stat-left">Spirit: <span class="base-stat-val-highlight">${escapeHtml(item.spirit)}</span></div>`;
      baseStatsBox.appendChild(spiritRow);
      const spiritSpacer = document.createElement('div');
      spiritSpacer.className = 'input-stack-row input-readonly-row';
      spiritSpacer.textContent = '—';
      inputsCol.appendChild(spiritSpacer);
    }

    // Header spacer matching .mods-header-row (TIERING / SCORING)
    const hdrSpacer = document.createElement('div');
    hdrSpacer.className = 'inputs-header-spacer';
    inputsCol.appendChild(hdrSpacer);

    // Modifiers list
    const modsBox = $('mods-box');
    modsBox.replaceChildren();

    const rawTiers = extractTiersFromRaw(state.rawText);
    const mods = (item.mods || []).filter((mod) => !(isUnique && isUniqueFlavourText(mod.text)));
    // Do not silently add modifiers to the query. The values shown on the
    // right are the observed item rolls, not user-selected search criteria;
    // only an explicit click on a modifier row should constrain Trade2.
    // Pseudo totals are useful for rare-item comparisons, but Unique items
    // should show only their actual gameplay properties, not derived summary
    // rows such as TOTAL TO ATTRIBUTES.
    const pseudos = isUnique ? [] : derivePseudoStats(mods);
    state.pseudos = pseudos;

    mods.forEach((mod, idx) => {
      const val = mod.values?.[0];
      const isFloat = val != null && !Number.isInteger(val);
      const rollVal = val != null ? (isFloat ? Number(val.toFixed(2)) : val) : null;
      const normKey = normalizeStatKey(mod.text);
      let tier = rawTiers[normKey] || rawTiers[mod.text.toLowerCase()] || rawTiers[mod.text] || mod.tier;
      if (!tier) {
        for (const [k, t] of Object.entries(rawTiers)) {
          if (k && (normKey.includes(k) || k.includes(normKey))) {
            tier = t;
            break;
          }
        }
      }
      if (!tier) {
        tier = '';
      }
      const isPrefix = tier ? tier.toLowerCase().startsWith('p') : false;
      const isSuffix = tier ? tier.toLowerCase().startsWith('s') : false;
      const score = val ? (3.0 + (Math.abs(Math.round(val)) % 15) * 0.15).toFixed(1) : '3.0';
      const modKind = String(mod.mod_type || 'explicit').toLowerCase();
      const kindLabel = modKind === 'rune' ? 'RUNE'
        : modKind === 'implicit' ? 'IMP'
          : modKind === 'enchant' ? 'ENCH'
            : (tier || 'MOD');

      const modRow = document.createElement('div');
      modRow.className = `mod-item-row mod-kind-${modKind}`;
      modRow.dataset.index = String(idx);
      modRow.dataset.kind = modKind;

      const tierCell = document.createElement('div');
      const tierCls = isPrefix ? 'tier-p-text' : (isSuffix ? 'tier-s-text' : '');
      tierCell.className = `mod-tier-cell ${tierCls}`;
      tierCell.textContent = kindLabel;

      const textCell = document.createElement('div');
      textCell.className = 'mod-text-cell';
      textCell.innerHTML = `<span class="mod-arrow">↗</span> ${formatModText(mod.text)}`;

      const scoreCell = document.createElement('div');
      scoreCell.className = 'mod-score-cell';
      scoreCell.textContent = score;

      modRow.append(tierCell, textCell, scoreCell);
      modsBox.appendChild(modRow);

      // Use a tolerant 80% floor for the first search. The exact roll stays
      // available through Quick Price and can be edited before re-querying.
      const suggestedMin = val != null && Number.isFinite(Number(val))
        ? String(Math.round(Number(val) * 0.8 * 10) / 10)
        : '';
      const inputPair = createInputPair(`mod-${idx}`, suggestedMin, '', val);
      inputsCol.appendChild(inputPair);

      // Selection only updates the query draft. Network access happens when
      // the user explicitly presses Search, matching the expected price-check flow.
      modRow.addEventListener('click', () => {
        const isSel = modRow.classList.toggle('selected');
        inputPair.classList.toggle('active', isSel);
        markSearchDirty();
      });
    });

    pseudos.forEach((pseudo) => {
      const modRow = document.createElement('div');
      modRow.className = 'mod-item-row is-total';
      modRow.dataset.pseudoKey = pseudo.key;
      modRow.dataset.contributors = pseudo.contributors.join(',');
      modRow.title = `Gộp từ ${pseudo.contributors.length} modifier; dùng pseudo-stat chính thức của GGG Trade2`;

      const tierCell = document.createElement('div');
      tierCell.className = 'mod-tier-cell tier-total-text';
      tierCell.textContent = 'Σ';

      const textCell = document.createElement('div');
      textCell.className = 'mod-text-cell';
      textCell.innerHTML = `<span class="mod-arrow">↗</span> <strong>${escapeHtml(formatRoll(pseudo.value))}${escapeHtml(pseudo.suffix)}</strong> ${escapeHtml(pseudo.label)}`;

      const scoreCell = document.createElement('div');
      scoreCell.className = 'mod-score-cell pseudo-source-count';
      scoreCell.textContent = `${pseudo.contributors.length}×`;

      modRow.append(tierCell, textCell, scoreCell);
      modsBox.appendChild(modRow);

      // Pseudo-stat rows are optional query criteria. Start with a broad
      // floor (80% of the observed total) rather than an exact roll so a
      // resistance-only search does not accidentally become an exact-value
      // lookup. The user can still edit the threshold before searching.
      const suggestedMin = Math.round(Number(pseudo.value) * 0.8 * 10) / 10;
      const inputPair = createInputPair(`pseudo-${pseudo.key}`, String(suggestedMin), '', pseudo.value);
      inputPair.classList.add('pseudo-input-row');
      inputsCol.appendChild(inputPair);

      modRow.addEventListener('click', () => {
        const isSel = modRow.classList.toggle('selected');
        inputPair.classList.toggle('active', isSel);
        markSearchDirty();
      });
    });
  }

  function addBaseStatRow(parentLeft, parentRight, label, displayVal, inputMin, score) {
    const row = document.createElement('div');
    row.className = 'base-stat-row';
    const leftText = document.createElement('div');
    leftText.className = 'base-stat-left';
    leftText.innerHTML = `${escapeHtml(label)}: <span class="base-stat-val-highlight">${escapeHtml(displayVal)}</span>`;
    row.appendChild(leftText);

    if (score) {
      const scoreEl = document.createElement('div');
      scoreEl.className = 'base-stat-score';
      scoreEl.textContent = score;
      row.appendChild(scoreEl);
    }
    parentLeft.appendChild(row);

    const inputPair = createInputPair(`stat-${label.toLowerCase().replace(/\s+/g, '-')}`, inputMin != null ? String(inputMin) : '', '');
    parentRight.appendChild(inputPair);
  }

  function createInputPair(name, minVal, maxVal, baseVal) {
    const row = document.createElement('div');
    row.className = 'input-stack-row';
    row.dataset.for = name;

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.step = 'any';
    minInput.className = 'val-input val-min';
    minInput.placeholder = minVal !== '' ? minVal : 'min';
    minInput.value = minVal;
    if (baseVal != null) minInput.dataset.baseValue = String(baseVal);

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.step = 'any';
    maxInput.className = 'val-input val-max';
    maxInput.placeholder = maxVal !== '' ? maxVal : 'max';
    maxInput.value = maxVal;
    if (baseVal != null) maxInput.dataset.baseValue = String(baseVal);

    row.append(minInput, maxInput);
    return row;
  }

  function selectedMods() {
    const res = [];
    document.querySelectorAll('.mod-item-row[data-index].selected').forEach((row) => {
      const idx = Number(row.dataset.index);
      const inputRow = document.querySelector(`.input-stack-row[data-for="mod-${idx}"]`);
      const minInput = inputRow?.querySelector('.val-min');
      const maxInput = inputRow?.querySelector('.val-max');

      const minRaw = minInput ? minInput.value.trim() : '';
      const maxRaw = maxInput ? maxInput.value.trim() : '';
      res.push({
        index: idx,
        min: minRaw === '' ? null : Number(minRaw),
        max: maxRaw === '' ? null : Number(maxRaw)
      });
    });
    return res;
  }

  function selectedPseudos() {
    const res = [];
    document.querySelectorAll('.mod-item-row[data-pseudo-key].selected').forEach((row) => {
      const key = row.dataset.pseudoKey;
      const inputRow = document.querySelector(`.input-stack-row[data-for="pseudo-${key}"]`);
      const minRaw = inputRow?.querySelector('.val-min')?.value?.trim() || '';
      const maxRaw = inputRow?.querySelector('.val-max')?.value?.trim() || '';
      res.push({
        key,
        min: minRaw === '' ? null : Number(minRaw),
        max: maxRaw === '' ? null : Number(maxRaw)
      });
    });
    return res;
  }

  function readRange(name) {
    const row = document.querySelector(`.input-stack-row[data-for="${name}"]`);
    const parse = (selector) => {
      const raw = row?.querySelector(selector)?.value?.trim() || '';
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    return { min: parse('.val-min'), max: parse('.val-max') };
  }

  // Base-property rows are rendered with observed values for reference, but
  // they must not constrain a market query until the user explicitly selects
  // the row or edits one of its inputs. This keeps the default search focused
  // on the chosen modifiers instead of requiring an exact item copy.
  function readActiveRange(name) {
    const row = document.querySelector(`.input-stack-row[data-for="${name}"]`);
    if (!row?.classList.contains('active')) return { min: null, max: null };
    return readRange(name);
  }

  function itemFilters() {
    const ilvl = readActiveRange('filter-ilvl');
    const quality = readActiveRange('stat-quality');
    const armour = readActiveRange('stat-armour');
    const evasion = readActiveRange('stat-evasion-rating');
    const energyShield = readActiveRange('stat-energy-shield');
    const runeSockets = readActiveRange('stat-rune-sockets');
    const requirement = readActiveRange('filter-req');
    return {
      rarity: $('filter-rarity')?.value || null,
      item_level_min: ilvl.min,
      item_level_max: ilvl.max,
      quality_min: quality.min,
      quality_max: quality.max,
      armour_min: armour.min,
      armour_max: armour.max,
      evasion_min: evasion.min,
      evasion_max: evasion.max,
      energy_shield_min: energyShield.min,
      energy_shield_max: energyShield.max,
      rune_sockets_min: runeSockets.min,
      rune_sockets_max: runeSockets.max,
      requirement_level_min: requirement.min,
      requirement_level_max: requirement.max
    };
  }

  function renderMedian(listings) {
    const priced = (listings || []).filter((r) => Number.isFinite(r.amount) && r.currency);
    if (!priced.length) {
      $('median').textContent = '—';
      $('median-range').innerHTML = 'Range: — &nbsp; Reliability: <span class="rel-tag rel-very-low">Very Low</span>';
      return;
    }
    const counts = new Map();
    priced.forEach((r) => counts.set(r.currency, (counts.get(r.currency) || 0) + 1));
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const values = priced.filter((r) => r.currency === currency).map((r) => r.amount).sort((a, b) => a - b);
    const minPrice = values[0];
    const maxPrice = values[values.length - 1];
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;

    const relTag = listings.length > 15 ? 'High' : (listings.length > 5 ? 'Moderate' : 'Very Low');
    const relClass = listings.length > 15 ? 'rel-high' : (listings.length > 5 ? 'rel-moderate' : 'rel-very-low');

    $('median').innerHTML = `≈ ${Number(median.toFixed(1))} <span class="curr-icon">${currency.includes('divine') ? '🟡' : (currency.includes('exalted') ? '🪙' : '🔘')}</span>`;
    $('median-range').innerHTML = `Range: <strong>${minPrice}–${maxPrice} ${escapeHtml(currency)}</strong> &nbsp; Reliability: <span class="rel-tag ${relClass}">${relTag}</span>`;
  }

  function relativeTime(iso) {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }


  function showListingTooltip(listing, targetRow) {
    const tooltip = $('listing-tooltip');
    if (!tooltip) return;

    const itemName = (listing.item_name || listing.base_type || 'Trang bị').toUpperCase();
    const baseType = listing.base_type || '';
    const ilvl = listing.item_level || '—';
    const rarity = (listing.rarity || 'RARE').toUpperCase();

    let category = '';
    if (/gloves|mitts/i.test(baseType)) category = 'Gloves';
    else if (/boots|greaves/i.test(baseType)) category = 'Boots';
    else if (/helmet|circlet|sallet/i.test(baseType)) category = 'Helmet';
    else if (/armour|robe|vestment|mail/i.test(baseType)) category = 'Body Armour';
    else if (/shield|focus/i.test(baseType)) category = 'Shield';
    else if (/ring/i.test(baseType)) category = 'Ring';
    else if (/amulet/i.test(baseType)) category = 'Amulet';
    else if (/belt/i.test(baseType)) category = 'Belt';

    const defencesHtml = (listing.properties || []).map((prop) => {
      if (/energy shield|armour|evasion/i.test(prop)) {
        const parts = prop.split(':');
        return `<div class="tooltip-defence">${escapeHtml(parts[0])}: <span class="val-blue">${escapeHtml(parts[1] ? parts[1].trim() : '')}</span></div>`;
      }
      return '';
    }).join('');

    let reqText = '';
    if (listing.requirements && listing.requirements.length) {
      reqText = listing.requirements.join(', ');
    } else {
      reqText = '—';
    }

    const selectedTexts = [...document.querySelectorAll('.mod-item-row[data-index].selected .mod-text-cell')]
      .map((el) => normalizeStatKey(el.textContent));

    const tooltipMods = [
      ...(listing.implicit_mods || []).map((text) => ({ text, kind: 'IMP' })),
      ...(listing.rune_mods || []).map((text) => ({ text, kind: 'RUNE' })),
      ...(listing.explicit_mods || []).map((text) => ({ text, kind: 'MOD' }))
    ];
    const explicitRowsHtml = tooltipMods.map(({ text: modText, kind }) => {
      const lower = normalizeStatKey(modText);
      const isMatched = selectedTexts.some((st) => lower === st);
      const tierColor = kind === 'RUNE' ? '#a78bfa' : (kind === 'IMP' ? '#7ea8e0' : '#c5a059');

      return `
        <div class="tooltip-mod-row">
          <span class="tooltip-tier" style="color: ${tierColor}">${kind}</span>
          <span class="tooltip-mod-text ${isMatched ? 'matched-blue-pill' : ''}">
            ${escapeHtml(modText.toUpperCase())}
          </span>
        </div>
      `;
    }).join('');

    const listingMods = [
      ...(listing.implicit_mods || []),
      ...(listing.rune_mods || []),
      ...(listing.explicit_mods || [])
    ].map((text) => ({ text, values: [primaryRoll({ text })] }));
    const listingPseudos = new Map(derivePseudoStats(listingMods).map((pseudo) => [pseudo.key, pseudo]));
    const sourcePseudos = new Map((state.pseudos || []).map((pseudo) => [pseudo.key, pseudo]));
    const selectedPseudoKeys = new Set(
      [...document.querySelectorAll('.mod-item-row[data-pseudo-key].selected')]
        .map((row) => row.dataset.pseudoKey)
    );
    const compareKeys = selectedPseudoKeys.size
      ? [...selectedPseudoKeys]
      : [...sourcePseudos.keys()].filter((key) => listingPseudos.has(key)).slice(0, 5);
    const comparisonHtml = compareKeys.map((key) => {
      const source = sourcePseudos.get(key);
      const candidate = listingPseudos.get(key);
      if (!source || !candidate) return '';
      const delta = Math.round((candidate.value - source.value) * 10) / 10;
      const deltaClass = delta > 0 ? 'delta-better' : (delta < 0 ? 'delta-worse' : 'delta-equal');
      const deltaText = delta > 0 ? `+${formatRoll(delta)}` : formatRoll(delta);
      return `
        <div class="tooltip-total-row">
          <span><strong>${escapeHtml(formatRoll(candidate.value))}${escapeHtml(candidate.suffix)}</strong> ${escapeHtml(candidate.label)}</span>
          <span class="compare-delta ${deltaClass}">${escapeHtml(deltaText)} vs yours</span>
        </div>`;
    }).join('');

    tooltip.innerHTML = `
      <div class="tooltip-card">
        <div class="item-banner">
          <span class="banner-cap cap-left"></span>
          <div class="banner-titles">
            <h1 class="item-title">${escapeHtml(itemName)}</h1>
            ${baseType && baseType.toUpperCase() !== itemName ? `<div class="item-sub">${escapeHtml(baseType)}</div>` : ''}
          </div>
          <span class="banner-cap cap-right"></span>
        </div>
        <div class="item-meta-block">
          <div class="meta-row">
            <span class="meta-label">Item Rarity:</span>
            <span class="rarity-pill">${escapeHtml(rarity)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Item Level:</span>
            <span class="meta-val">${escapeHtml(ilvl)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Requires:</span>
            <span class="meta-val">${escapeHtml(reqText)}</span>
          </div>
        </div>
        ${category ? `<div class="tooltip-category">${escapeHtml(category)}</div>` : ''}
        ${defencesHtml}
        <div class="tooltip-mods-header">
          <span>TIERING</span>
        </div>
        <div class="tooltip-mods-list">
          ${explicitRowsHtml || '<div style="color:#666;font-size:10px;text-align:center;">Không có explicit mod</div>'}
        </div>
        ${comparisonHtml ? `
          <div class="tooltip-compare-header">SO SÁNH VỚI ${escapeHtml((state.item?.name || state.item?.base_type || 'ITEM CỦA BẠN').toUpperCase())}</div>
          <div class="tooltip-total-list">${comparisonHtml}</div>
        ` : ''}
        <div class="modifiable-tag-row" style="margin-top: 8px;">
          <span class="tag-modifiable">MODIFIABLE</span>
        </div>
      </div>
    `;

    tooltip.hidden = false;
    tooltip.style.display = 'block';
    setCompareOpen(true);

    if (targetRow) {
      const rect = targetRow.getBoundingClientRect();
      let topPos = Math.max(20, Math.min(rect.top - 80, window.innerHeight - 500));
      tooltip.style.top = `${topPos}px`;
    } else {
      tooltip.style.top = '30px';
    }
    tooltip.style.left = '55%';
  }

  function hideListingTooltip() {
    const tooltip = $('listing-tooltip');
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.style.display = 'none';
    }
    setCompareOpen(false);
  }

  function renderMarket(market) {
    state.market = market;
    // The server returns the live Trade2 resolution alongside listings. Keep
    // rows usable even when GGG has no public stat id for a line (runes and
    // some generated/implicit text can legitimately be unsearchable), but
    // explain that state instead of making the row look disabled.
    document.querySelectorAll('.mod-item-row[data-index]').forEach((row) => {
      const index = Number(row.dataset.index);
      const resolved = (market.filters || []).find((filter) => filter.index === index);
      row.classList.toggle('filter-unavailable', !resolved?.trade_id);
      row.title = resolved?.trade_id
        ? 'Modifier này sẽ được gửi tới GGG Trade2.'
        : 'GGG Trade2 không công bố filter cho dòng này; vẫn có thể chọn để xem/so sánh.';
    });
    $('matched').textContent = `${market.listings.length}/${market.total}${market.inexact ? '+' : ''} Results from`;
    $('open-trade').disabled = !market.trade_url;
    $('loading').hidden = true;
    $('search-error').hidden = true;
    const hasListings = market.listings && market.listings.length > 0;
    $('empty').hidden = hasListings;
    $('results-table').hidden = !hasListings;

    const tbody = $('results');
    tbody.replaceChildren();

    market.listings.forEach((listing) => {
      const row = document.createElement('tr');
      const curr = (listing.currency || '').toLowerCase();
      const isDivine = curr.includes('divine');
      const isExalted = curr.includes('exalted');
      const priceText = listing.amount == null ? 'Chưa niêm yết' : `${listing.amount} × ${listing.currency || ''}`;
      const seller = listing.character || listing.account || 'Ẩn';

      const tdCopy = document.createElement('td');
      tdCopy.className = 'td-copy';
      tdCopy.textContent = '👁';
      tdCopy.title = 'Click để copy whisper';

      const tdPrice = document.createElement('td');
      tdPrice.className = `price-cell ${isDivine ? 'price-divine' : (isExalted ? 'price-exalted' : '')}`;
      tdPrice.textContent = priceText;

      const tdIlvl = document.createElement('td');
      tdIlvl.textContent = listing.item_level ?? '—';

      const tdQual = document.createElement('td');
      tdQual.textContent = listing.quality || '—';

      const tdSeller = document.createElement('td');
      tdSeller.textContent = seller;

      const tdTime = document.createElement('td');
      tdTime.style.textAlign = 'right';
      tdTime.style.color = '#887d6a';
      tdTime.textContent = relativeTime(listing.indexed);

      row.append(tdCopy, tdPrice, tdIlvl, tdQual, tdSeller, tdTime);

      row.addEventListener('click', () => {
        const whisperMsg = `@${seller} Hi, I would like to buy your ${state.item?.name || state.item?.base_type || 'item'} listed for ${priceText} in ${$('league')?.value || 'Standard'}`;
        navigator.clipboard.writeText(whisperMsg).then(() => {
          showToast(`Đã copy whisper gửi @${seller}!`);
        }).catch(() => {
          showToast('Không thể copy whisper.');
        });
      });


      tdCopy.addEventListener('pointerenter', () => showListingTooltip(listing, row));
      tdCopy.addEventListener('pointerleave', hideListingTooltip);
      row.addEventListener('pointerenter', () => showListingTooltip(listing, row));
      row.addEventListener('pointerleave', hideListingTooltip);

      tbody.appendChild(row);
    });

    renderMedian(market.listings);
  }

  async function searchMarket() {
    if (!state.item) return;

    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }

    const currentGen = ++state.searchGeneration;
    const ac = new AbortController();
    state.abortController = ac;

    state.searching = true;
    $('loading').hidden = false;
    $('empty').hidden = true;
    $('search-error').hidden = true;
    $('results-table').hidden = true;
    $('open-trade').disabled = true;
    $('search').disabled = true;

    try {
      const payload = {
        raw_text: state.rawText,
        league: $('league')?.value || 'Standard',
        selected_mods: selectedMods(),
        selected_pseudos: selectedPseudos(),
        item_filters: itemFilters(),
        online_only: true
      };

      const result = await api('/api/trade/search', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: ac.signal
      });

      if (currentGen !== state.searchGeneration) return;
      renderMarket(result);
    } catch (error) {
      if (ac.signal.aborted) return;
      if (currentGen !== state.searchGeneration) return;
      $('loading').hidden = true;
      $('results-table').hidden = true;
      $('empty').hidden = true;
      const errorBox = $('search-error');
      errorBox.hidden = false;
      const message = errorBox.querySelector('span');
      if (message) message.textContent = `⚠ ${error.message || 'Lỗi kết nối GGG Trade API'}`;
    } finally {
      if (currentGen === state.searchGeneration) {
        state.searching = false;
        $('loading').hidden = true;
        $('search').disabled = false;
      }
    }
  }

  async function loadLeagues() {
    try {
      const data = await api('/api/trade/leagues');
      const select = $('league');
      if (!select) return;
      select.replaceChildren();

      const savedLeague = localStorage.getItem('poevh.trade.league');
      const leagues = data.leagues || ['Standard'];
      leagues.forEach((lg) => {
        const opt = document.createElement('option');
        opt.value = lg;
        opt.textContent = lg;
        if (lg === savedLeague) opt.selected = true;
        select.appendChild(opt);
      });
      if (!select.value && leagues[0]) select.value = leagues[0];
      $('league-display').textContent = `(${select.value})`;
    } catch {
      // Fallback
    }
  }

  async function refreshTradeCapture() {
    try {
      const capture = await api('/api/trade/latest');
      if (capture.status === 'error') {
        setNotice(capture.error || 'Lỗi khi đọc item.', true);
        return;
      }
      if (!capture.item || !capture.raw_text) {
        setNotice('Rê chuột lên item trong game rồi nhấn Alt+E.');
        return;
      }
      if (capture.revision !== state.revision) {
        state.revision = capture.revision;
        state.rawText = capture.raw_text;
        renderItem(capture.item);
        // A new capture is a complete price-check request.  Do not leave the
        // user in a half-rendered "parsed only" state: render the item first
        // (which builds real Trade2 stat filters), then issue exactly one
        // search using the current selection.
        $('matched').textContent = 'Đang tìm kiếm…';
        $('median').textContent = '—';
        $('results-table').hidden = true;
        $('empty').hidden = true;
        void searchMarket();
      }
    } catch (error) {
      setNotice(`Không đọc được trạng thái Trade: ${error.message}`, true);
    }
  }

  function setupQuickActions() {
    $('btn-crafting-base')?.addEventListener('click', () => {
      document.querySelectorAll('.mod-item-row').forEach((row) => {
        row.classList.remove('selected');
        const inputKey = row.dataset.pseudoKey ? `pseudo-${row.dataset.pseudoKey}` : `mod-${row.dataset.index}`;
        const inputRow = document.querySelector(`.input-stack-row[data-for="${inputKey}"]`);
        if (inputRow) {
          inputRow.classList.remove('active');
          const min = inputRow.querySelector('.val-min');
          if (min) min.value = '';
        }
      });
      markSearchDirty();
    });

    $('btn-quick-price')?.addEventListener('click', () => {
      document.querySelectorAll('.input-stack-row').forEach((row) => {
        const minInput = row.querySelector('.val-min');
        if (minInput && minInput.dataset.baseValue) {
          minInput.value = minInput.dataset.baseValue;
        }
      });
      markSearchDirty();
    });

    $('btn-broad-10')?.addEventListener('click', () => {
      document.querySelectorAll('.input-stack-row').forEach((row) => {
        const minInput = row.querySelector('.val-min');
        if (minInput && minInput.dataset.baseValue) {
          const base = Number(minInput.dataset.baseValue);
          if (Number.isFinite(base) && base > 0) {
            minInput.value = String(Number.isInteger(base) ? Math.floor(base * 0.9) : Math.round(base * 0.9 * 10) / 10);
          }
        }
      });
      markSearchDirty();
    });

    $('filter-currency-pill')?.addEventListener('change', (e) => {
      const val = e.target.value.toLowerCase();
      document.querySelectorAll('#results tr').forEach((row) => {
        if (!val) {
          row.style.display = '';
        } else {
          const text = row.querySelector('.price-cell')?.textContent.toLowerCase() || '';
          row.style.display = text.includes(val) ? '' : 'none';
        }
      });
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadLeagues().then(refreshTradeCapture);
    setupQuickActions();

    $('search')?.addEventListener('click', searchMarket);
    $('search-retry-btn')?.addEventListener('click', searchMarket);
    $('league-display')?.addEventListener('click', () => {
      const lg = $('league');
      if (lg) {
        lg.style.display = 'inline-block';
        lg.focus();
      }
    });
    $('league')?.addEventListener('change', () => {
      localStorage.setItem('poevh.trade.league', $('league').value);
      $('league-display').textContent = `(${$('league').value})`;
      $('league').style.display = 'none';
      markSearchDirty();
    });
    $('league')?.addEventListener('blur', () => {
      $('league').style.display = 'none';
    });
    $('col-inputs')?.addEventListener('input', (event) => {
      if (!event.target.matches('input, select')) return;

      // Editing a base-property field is an explicit opt-in to that filter.
      // Modifier/pseudo rows are activated by selecting their corresponding
      // left-hand row, so keep their existing selection semantics intact.
      const row = event.target.closest('.input-stack-row');
      const key = row?.dataset.for || '';
      if (row && key && !key.startsWith('mod-') && !key.startsWith('pseudo-')) {
        row.classList.add('active');
      }
      markSearchDirty();
    });

    $('open-trade')?.addEventListener('click', () => {
      if (state.market?.trade_url) window.open(state.market.trade_url, '_blank', 'noopener');
    });
    $('open-trade-top')?.addEventListener('click', () => {
      if (state.market?.trade_url) window.open(state.market.trade_url, '_blank', 'noopener');
    });

    $('close')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.ipc) {
        window.ipc.postMessage('hide-trade');
      } else if (window.chrome?.webview) {
        window.chrome.webview.postMessage('hide-trade');
      } else {
        window.close();
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        window.ipc?.postMessage('hide-trade');
      } else if (event.key === 'Enter' && !event.target.matches('input')) {
        event.preventDefault();
        searchMarket();
      }
    });
  });

  window.refreshTradeCapture = refreshTradeCapture;
  window.resetTradeOverlay = function () {
    state.revision = -1;
    state.rawText = '';
    state.item = null;
    state.market = null;
    state.pseudos = [];
    state.searchGeneration += 1;
    state.searching = false;
    state.abortController?.abort();
    state.abortController = null;
    hideListingTooltip();
    $('content').hidden = true;
    setNotice('Rê chuột lên item trong game rồi nhấn Alt+E.');
  };
})();
