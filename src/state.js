// Parser do HTML da página overview do Gladiatus. Extrai estado por IDs
// específicos (não regex genérico) — confere com a estrutura observada em
// produção (BR62 Speed x5, página com header padrão).

function toInt(s) {
  if (s === null || s === undefined) return null;
  const cleaned = String(s).replace(/[.\s]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function rxOne(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

// `new ProgressBar('cooldown_bar_text_<slot>', ..., start, current, end)`
// Retorna segundos restantes, 0 se já está pronto, null se não achou.
function extractCooldown(html, slot) {
  const re = new RegExp(
    `new\\s+ProgressBar\\([\\s\\S]*?'cooldown_bar_text_${slot}'[\\s\\S]*?(\\d{9,}),\\s*(\\d{9,}),\\s*(\\d{9,})\\s*\\)`
  );
  const m = html.match(re);
  if (!m) return null;
  const current = parseInt(m[2], 10);
  const end = parseInt(m[3], 10);
  return Math.max(0, end - current);
}

export function parseOverview(html) {
  const state = {
    gold: toInt(rxOne(html, /id="sstat_gold_val"[^>]*>([\d.,]+)</)),
    rubies: toInt(rxOne(html, /id="sstat_ruby_val"[^>]*>([\d.,]+)</)),
    level: toInt(rxOne(html, /id="header_values_level"[^>]*>(\d+)</)),
    expPercent: toInt(rxOne(html, /id="header_values_xp_percent"[^>]*>(\d+)%</)),
    hpPercent: toInt(rxOne(html, /id="header_values_hp_percent"[^>]*>(\d+)%</)),
    hp: null,
    expedition: { points: null, max: null, cooldownSec: null },
    dungeon: { points: null, max: null, cooldownSec: null },
    arena: { cooldownSec: null },
    grouparena: { cooldownSec: null },
    inventoryFood: [],
  };

  // HP absoluto via data-attributes em #header_values_hp_bar
  const hpV = rxOne(html, /id="header_values_hp_bar"[^>]*data-value="(\d+)"/);
  const hpM = rxOne(html, /id="header_values_hp_bar"[^>]*data-max-value="(\d+)"/);
  if (hpV && hpM) {
    state.hp = { value: parseInt(hpV, 10), max: parseInt(hpM, 10) };
    if (state.hpPercent === null && state.hp.max > 0) {
      state.hpPercent = Math.round((100 * state.hp.value) / state.hp.max);
    }
  }

  // Pontos de expedição/masmorra
  state.expedition.points = toInt(rxOne(html, /id="expeditionpoints_value_point"[^>]*>(\d+)</));
  state.expedition.max = toInt(rxOne(html, /id="expeditionpoints_value_pointmax"[^>]*>(\d+)</));
  state.dungeon.points = toInt(rxOne(html, /id="dungeonpoints_value_point"[^>]*>(\d+)</));
  state.dungeon.max = toInt(rxOne(html, /id="dungeonpoints_value_pointmax"[^>]*>(\d+)</));

  // Cooldowns das ProgressBar JS
  state.expedition.cooldownSec = extractCooldown(html, 'expedition');
  state.dungeon.cooldownSec = extractCooldown(html, 'dungeon');
  state.arena.cooldownSec = extractCooldown(html, 'arena');
  state.grouparena.cooldownSec = extractCooldown(html, 'ct');

  // Inventário (só presente em mod=overview, não em training etc.)
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

// Merge defensivo com response JSON do servidor (heal/fight). header.* é fonte
// de verdade quando disponível.
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
      state.expedition.cooldownSec = Math.max(0, h.expedition.cooldown.end - h.expedition.cooldown.time);
    }
  }
  if (h.dungeon) {
    state.dungeon.points = h.dungeon.points;
    state.dungeon.max = h.dungeon.pointsMax;
    if (h.dungeon.cooldown) {
      state.dungeon.cooldownSec = Math.max(0, h.dungeon.cooldown.end - h.dungeon.cooldown.time);
    }
  }
  return state;
}

export function summarizeState(state) {
  const hpStr = state.hp
    ? `${state.hp.value}/${state.hp.max} (${state.hpPercent}%)`
    : `${state.hpPercent ?? '?'}%`;
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
