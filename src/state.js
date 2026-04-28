// Parser de estado a partir do HTML da página de overview, e merge com o
// JSON retornado por endpoints AJAX (heal, etc). O JSON é mais confiável; o
// HTML é só fallback inicial.

const NUM = /[\d.]+/;

function num(s) {
  if (!s) return null;
  const m = s.replace(/\./g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// Extracts X/Y from a string like "Pontos de vida 2483 / 2711" or "21 / 24"
function parseFraction(s) {
  const m = s && s.match(/(\d[\d.]*)\s*\/\s*(\d[\d.]*)/);
  if (!m) return null;
  return { value: num(m[1]), max: num(m[2]) };
}

// Cooldown text: "0:00:57" => seconds. "Ir em Expedição" / "Pronto" => 0.
function parseCooldown(s) {
  if (!s) return null;
  const m = s.match(/(\d+):(\d{2}):(\d{2})/);
  if (m) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  if (/Ir em|Ir para|Pronto|Para o/.test(s)) return 0;
  return null;
}

// Parse the overview HTML into a State. Picks fields out of well-known
// patterns; if a field is missing we leave it null instead of guessing.
export function parseOverview(html) {
  const state = {
    gold: null,
    rubies: null,
    hpPercent: null,
    hp: null,
    expPercent: null,
    expedition: { points: null, max: null, cooldownSec: null },
    dungeon: { points: null, max: null, cooldownSec: null },
    arena: { cooldownSec: null },
    grouparena: { cooldownSec: null },
    inventoryFood: [],
  };

  // Header resource line. The page shows: gold rubies hp% exp%
  // We pull from data attributes when present, falling back to plain text.
  const headerMatch = html.match(/id=["']header[\s\S]{0,4000}/);
  const headerHtml = headerMatch ? headerMatch[0] : html;

  state.gold = num((headerHtml.match(/icon_gold[^>]*>\s*([\d.]+)/) || [])[1]) ??
               num((headerHtml.match(/gold["']?\s*:\s*\{[^}]*?value["']?\s*:\s*(\d+)/) || [])[1]);
  state.rubies = num((headerHtml.match(/icon_ruby[^>]*>\s*([\d.]+)/) || [])[1]);

  // HP absolute via tooltip on health bar: "Pontos de vida:","2711 \/ 2711"
  const hpTip = html.match(/Pontos de vida:?[^"]*?",\s*"(\d+)\s*\\?\/\s*(\d+)/);
  if (hpTip) {
    state.hp = { value: parseInt(hpTip[1], 10), max: parseInt(hpTip[2], 10) };
    state.hpPercent = Math.round((state.hp.value / state.hp.max) * 100);
  }

  // Slot CTAs: text "Ir em Expedição" or a countdown timer "0:00:57"
  // The slot order on Gladiatus headers is: expedition, dungeon, arena, grouparena
  // Their containers carry data-tooltip with cooldown info; falling back to visible text.
  const slotTexts = [...html.matchAll(/class=["']charmercInfo[^"']*?["'][^>]*>([\s\S]{0,200}?)<\/div>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  if (slotTexts[0]) state.expedition.cooldownSec = parseCooldown(slotTexts[0]);
  if (slotTexts[1]) state.dungeon.cooldownSec = parseCooldown(slotTexts[1]);
  if (slotTexts[2]) state.arena.cooldownSec = parseCooldown(slotTexts[2]);
  if (slotTexts[3]) state.grouparena.cooldownSec = parseCooldown(slotTexts[3]);

  // Points "X / Y" appear as text near the slot icons; fall back to scanning all fractions
  const fractions = [...html.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
    .map(m => ({ value: parseInt(m[1], 10), max: parseInt(m[2], 10) }))
    .filter(f => f.max <= 24); // expedition/dungeon caps are 24
  if (fractions.length >= 2) {
    state.expedition.points = fractions[0].value;
    state.expedition.max = fractions[0].max;
    state.dungeon.points = fractions[1].value;
    state.dungeon.max = fractions[1].max;
  }

  // Inventory food (data-content-type="64")
  const itemRe = /<div\b[^>]*\bdata-content-type=["']64["'][^>]*>/g;
  for (const m of html.matchAll(itemRe)) {
    const tag = m[0];
    const get = (name) => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = tag.match(r);
      return mm ? mm[1] : null;
    };
    const tooltipRaw = get('data-tooltip');
    if (!tooltipRaw) continue;
    let parsed = null;
    try {
      const decoded = tooltipRaw
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
      parsed = JSON.parse(decoded);
    } catch { /* ignore */ }
    let name = '?';
    let healNominal = 0;
    if (parsed && parsed[0]) {
      const inner = parsed[0];
      if (inner[0]) name = String(inner[0][0] || '?');
      const healEntry = inner.find((e) => /Usar: Cura\s+\d+/.test(e[0] || ''));
      if (healEntry) healNominal = parseInt(healEntry[0].match(/\d+/)[0], 10);
    }
    if (healNominal > 0) {
      state.inventoryFood.push({
        itemId: get('data-item-id'),
        from: parseInt(get('data-container-number') || '512', 10),
        fromX: parseInt(get('data-position-x') || '0', 10),
        fromY: parseInt(get('data-position-y') || '0', 10),
        name,
        healNominal,
      });
    }
  }
  state.inventoryFood.sort((a, b) => a.healNominal - b.healNominal);

  return state;
}

// Merge the partial state we parsed from HTML with the authoritative JSON
// the server returns from heal/fight responses (header.health, etc).
export function mergeAjaxResponse(state, json) {
  if (!json || typeof json !== 'object') return state;
  const h = json.header;
  if (!h) return state;

  if (h.health) {
    state.hp = { value: h.health.value, max: h.health.maxValue };
    state.hpPercent = Math.round((state.hp.value / state.hp.max) * 100);
  }
  if (h.gold) state.gold = h.gold.value;
  if (h.expedition) {
    state.expedition.points = h.expedition.points;
    state.expedition.max = h.expedition.pointsMax;
    if (h.expedition.cooldown) {
      const remaining = h.expedition.cooldown.end - h.expedition.cooldown.time;
      state.expedition.cooldownSec = Math.max(0, remaining);
    }
  }
  if (h.dungeon) {
    state.dungeon.points = h.dungeon.points;
    state.dungeon.max = h.dungeon.pointsMax;
    if (h.dungeon.cooldown) {
      const remaining = h.dungeon.cooldown.end - h.dungeon.cooldown.time;
      state.dungeon.cooldownSec = Math.max(0, remaining);
    }
  }
  return state;
}

export function summarizeState(state) {
  const hpStr = state.hp ? `${state.hp.value}/${state.hp.max} (${state.hpPercent}%)` : `${state.hpPercent ?? '?'}%`;
  const exp = state.expedition;
  const dung = state.dungeon;
  return [
    `HP=${hpStr}`,
    `gold=${state.gold ?? '?'}`,
    `exp=${exp.points ?? '?'}/${exp.max ?? '?'}(cd ${exp.cooldownSec ?? '?'}s)`,
    `dung=${dung.points ?? '?'}/${dung.max ?? '?'}(cd ${dung.cooldownSec ?? '?'}s)`,
    `food=${state.inventoryFood.length}`,
  ].join(' ');
}
