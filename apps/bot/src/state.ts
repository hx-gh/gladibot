// Parser do HTML da página overview do Gladiatus. Extrai estado por IDs
// específicos (não regex genérico) — confere com a estrutura observada em
// produção (BR62 Speed x5, página com header padrão).

import type {
  BotSnapshot,
  StatDetail,
  StatBlock,
  BuffEntry,
  BuffsBlock,
  InventoryFoodItem,
  InventoryCell,
  InventoryGrid,
  WorkStatus,
  AuctionTooltipBlock,
  AuctionTooltip,
  AuctionStatRow,
  AuctionListing,
  AuctionListResult,
} from '@gladibot/shared';

function toInt(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const cleaned = String(s).replace(/[.\s]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function rxOne(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

// `new ProgressBar('cooldown_bar_text_<slot>', ..., start, current, end)`
// Retorna segundos restantes, 0 se já está pronto, null se não achou.
function extractCooldown(html: string, slot: string): number | null {
  const re = new RegExp(
    `new\\s+ProgressBar\\([\\s\\S]*?'cooldown_bar_text_${slot}'[\\s\\S]*?(\\d{9,}),\\s*(\\d{9,}),\\s*(\\d{9,})\\s*\\)`
  );
  const m = html.match(re);
  if (!m) return null;
  const current = parseInt(m[2], 10);
  const end = parseInt(m[3], 10);
  return Math.max(0, end - current);
}

// Mapping IDs do DOM → chaves canônicas + skillToTrain ID do endpoint.
// Confirmados em produção: char_f3 = Constituição → skillToTrain=4,
//                          char_f5 = Inteligência → skillToTrain=6.
// Os outros são inferidos do padrão sequencial.
export const STAT_SLOTS: { domId: string; key: keyof StatBlock; label: string; trainId: number }[] = [
  { domId: 'f0', key: 'strength',     label: 'Força',        trainId: 1 },
  { domId: 'f1', key: 'dexterity',    label: 'Destreza',     trainId: 2 },
  { domId: 'f2', key: 'agility',      label: 'Agilidade',    trainId: 3 },
  { domId: 'f3', key: 'constitution', label: 'Constituição', trainId: 4 },
  { domId: 'f4', key: 'charisma',     label: 'Carisma',      trainId: 5 },
  { domId: 'f5', key: 'intelligence', label: 'Inteligência', trainId: 6 },
];

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Cada `data-tooltip` de char_fN_tt é um array JSON onde cada linha é
// `[[label, value], [color1, color2]]` ou `[label, color, width]`. Procuramos
// linhas conhecidas: o nome do stat (total), "Básico:", "Máximo:", "Por artigos:".
// Tooltip JSON pode vir aninhado em 1 ou 2 níveis. Drilamos até as "rows".
function unwrapTooltip(json: unknown): unknown {
  let rows = json;
  while (Array.isArray(rows) && rows.length === 1 && Array.isArray(rows[0])) {
    if (rows[0].length > 0 && Array.isArray(rows[0][0])) { rows = rows[0]; break; }
    rows = rows[0];
  }
  return rows;
}

interface StatTooltipRaw {
  total: number | null;
  base: number | null;
  max: number | null;
  items: number | null;
  itemsMax: number | null;
}

function parseStatTooltip(rawAttr: string, knownLabel: string): StatTooltipRaw | null {
  const decoded = decodeAttr(rawAttr);
  let json: unknown;
  try { json = JSON.parse(decoded); } catch { return null; }
  const rows = unwrapTooltip(json);
  if (!Array.isArray(rows)) return null;

  const out: StatTooltipRaw = { total: null, base: null, max: null, items: null, itemsMax: null };
  for (const row of rows) {
    if (!Array.isArray(row) || !Array.isArray(row[0])) continue;
    const [label, value] = row[0] as [unknown, unknown];
    if (typeof label !== 'string') continue;

    const clean = label.replace(/\s+/g, ' ').trim();
    const num = typeof value === 'number' ? value : parseInt(String(value), 10);

    if (clean === `${knownLabel}:`) out.total = num;
    else if (clean === 'Básico:') out.base = num;
    else if (clean === 'Máximo:') out.max = num;
    else if (clean === 'Por artigos:') {
      const s = String(value);
      const m = s.match(/([+-]?\d+)/);
      if (m) out.items = parseInt(m[1], 10);
      const m2 = s.match(/de\s+([+-]?\d+)/);
      if (m2) out.itemsMax = parseInt(m2[1], 10);
    }
  }
  return out;
}

function parseStatsBlock(html: string): StatBlock {
  const stats: Partial<StatBlock> = {};
  for (const slot of STAT_SLOTS) {
    const m = html.match(new RegExp(`id="char_${slot.domId}_tt"[^>]*data-tooltip="([^"]+)"`));
    if (!m) { stats[slot.key] = null; continue; }
    const parsed = parseStatTooltip(m[1], slot.label);
    if (!parsed || parsed.total === null) { stats[slot.key] = null; continue; }
    const detail: StatDetail = {
      ...parsed,
      label: slot.label,
      trainId: slot.trainId,
      bonus: (parsed.base !== null && parsed.items !== null)
        ? parsed.total - parsed.base - parsed.items
        : 0,
    };
    stats[slot.key] = detail;
  }
  return stats as StatBlock;
}

// Buffs:
//   Globais (header `#globalBuffs`): div.buff-clickable com `title=`, `data-effect-end` (segs).
//   Pessoais (`#buffbar_old`): div.buff_old com data-tooltip JSON + span data-ticker-time-left (ms).
function parseBuffs(html: string): BuffsBlock {
  // The expiration we get from the HTML is "seconds remaining at the moment of
  // the GET". If we stored it raw and kept showing the same number, it'd appear
  // frozen until the next snapshot. Convert to an absolute endsAtMs so the UI
  // can decrement live.
  const now = Date.now();
  const global: BuffEntry[] = [];
  const personal: BuffEntry[] = [];

  const gSection = html.match(/<div\s+id="globalBuffs">([\s\S]*?)<div\s+id="localBuffs">/);
  if (gSection) {
    const re = /<div\s+class="buff[^"]*"[^>]*?data-effect-end="(-?\d+)"[^>]*?title="([^"]+)"/g;
    for (const m of gSection[1].matchAll(re)) {
      const endsInSec = parseInt(m[1], 10);
      global.push({ title: m[2], endsAtMs: now + endsInSec * 1000 });
    }
  }

  // Personal buffs (overview only). Each <div class="buff_old"> contains both the
  // tooltip and the ticker. Pair them by sequential occurrence.
  const personalRe =
    /<div\s+class="buff_old[^"]*">[\s\S]*?id="buffBar\d+"[^>]*data-tooltip="([^"]+)"[\s\S]*?data-ticker-time-left="(\d+)"/g;
  for (const m of html.matchAll(personalRe)) {
    let json: unknown;
    try { json = JSON.parse(decodeAttr(m[1])); } catch { continue; }
    const rows = unwrapTooltip(json);
    const firstRow = Array.isArray(rows) ? rows[0] : null;
    const name = (Array.isArray(firstRow) && typeof firstRow[0] === 'string') ? firstRow[0] : '?';
    // Find the green "effect" line (color #00B712).
    let effect: string | null = null;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (Array.isArray(row) && typeof row[0] === 'string' && /00B712/i.test(String(row[1] || ''))) {
          effect = row[0];
          break;
        }
      }
    }
    personal.push({
      name,
      effect,
      endsAtMs: now + parseInt(m[2], 10),  // ticker já vem em ms
    });
  }

  return { global, personal };
}

interface TrainingSkill {
  key: string;
  label: string;
  trainId: number;
  cost: number | null;
  canTrain: boolean;
}

export interface TrainingStatus {
  skills: TrainingSkill[];
  skillPoints: number;
  stats: StatBlock;
}

// Custos de treinamento (página mod=training). O HTML repete o mesmo bloco
// pra cada um dos 6 stats, com:
//   <div ... id="char_fN_tt" ...> (mesmo do overview)
//   <div class="training_costs"> CUSTO <img...> </div>
//   <a class="training_button" href="...skillToTrain=ID..."> ←  habilitado
//   OR <img ... button_disabled.jpg ...>                   ← sem ouro suficiente
export function parseTraining(html: string): TrainingStatus {
  const skills: TrainingSkill[] = [];
  for (const slot of STAT_SLOTS) {
    const re = new RegExp(
      `id="char_${slot.domId}_tt"[\\s\\S]*?<div class="training_costs">[\\s\\S]*?` +
      `(\\d{1,3}(?:\\.\\d{3})*)\\s*<img[\\s\\S]*?` +
      `(?:<a class="training_button"[^>]*skillToTrain=(\\d+)|<img[^>]*button_disabled)`
    );
    const m = html.match(re);
    if (!m) {
      skills.push({ key: slot.key, label: slot.label, trainId: slot.trainId, cost: null, canTrain: false });
      continue;
    }
    const cost = parseInt(m[1].replace(/\./g, ''), 10);
    skills.push({
      key: slot.key,
      label: slot.label,
      trainId: slot.trainId,
      cost,
      canTrain: !!m[2],
    });
  }

  const spMatch = html.match(/Pontos de habilidade dispon\w+:\s*(\d+)/);
  const skillPoints = spMatch ? parseInt(spMatch[1], 10) : 0;

  const stats = parseStatsBlock(html);

  return { skills, skillPoints, stats };
}

export function parseOverview(html: string): BotSnapshot {
  const state: BotSnapshot = {
    charName: rxOne(html, /<div class="playername[^"]*">\s*([^<]+?)\s*<\/div>/),
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
    stats: parseStatsBlock(html),
    buffs: parseBuffs(html),
    // Working state — populated by orchestrator from a separate mod=work fetch.
    // Overview alone has no signal that the character is currently working.
    working: { active: false, secondsLeft: null, jobName: null },
    inventoryGrid: {} as InventoryGrid,
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
    const get = (name: string): string | null => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = tag.match(r);
      return mm ? mm[1] : null;
    };
    const tooltipRaw = get('data-tooltip');
    if (!tooltipRaw) continue;
    let parsed: unknown = null;
    try {
      const decoded = tooltipRaw
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
      parsed = JSON.parse(decoded);
    } catch { /* ignore */ }
    let name = '?';
    let healNominal = 0;
    if (parsed && Array.isArray(parsed) && parsed[0]) {
      const inner = parsed[0] as unknown[];
      if (inner[0]) name = String((inner[0] as unknown[])[0] || '?');
      const healEntry = inner.find((e) => /Usar: Cura\s+\d+/.test(String((e as unknown[])[0] || '')));
      if (healEntry) {
        const match = String((healEntry as unknown[])[0]).match(/\d+/);
        if (match) healNominal = parseInt(match[0], 10);
      }
    }
    if (healNominal > 0) {
      const item: InventoryFoodItem = {
        itemId: get('data-item-id'),
        from: parseInt(get('data-container-number') || '512', 10),
        fromX: parseInt(get('data-position-x') || '0', 10),
        fromY: parseInt(get('data-position-y') || '0', 10),
        name,
        healNominal,
      };
      state.inventoryFood.push(item);
    }
  }
  state.inventoryFood.sort((a, b) => a.healNominal - b.healNominal);

  // Ocupação dos bags (512..515 = Ⅰ..Ⅳ). Usado por actions/packages.js pra achar
  // slot livre antes de mover. Só vê itens renderizados (getHtml — JS roda);
  // fetchRawHtml deixa #inv vazio e o BagLoader em script, esse parser não cobre.
  state.inventoryGrid = parseInventoryGrid(html);

  return state;
}

// Cada item tem data-position-x/y (1-based) e data-measurement-x/y (tamanho em
// células). Bag = 8 colunas × 5 linhas. Retorna {512: [...], 513: [...], 514: [...], 515: [...]}.
export function parseInventoryGrid(html: string): InventoryGrid {
  const bags: InventoryGrid = { 512: [], 513: [], 514: [], 515: [] };
  const re = /<div\b[^>]*\bdata-container-number=["'](51[2-5])["'][^>]*>/g;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const get = (name: string): string | null => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = tag.match(r);
      return mm ? mm[1] : null;
    };
    const bag = parseInt(m[1], 10);
    const x = parseInt(get('data-position-x') || '0', 10);
    const y = parseInt(get('data-position-y') || '0', 10);
    const w = parseInt(get('data-measurement-x') || '1', 10);
    const h = parseInt(get('data-measurement-y') || '1', 10);
    if (x > 0 && y > 0) (bags[bag] as InventoryCell[]).push({ x, y, w, h });
  }
  return bags;
}

// Parser do mod=packages. Cada pacote é uma `<div class="packageItem">` com:
//   <input name="packages[]" value="<packageId>">
//   <div data-container-number="-<packageId>">
//     <div ... data-content-type ... data-tooltip ... data-position-x="1" ...>
// Em vez de delimitar o bloco por `</div></div>` (frágil — packageItem tem 5
// fechos), pareamos `name="packages[]" value="N"` ao `<div ... data-container-number="-N">`
// que sempre vem logo a seguir, e dali achamos o item div interno.

export interface PackageItem {
  packageId: number;
  contentType: number;
  level: number | null;
  priceGold: number | null;
  quality: number | null;
  name: string | null;
  healNominal: number;
  from: number;
  fromX: number;
  fromY: number;
  measurement: { w: number; h: number };
}

export function parsePackages(html: string): PackageItem[] {
  const out: PackageItem[] = [];
  const idRe = /<input[^>]*name="packages\[\]"[^>]*value="(\d+)"/g;
  for (const m of html.matchAll(idRe)) {
    const packageId = parseInt(m[1], 10);
    // Acha o wrapper data-container-number="-<id>" iniciado depois do input.
    const wrapperRe = new RegExp(
      `data-container-number=["']-${packageId}["'][^>]*>\\s*(<div\\b[^>]*\\bdata-content-type=["'](\\d+)["'][^>]*>)`
    );
    const wrapped = html.slice(m.index).match(wrapperRe);
    if (!wrapped) continue;
    const tag = wrapped[1];
    const get = (name: string): string | null => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = tag.match(r);
      return mm ? mm[1] : null;
    };
    const contentType = parseInt(wrapped[2], 10);
    const fromX = parseInt(get('data-position-x') || '1', 10);
    const fromY = parseInt(get('data-position-y') || '1', 10);
    const w = parseInt(get('data-measurement-x') || '1', 10);
    const h = parseInt(get('data-measurement-y') || '1', 10);
    const level = parseInt(get('data-level') || '0', 10) || null;
    const priceGold = parseInt(get('data-price-gold') || '0', 10) || null;
    const qualityStr = get('data-quality');

    const tooltipRaw = get('data-tooltip');
    let name: string | null = null;
    let healNominal = 0;
    if (tooltipRaw) {
      try {
        const decoded = tooltipRaw
          .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const parsed = JSON.parse(decoded) as unknown;
        const inner = parsed && Array.isArray(parsed) ? parsed[0] as unknown[] : null;
        if (inner && inner[0]) name = String((inner[0] as unknown[])[0] || '');
        if (inner) {
          const healEntry = inner.find((e) => /Usar: Cura\s+\d+/.test(String((e as unknown[])?.[0] || '')));
          if (healEntry) {
            const hm = String((healEntry as unknown[])[0]).match(/\d+/);
            if (hm) healNominal = parseInt(hm[0], 10);
          }
        }
      } catch { /* ignore */ }
    }

    out.push({
      packageId,
      contentType,
      level,
      priceGold,
      quality: qualityStr !== null && qualityStr !== '' ? parseInt(qualityStr, 10) : null,
      name,
      healNominal,
      from: -packageId,
      fromX,
      fromY,
      measurement: { w, h },
    });
  }
  return out;
}

// Procura primeira posição (x,y) onde um item w×h cabe sem sobrepor itens já
// no bag. Bag é 8 colunas × 5 linhas (BAG_COLS×BAG_ROWS). Retorna null se cheio.
export const BAG_COLS = 8;
export const BAG_ROWS = 5;

export function findFreeBagSlot(occupied: InventoryCell[], w: number, h: number): { x: number; y: number } | null {
  const cells = new Set<string>();
  for (const it of occupied) {
    for (let dy = 0; dy < it.h; dy++) {
      for (let dx = 0; dx < it.w; dx++) {
        cells.add(`${it.x + dx},${it.y + dy}`);
      }
    }
  }
  for (let y = 1; y + h - 1 <= BAG_ROWS; y++) {
    for (let x = 1; x + w - 1 <= BAG_COLS; x++) {
      let fits = true;
      for (let dy = 0; dy < h && fits; dy++) {
        for (let dx = 0; dx < w && fits; dx++) {
          if (cells.has(`${x + dx},${y + dy}`)) fits = false;
        }
      }
      if (fits) return { x, y };
    }
  }
  return null;
}

// Merge defensivo com response JSON do servidor (heal/fight). header.* é fonte
// de verdade quando disponível.
export function mergeAjaxResponse(state: BotSnapshot, json: unknown): BotSnapshot {
  if (!json || typeof json !== 'object') return state;
  const h = (json as Record<string, unknown>)['header'] as Record<string, unknown> | undefined;
  if (!h) return state;

  if (h['health']) {
    const health = h['health'] as Record<string, number>;
    state.hp = { value: health['value'], max: health['maxValue'] };
    state.hpPercent = Math.round((state.hp.value / state.hp.max) * 100);
  }
  if (h['gold']) state.gold = (h['gold'] as Record<string, number>)['value'];
  if (h['expedition']) {
    const exp = h['expedition'] as Record<string, unknown>;
    state.expedition.points = exp['points'] as number;
    state.expedition.max = exp['pointsMax'] as number;
    if (exp['cooldown']) {
      const cd = exp['cooldown'] as Record<string, number>;
      state.expedition.cooldownSec = Math.max(0, cd['end'] - cd['time']);
    }
  }
  if (h['dungeon']) {
    const dung = h['dungeon'] as Record<string, unknown>;
    state.dungeon.points = dung['points'] as number;
    state.dungeon.max = dung['pointsMax'] as number;
    if (dung['cooldown']) {
      const cd = dung['cooldown'] as Record<string, number>;
      state.dungeon.cooldownSec = Math.max(0, cd['end'] - cd['time']);
    }
  }
  return state;
}

export function summarizeState(state: BotSnapshot): string {
  const hpStr = state.hp
    ? `${state.hp.value}/${state.hp.max} (${state.hpPercent}%)`
    : `${state.hpPercent ?? '?'}%`;
  const exp = state.expedition;
  const dung = state.dungeon;
  const parts = [
    `HP=${hpStr}`,
    `gold=${state.gold ?? '?'}`,
    `exp=${exp.points ?? '?'}/${exp.max ?? '?'}(cd ${exp.cooldownSec ?? '?'}s)`,
    `dung=${dung.points ?? '?'}/${dung.max ?? '?'}(cd ${dung.cooldownSec ?? '?'}s)`,
    `food=${state.inventoryFood.length}`,
  ];
  if (state.working?.active) {
    parts.push(`working=${state.working.jobName || '?'}(${state.working.secondsLeft ?? '?'}s)`);
  }
  return parts.join(' ');
}

// Parser do leilão (mod=auction).
//
// Cada anúncio é um <form id="auctionForm<auctionid>"> que aninha um
// <div class="item-i-X-Y" data-tooltip="..." data-level data-quality?...>
// e um <div class="auction_bid_div"> com lance/buyout.
//
// O data-tooltip é um array JSON de DOIS elementos: [itemRows, equippedRows].
// itemRows descreve o item leiloado; equippedRows é o que o char tem equipado
// no slot equivalente (comparação automática, sem fetch extra). Ver
// docs/wip/auction/leilao1-analysis.md.
//
// Quality: prefere [data-quality] (1=azul, 2=roxo). Ausente pode ser verde
// (cor `lime` no nameStyle) ou comum/branco — distinguir pelo estilo inline
// do nome no tooltip.
//
// Nome de item segue padrão "<base> <Prefixo>? <conector> <sufixo>?" onde
// conector ∈ {do, da, dos, das, de}. Sem catálogo de affixes ainda — split
// é heurístico e marcado como tal.

const AFFIX_CONNECTORS_RE = /^(.*?)\s+(do|da|dos|das|de)\s+(.+)$/;

function splitItemName(fullName: string | null): { baseName: string | null; prefix: string | null; suffix: string | null } {
  if (!fullName) return { baseName: null, prefix: null, suffix: null };
  const m = fullName.match(AFFIX_CONNECTORS_RE);
  if (!m) return { baseName: fullName, prefix: null, suffix: null };
  const before = m[1];
  const suffix = `${m[2]} ${m[3]}`;
  const beforeWords = before.split(/\s+/);
  if (beforeWords.length >= 2) {
    const prefix = beforeWords[beforeWords.length - 1];
    const baseName = beforeWords.slice(0, -1).join(' ');
    return { baseName, prefix, suffix };
  }
  return { baseName: before, prefix: null, suffix };
}

// Cada bloco do tooltip de leilão é um array de linhas. Duas formas observadas:
//
//   Simples (sem comparação ou item equipado):
//     [label:string, color:string]
//
//   Dual (item leiloado QUANDO há equipado pra comparar — bloco 0):
//     [[itemLabel:string, deltaLabel:string], [color1, color2]]
//
// O delta já vem pré-calculado pelo jogo (ex: "+10 - 13", "+35", "+3% (+4)",
// "0", "-2"). Nas linhas Nível/Valor/Durabilidade o segundo elemento costuma
// ser apenas a cor (formato simples), portanto tratamos as linhas de stat
// (que vão pra `out.stats`) como possíveis duas-formas.
function parseAuctionTooltipBlock(rows: unknown[]): AuctionTooltipBlock | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (!Array.isArray(first)) return null;

  const out: AuctionTooltipBlock = {
    name: typeof first[0] === 'string' ? first[0] : '',
    nameStyle: typeof first[1] === 'string' ? first[1] : '',
    stats: [],
    level: null,
    value: null,
    durability: null,
    conditioning: null,
    soulbound: null,
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    let label: string;
    let delta: string | null = null;
    let color: string | null = null;
    if (Array.isArray(row[0])) {
      label = typeof row[0][0] === 'string' ? row[0][0] : '';
      delta = typeof row[0][1] === 'string' ? row[0][1] : null;
      color = Array.isArray(row[1]) && typeof row[1][0] === 'string' ? row[1][0] : null;
    } else {
      label = typeof row[0] === 'string' ? row[0] : '';
      color = typeof row[1] === 'string' ? row[1] : null;
    }
    if (!label) continue;

    let m: RegExpMatchArray | null;
    if ((m = label.match(/^Nível\s+(\d+)/))) {
      out.level = parseInt(m[1], 10);
    } else if ((m = label.match(/^Valor\s+([\d.]+)/))) {
      out.value = parseInt(m[1].replace(/\./g, ''), 10);
    } else if ((m = label.match(/^Durabilidade\s+(\d+)\/(\d+)/))) {
      out.durability = { value: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    } else if ((m = label.match(/^Condicionamento\s+(\d+)\/(\d+)/))) {
      out.conditioning = { value: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    } else if ((m = label.match(/^Vínculo a Alma de:\s*(.+)$/))) {
      out.soulbound = m[1].trim();
    } else {
      const statRow: AuctionStatRow = { label, color, delta };
      out.stats.push(statRow);
    }
  }
  return out;
}

function parseAuctionTooltip(rawAttr: string | null): AuctionTooltip | null {
  if (!rawAttr) return null;
  let json: unknown;
  try { json = JSON.parse(decodeAttr(rawAttr)); } catch { return null; }
  if (!Array.isArray(json) || json.length === 0) return null;
  return {
    item: parseAuctionTooltipBlock(json[0] as unknown[]),
    equipped: json[1] ? parseAuctionTooltipBlock(json[1] as unknown[]) : null,
  };
}

// Lê value de <option selected> dentro de um <select name=X>.
function selectedOption(html: string, selectName: string): string | null {
  const re = new RegExp(
    `<select[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)</select>`
  );
  const block = html.match(re);
  if (!block) return null;
  const sel = block[1].match(/<option[^>]*\bselected\b[^>]*value="(-?\d+)"/);
  if (sel) return sel[1];
  // fallback: value antes de selected
  const sel2 = block[1].match(/<option[^>]*value="(-?\d+)"[^>]*\bselected\b/);
  return sel2 ? sel2[1] : null;
}

export function parseAuctionList(html: string): AuctionListResult {
  const result: AuctionListResult = {
    filter: { doll: null, qry: '', itemType: null, itemLevel: null, itemQuality: null },
    globalTimeBucket: null,
    itemLevelOptions: [],
    listings: [],
  };

  // Filtro
  const doll = rxOne(html, /<input[^>]*name="doll"[^>]*value="(\d+)"/);
  const qry = rxOne(html, /<input[^>]*name="qry"[^>]*value="([^"]*)"/);
  const itemType = selectedOption(html, 'itemType');
  const itemLevel = selectedOption(html, 'itemLevel');
  const itemQuality = selectedOption(html, 'itemQuality');
  result.filter = {
    doll: doll ? parseInt(doll, 10) : null,
    qry: qry ?? '',
    itemType: itemType !== null ? parseInt(itemType, 10) : null,
    itemLevel: itemLevel !== null ? parseInt(itemLevel, 10) : null,
    itemQuality: itemQuality !== null ? parseInt(itemQuality, 10) : null,
  };

  result.globalTimeBucket = rxOne(
    html,
    /class="description_span_right"[^>]*>\s*<b>([^<]+)<\/b>/
  );

  // Faixa de levels que o jogo aceita no <select name="itemLevel">. Sempre
  // extrair direto do HTML em vez de computar pela fórmula `auction-min-level`
  // / `auction-max-level` — o step muda com o nível (ex: lvl 48 step=6,
  // lvl 70 step=7) e a fórmula sozinha não dá pra reproduzir o conjunto exato
  // que o servidor aceita. Mandar valor fora dessa lista devolve listing vazia.
  const levelSelectMatch = html.match(/<select\s+name="itemLevel"[^>]*>([\s\S]*?)<\/select>/i);
  const itemLevelOptions: number[] = [];
  if (levelSelectMatch) {
    for (const m of levelSelectMatch[1].matchAll(/<option\s+value="(\d+)"/gi)) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v)) itemLevelOptions.push(v);
    }
  }
  result.itemLevelOptions = itemLevelOptions;

  // Listings: cada <form id="auctionFormN">...</form>
  const formRe = /<form([^>]*)\bid="auctionForm(\d+)"[^>]*>([\s\S]*?)<\/form>/g;
  for (const fm of html.matchAll(formRe)) {
    const formAttrs = fm[1] || '';
    const auctionId = parseInt(fm[2], 10);
    const formHtml = fm[3];

    // Extrai o ttype do action= (ex: ?mod=auction&submod=placeBid&ttype=2&...).
    // O bid POST precisa usar esse mesmo ttype — mesmo na aba "Mercenário" os
    // forms vêm com ttype=2, não 3 (semântica ainda ambígua, ver endpoints.md).
    const ttypeMatch = formAttrs.match(/[?&]ttype=(\d+)/);
    const formTtype = ttypeMatch ? parseInt(ttypeMatch[1], 10) : null;

    const itemTagMatch = formHtml.match(/<div\b([^>]*\bdata-tooltip=[^>]*)>/);
    if (!itemTagMatch) continue;
    const attrs = itemTagMatch[1];

    const get = (name: string): string | null => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = attrs.match(r);
      return mm ? mm[1] : null;
    };
    const getInt = (name: string): number | null => {
      const v = get(name);
      return v !== null && v !== '' ? parseInt(v, 10) : null;
    };

    const tooltip = parseAuctionTooltip(get('data-tooltip'));
    const fullName = tooltip?.item?.name ?? null;
    const nameParts = splitItemName(fullName);

    let quality = getInt('data-quality');
    if (quality === null && tooltip?.item?.nameStyle) {
      if (/lime/i.test(tooltip.item.nameStyle)) quality = 0;
    }

    const bidDivMatch = formHtml.match(/<div\s+class="auction_bid_div"[\s\S]*$/);
    const bidDivHtml = bidDivMatch ? bidDivMatch[0] : '';

    // Quando há lance, o jogo NÃO mostra a string "Não existem licitações" — em
    // vez disso renderiza o nome do licitador atual com link pro profile:
    //   <a href="?mod=player&p=ID..."><span style="color:blue;font-weight:bold;">NOME</span></a>
    // (validado em produção 2026-04-29 com sample real após dar lance).
    // O VALOR EXATO do lance atual NÃO é exposto — o "Preço baixo" mostrado
    // após o bid é o próximo mínimo (~5% acima do lance corrente), e o
    // input bid_amount também tem esse valor pré-preenchido.
    const bidderMatch = bidDivHtml.match(
      /<a\s+href="[^"]*\bmod=player\b[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<\/a>/i
    );
    const bidderName = bidderMatch ? bidderMatch[1].trim() : null;
    const hasBids = !!bidderName
      || (bidDivHtml.length > 0 && !/Não existem licitações/i.test(bidDivHtml));
    const minBid = toInt(rxOne(formHtml, /<input[^>]*name="bid_amount"[^>]*value="(\d+)"/));
    // myBid é resolvido em actions/auction.js (precisa do charName do snapshot
    // pra comparar com bidderName). Aqui o parser só expõe o nome cru.
    const myBid = false;
    // O bidDivHtml tem dois preços em ouro: "Preço baixo: X" (lance mínimo) e
    // o buyout depois do <input name="buyout">. Isolar a seção de buyout.
    // Whitespace pode ser literal `&nbsp;` (não match em \s).
    // Separadores no HTML real são &nbsp; (às vezes sem `;`) e o <img> de rubis
    // vem dentro de um <a href> (link pra comprar rubis), enquanto Ouro vem solto.
    const buyoutSection = bidDivHtml.split(/name="buyout"/)[1] ?? '';
    const goldSepRubis = /(?:&nbsp;?|\s)*(?:<a[^>]*>)?\s*<img[^>]*title=/;
    const buyoutGold = toInt(rxOne(buyoutSection, new RegExp(`(\\d[\\d.]*)${goldSepRubis.source}"Ouro"`)));
    const buyoutRubies = toInt(rxOne(buyoutSection, new RegExp(`(\\d[\\d.]*)${goldSepRubis.source}"Rubis"`)));

    const basisStr = get('data-basis') || '';
    const basisParts = basisStr.split('-').map((s) => parseInt(s, 10));
    const itemType = Number.isFinite(basisParts[0]) ? basisParts[0] : null;
    const itemSubtype = Number.isFinite(basisParts[1]) ? basisParts[1] : null;

    const listing: AuctionListing = {
      auctionId,
      formTtype,
      itemTypeId: getInt('data-content-type'),
      itemType,
      itemSubtype,
      basis: get('data-basis'),
      hash: get('data-hash'),
      level: getInt('data-level'),
      quality,
      priceGold: getInt('data-price-gold'),
      priceMultiplier: getInt('data-price-multiplier'),
      measurementX: getInt('data-measurement-x'),
      measurementY: getInt('data-measurement-y'),
      name: fullName,
      baseName: nameParts.baseName,
      prefix: nameParts.prefix,
      suffix: nameParts.suffix,
      hasBids,
      bidderName,
      myBid,
      nextMinBid: minBid, // o "Preço baixo" pós-lance é o próximo mínimo, não o lance atual
      minBid,
      buyoutGold,
      buyoutRubies,
      tooltip,
    };
    result.listings.push(listing);
  }

  return result;
}

// Lê HP absoluto do tooltip de #char_leben_tt: linha [["Pontos de vida:", "X / Y"], [...]].
function parseHpFromLebenTooltip(html: string): { value: number; max: number } | null {
  const m = html.match(/id="char_leben_tt"[^>]*data-tooltip="([^"]+)"/);
  if (!m) return null;
  try {
    const json: unknown = JSON.parse(decodeAttr(m[1]));
    let rows: unknown = json;
    while (Array.isArray(rows) && rows.length === 1 && Array.isArray(rows[0])) {
      if (Array.isArray((rows[0] as unknown[])[0])) { rows = rows[0]; break; }
      rows = rows[0];
    }
    if (!Array.isArray(rows)) return null;
    for (const row of rows as unknown[]) {
      if (!Array.isArray(row) || !Array.isArray((row as unknown[])[0])) continue;
      const label = (row as unknown[][])[0][0];
      if (typeof label === 'string' && /Pontos de vida/i.test(label)) {
        const v = String((row as unknown[][])[0][1] || '');
        const mm = v.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        if (mm) return { value: parseInt(mm[1].replace(/\./g, ''), 10), max: parseInt(mm[2].replace(/\./g, ''), 10) };
      }
    }
  } catch { /* ignore */ }
  return null;
}

// Slots equipados no paperdoll (mod=overview). container=8 é a área droppable
// do avatar (heal target), não slot de equipment, então é omitida.
export const EQUIPPED_SLOTS: { container: number; contentType: number; slot: string; label: string }[] = [
  { container: 2,  contentType: 1,    slot: 'helmet',  label: 'Capacete' },
  { container: 3,  contentType: 2,    slot: 'weapon',  label: 'Arma principal' },
  { container: 4,  contentType: 4,    slot: 'offhand', label: 'Arma secundária' },
  { container: 5,  contentType: 8,    slot: 'armor',   label: 'Armadura' },
  { container: 6,  contentType: 48,   slot: 'ring1',   label: 'Anel 1' },
  { container: 7,  contentType: 48,   slot: 'ring2',   label: 'Anel 2' },
  { container: 9,  contentType: 256,  slot: 'pants',   label: 'Calças' },
  { container: 10, contentType: 512,  slot: 'boots',   label: 'Sapatos' },
  { container: 11, contentType: 1024, slot: 'amulet',  label: 'Amuleto' },
];

export interface EquippedSlotResult {
  container: number;
  contentType: number;
  slot: string;
  label: string;
  empty: boolean;
  itemId: string | null;
  basis?: string | null;
  hash?: string | null;
  level: number | null;
  quality?: number | null;
  priceGold?: number | null;
  name: string | null;
  stats?: AuctionStatRow[];
  durability?: { value: number; max: number } | null;
  conditioning?: { value: number; max: number } | null;
  soulbound?: string | null;
}

// Cada slot é um <div data-container-number=N data-content-type=X data-tooltip=... data-item-id=...>.
// Slots ocupados têm data-item-id; slots vazios têm o div mas sem item. O paperdoll também
// renderiza um div "background" por slot sem data-item-id — distinguimos pelo presence dele.
export function parseEquipped(html: string): EquippedSlotResult[] {
  const out: EquippedSlotResult[] = [];
  for (const def of EQUIPPED_SLOTS) {
    const re = new RegExp(
      `<div\\b[^>]*\\bdata-container-number=["']${def.container}["'][^>]*>`,
      'g'
    );
    let chosen: string | null = null;
    for (const m of html.matchAll(re)) {
      if (/data-item-id="\d+"/.test(m[0])) { chosen = m[0]; break; }
    }
    if (!chosen) {
      out.push({ ...def, empty: true, itemId: null, name: null, level: null });
      continue;
    }
    const get = (name: string): string | null => {
      const r = new RegExp(`\\b${name}=["']([^"']*)["']`);
      const mm = chosen!.match(r);
      return mm ? mm[1] : null;
    };
    const tooltipRaw = get('data-tooltip');
    let tooltip: AuctionTooltipBlock | null = null;
    if (tooltipRaw) {
      try {
        const json: unknown = JSON.parse(decodeAttr(tooltipRaw));
        // Equipped tooltip é [[itemRows]] (1 bloco) — leilão usa [item, equipped] (2).
        if (Array.isArray(json) && Array.isArray(json[0])) {
          tooltip = parseAuctionTooltipBlock(json[0] as unknown[]);
        }
      } catch { /* ignore */ }
    }
    const lvl = parseInt(get('data-level') || '', 10);
    const qty = get('data-quality');
    const price = parseInt(get('data-price-gold') || '', 10);
    out.push({
      ...def,
      empty: false,
      itemId: get('data-item-id'),
      basis: get('data-basis'),
      hash: get('data-hash'),
      level: Number.isFinite(lvl) ? lvl : null,
      quality: qty !== null && qty !== '' ? parseInt(qty, 10) : null,
      priceGold: Number.isFinite(price) ? price : null,
      name: tooltip?.name ?? null,
      stats: tooltip?.stats ?? [],
      durability: tooltip?.durability ?? null,
      conditioning: tooltip?.conditioning ?? null,
      soulbound: tooltip?.soulbound ?? null,
    });
  }
  return out;
}

export interface DollTab {
  doll: number;
  role: string | null;
  active: boolean;
}

// Sidebar lateral do overview (charmercsel) lista os 6 dolls disponíveis com
// role tooltip (ex: "Batalha Básica", "Mestre Druida"). Útil pra descobrir
// quais dolls existem antes de fazer GET pra cada um.
export function parseDollTabs(html: string): DollTab[] {
  const tabs: DollTab[] = [];
  const re = /class="charmercsel(\s+active)?"[^>]*onClick="selectDoll\('[^']*doll=(\d+)[^']*'\)"[\s\S]{0,400}?charmercpic\s+doll\d+[\s\S]{0,400}?data-tooltip="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    const active = !!m[1];
    const doll = parseInt(m[2], 10);
    let role: string | null = null;
    try {
      const decoded = m[3]
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const json: unknown = JSON.parse(decoded);
      let row: unknown = json;
      while (Array.isArray(row) && row.length === 1 && Array.isArray(row[0])) row = row[0];
      if (Array.isArray(row) && typeof row[0] === 'string') {
        // Tooltip vem como "Mestre Druida<br /><font ...>Missão: ...</font>".
        // Pegamos a primeira linha (antes do <br>) e strip de tags residuais.
        role = (row[0] as string).split(/<br\b/i)[0].replace(/<[^>]*>/g, '').trim();
      }
    } catch { /* ignore */ }
    tabs.push({ doll, role, active });
  }
  return tabs;
}

export interface CharSnapshot {
  doll: number | null;
  role: string | null;
  name: string | null;
  level: number | null;
  hpPercent: number | null;
  hp: { value: number; max: number } | null;
  armor: number | null;
  damage: string | null;
  stats: StatBlock;
  equipped: EquippedSlotResult[];
  dollTabs: DollTab[];
}

// Snapshot por-doll da página overview. Usa anchors do char ativo (#char_*),
// NÃO os do header global (#header_values_*) que continuam no principal.
// Inclui equipped[] e dollTabs[] pra a UI.
export function parseCharSnapshot(html: string): CharSnapshot {
  const name = rxOne(html, /<div class="playername[^"]*">\s*([^<]+?)\s*<\/div>/);
  const level = toInt(rxOne(html, /id="char_level"[^>]*>(\d+)</));
  const hpPercent = toInt(rxOne(html, /id="char_leben"[^>]*>(\d+)\s*%/));
  const hp = parseHpFromLebenTooltip(html);
  const armor = toInt(rxOne(html, /id="char_panzer"[^>]*>([\d.]+)</));
  const damage = rxOne(html, /id="char_schaden"[^>]*>([^<]+)</);
  const stats = parseStatsBlock(html);
  const equipped = parseEquipped(html);
  const dollTabs = parseDollTabs(html);
  const activeTab = dollTabs.find((t) => t.active) || null;
  return {
    doll: activeTab ? activeTab.doll : null,
    role: activeTab ? activeTab.role : null,
    name,
    level,
    hpPercent,
    hp,
    armor,
    damage: damage ? damage.trim() : null,
    stats,
    equipped,
    dollTabs,
  };
}

// Parser do HTML de mod=work. Detecta trabalho ativo via o ticker de countdown
// que só existe quando há trabalho em andamento.
//
// Sinais observados em produção (BR62):
//   <body id="workPage">
//   <h1 ...>Trabalhar no estábulo</h1>           ← nome do job
//   <td class="tdn">Ainda não terminou seu trabalho. ...</td>
//   <span data-ticker-time-left="4207000" data-ticker-type="countdown" ...>
//
// Quando NÃO está trabalhando, a mesma URL mostra a tela de seleção de jobs
// (sem o `data-ticker-time-left` no padrão de countdown).
export function parseWork(html: string): WorkStatus {
  const m = html.match(/data-ticker-time-left="(\d+)"\s+data-ticker-type="countdown"/);
  if (!m) return { active: false, secondsLeft: null, jobName: null };

  const secondsLeft = Math.max(0, Math.ceil(parseInt(m[1], 10) / 1000));
  const nameMatch = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
  const jobName = nameMatch ? nameMatch[1].trim() : null;
  return { active: true, secondsLeft, jobName };
}
