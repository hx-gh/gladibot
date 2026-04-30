// Pareamento de stats (item leiloado × item equipado) para a UI de leilão.
//
// O tooltip do leilão pode trazer 2 formatos por linha de stat:
//   1) Simples: { label, color }                                  (ex: bloco "equipado")
//   2) Dual:    { label, color, delta }   ← delta calculado pelo jogo
//                                            (ex: "+10 - 13", "0", "+3% (+4)")
//
// Quando o jogo entrega `delta`, usamos como fonte de verdade pro sinal
// (up/down/same). Quando não entrega, casamos por chave canônica
// (`statKey`) e comparamos os valores numéricos extraídos.

// Mapeamento da primeira parte de `data-basis` (ex: "1-12") pra label de
// categoria. Bate com o select de filtro do leilão (ver leilao1-analysis.md).
// itemType vem da primeira parte de `data-basis` do listing/paperdoll.
// Mapeamento confirmado empiricamente em 2026-04-29 inspecionando o leilão real:
// type=5 cobre bracers/luvas/proteção de antebraço (slot `pants` do paperdoll
// — apesar do label "Pants" no schema interno, o jogo PT-BR chama "Alça" e
// inclui peças como "Luvas de cobre", "Braceletes de ferro", "Protetor de
// cobre"). type=11 é CONSUMÍVEL (Frasco, Falcão, Ampulheta), type=7 é CURA
// (Maçã, Poção), type=12 é MELHORIAS (Pó).
export const ITEM_CATEGORY_LABEL = {
  1: 'Arma',
  2: 'Escudo',
  3: 'Armadura',
  4: 'Capacete',
  5: 'Alça',
  6: 'Anel',
  7: 'Cura',
  8: 'Sapatos',
  9: 'Amuleto',
  11: 'Consumível',
  12: 'Melhoria',
  15: 'Mercenário',
};

export function categoryLabel(itemType) {
  if (itemType === null || itemType === undefined) return null;
  return ITEM_CATEGORY_LABEL[itemType] || `tipo ${itemType}`;
}

// Chave canônica pra parear stats entre item × equipado. Considera flat vs
// percent como stats DIFERENTES (o jogo lista "Força +7" e "Força +13% (+20)"
// como duas linhas distintas no mesmo item).
export function statKey(label) {
  if (!label) return '';
  if (/^Dano\s+\d+\s*-\s*\d+/.test(label)) return 'dano-range';
  const isPct = /%/.test(label);
  const m = label.match(/^([^:+\-\d]+?)(?:\s*[:+-]|\s+\d)/);
  const prefix = (m ? m[1] : label).trim().toLowerCase();
  return `${prefix}-${isPct ? 'pct' : 'flat'}`;
}

// Extrai um único valor numérico representativo do label, pra comparar quando
// o jogo não nos dá `delta` pré-calculado.
//   "Dano 67 - 86"          → midpoint = 76.5
//   "Força +13% (+20)"      → 20  (absoluto entre parênteses)
//   "Bônus de bloqueio: 7%" → 7
//   "Força +7"              → 7
//   "Constituição -2"       → -2
export function statValue(label) {
  if (!label) return 0;
  const range = label.match(/(\d+)\s*-\s*(\d+)\s*$/);
  if (range) return (parseInt(range[1], 10) + parseInt(range[2], 10)) / 2;
  const pctAbs = label.match(/\(([+-]?\d+)\)/);
  if (pctAbs) return parseInt(pctAbs[1], 10);
  const colon = label.match(/:\s*([+-]?\d+)/);
  if (colon) return parseInt(colon[1], 10);
  const flat = label.match(/([+-]\d+)/);
  if (flat) return parseInt(flat[1], 10);
  return 0;
}

// Sinal a partir do delta string entregue pelo jogo. "0" → 0, "+N" → 1,
// "-N" → -1. Pra ranges como "+10 - 13", usa o primeiro número assinado.
export function deltaSign(delta) {
  if (!delta) return 0;
  const s = String(delta).trim();
  if (!s || s === '0') return 0;
  const m = s.match(/[+-]\d+/);
  if (!m) return 0;
  const v = parseInt(m[0], 10);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// Magnitude numérica do delta string entregue pelo jogo. Pra valores
// percentuais como "+3% (+3)" pega o absoluto entre parênteses; pra "+121"
// pega direto; pra ranges "+10 - 13" usa o primeiro número.
export function deltaValue(delta) {
  if (!delta) return 0;
  const s = String(delta).trim();
  const pctAbs = s.match(/\(([+-]?\d+)\)/);
  if (pctAbs) return parseInt(pctAbs[1], 10);
  const m = s.match(/[+-]?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function signFromValues(itemValue, equippedValue) {
  const diff = (itemValue ?? 0) - (equippedValue ?? 0);
  return diff > 0 ? 1 : diff < 0 ? -1 : 0;
}

// Normaliza linhas {label, color, delta?} num shape com chave + valor numérico
// pra parear.
function annotate(stats) {
  return (stats || []).map((s) => ({
    label: s.label,
    color: s.color || null,
    delta: s.delta || null,
    key: statKey(s.label),
    value: statValue(s.label),
  }));
}

// Stats principais que devem ser somados (flat + %) numa única linha de
// comparação. O jogo lista "Força +7" e "Força +13% (+20)" separados, mas
// pro char o que conta é a Força efetiva total = 7 + 20 = 27.
const CONSOLIDATABLE_STATS = new Set([
  'força', 'destreza', 'agilidade', 'constituição', 'carisma', 'inteligência',
]);

function extractValueToken(label) {
  if (!label) return null;
  const m = label.match(/([+-]\d+%?)/);
  return m ? m[0] : null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Junta as linhas `força-flat` + `força-pct` (e equivalentes) numa só linha
// "Força" com valor efetivo = soma dos absolutos. Mantém o detalhamento das
// componentes no label entre parênteses pra não perder informação. Stats
// fora de `CONSOLIDATABLE_STATS` (Dano range, Armadura, Saúde, etc.) passam
// direto sem mudança.
//
// `opts.useGameDelta`: se true, soma os `deltaNum` dos componentes (delta
// canônico do jogo, total do char) em vez de calcular itemTotal-equippedTotal
// (math direta entre values, errada quando values são totais do char).
function consolidateMainStats(rows, opts = {}) {
  const useGameDelta = !!opts.useGameDelta;
  const buckets = new Map();
  const passthrough = [];
  for (const r of rows) {
    const prefix = (r.key.split('-')[0] || '').toLowerCase();
    if (CONSOLIDATABLE_STATS.has(prefix)) {
      if (!buckets.has(prefix)) buckets.set(prefix, []);
      buckets.get(prefix).push(r);
    } else {
      passthrough.push(r);
    }
  }

  const consolidated = [];
  for (const [prefix, group] of buckets) {
    if (group.length === 1) {
      // Re-chaveia pra `prefix` direto (sem -flat/-pct) pra bater com o
      // analyzeRecommendation no client.
      consolidated.push({ ...group[0], key: prefix });
      continue;
    }
    let itemTotal = null;
    let equippedTotal = null;
    let deltaSum = 0;
    let deltaPresent = false;
    const itemParts = [];
    const equippedParts = [];
    for (const r of group) {
      if (r.itemValue !== null && r.itemValue !== undefined) {
        itemTotal = (itemTotal ?? 0) + r.itemValue;
        const tk = extractValueToken(r.itemLabel);
        if (tk) itemParts.push(tk);
      }
      if (r.equippedValue !== null && r.equippedValue !== undefined) {
        equippedTotal = (equippedTotal ?? 0) + r.equippedValue;
        const tk = extractValueToken(r.equippedLabel);
        if (tk) equippedParts.push(tk);
      }
      if (useGameDelta && r.deltaNum != null) {
        deltaSum += r.deltaNum;
        deltaPresent = true;
      }
    }
    const cap = capitalize(prefix);
    const fmtTotal = (n, parts) => {
      const sign = n >= 0 ? '+' : '';
      const detail = parts.length > 1 ? ` (${parts.join(' + ')})` : '';
      return `${cap} ${sign}${n}${detail}`;
    };
    const itemLabel = itemTotal !== null ? fmtTotal(itemTotal, itemParts) : null;
    const equippedLabel = equippedTotal !== null ? fmtTotal(equippedTotal, equippedParts) : null;
    let deltaNum;
    if (deltaPresent) {
      deltaNum = deltaSum;
    } else if (itemTotal !== null && equippedTotal !== null) {
      deltaNum = itemTotal - equippedTotal;
    } else if (itemTotal !== null) {
      deltaNum = itemTotal;
    } else if (equippedTotal !== null) {
      deltaNum = -equippedTotal;
    } else {
      deltaNum = 0;
    }
    const sign = deltaNum > 0 ? 1 : deltaNum < 0 ? -1 : 0;
    consolidated.push({
      key: prefix,
      itemLabel,
      itemValue: itemTotal,
      equippedLabel,
      equippedValue: equippedTotal,
      deltaLabel: `${deltaNum >= 0 ? '+' : ''}${deltaNum}`,
      deltaNum,
      sign,
      consolidated: true,
    });
  }
  return [...consolidated, ...passthrough];
}

// Pareia stats do item leiloado × stats do equipado por chave canônica.
//
// `opts.useGameDelta`: quando true, usa o `eq.delta` (delta canônico do jogo
// no tooltip duplo do leilão = mudança no total do char). Pro Painel 2 isso
// é correto, porque os values do equipped block são TOTAIS do char (não do
// slot sozinho), então math direta `item−equipped` daria valores absurdos.
//
// Quando false (default), usa math direta `itemValue − equippedValue`. Pro
// Painel 3 (mercs lendo do paperdoll do DB) isso é correto, porque values
// são individuais do item equipado e não há delta do jogo (delta=null sempre).
//
// Saída: rows `{ key, itemLabel, itemValue, equippedLabel, equippedValue,
// deltaLabel, deltaNum, sign }`. `deltaNum` é a magnitude numérica usada
// pelo score weighted; `deltaLabel` é o string pra UI exibir.
export function pairStats(itemBlock, equippedBlock, opts = {}) {
  const useGameDelta = !!opts.useGameDelta;
  const itemStats = annotate(itemBlock?.stats);
  const equippedStats = annotate(equippedBlock?.stats);

  const used = new Set();
  const rows = [];

  for (const s of itemStats) {
    let eqIdx = -1;
    for (let i = 0; i < equippedStats.length; i++) {
      if (used.has(i)) continue;
      if (equippedStats[i].key === s.key) { eqIdx = i; break; }
    }
    const eq = eqIdx !== -1 ? equippedStats[eqIdx] : null;
    if (eq) used.add(eqIdx);

    let deltaLabel = null;
    let deltaNum;
    let sign;
    if (useGameDelta && eq?.delta) {
      deltaLabel = eq.delta;
      deltaNum = deltaValue(eq.delta);
      sign = deltaSign(eq.delta);
    } else if (s.delta) {
      deltaLabel = s.delta;
      deltaNum = deltaValue(s.delta);
      sign = deltaSign(s.delta);
    } else {
      deltaNum = (s.value ?? 0) - (eq?.value ?? 0);
      sign = signFromValues(s.value, eq?.value ?? 0);
    }

    rows.push({
      key: s.key,
      itemLabel: s.label,
      itemValue: s.value,
      equippedLabel: eq ? eq.label : null,
      equippedValue: eq ? eq.value : null,
      deltaLabel,
      deltaNum,
      sign,
    });
  }

  // stats que existem só no equipado (item leiloado nem tem)
  equippedStats.forEach((e, i) => {
    if (used.has(i)) return;
    let deltaLabel = null;
    let deltaNum;
    let sign;
    if (useGameDelta && e.delta) {
      deltaLabel = e.delta;
      deltaNum = deltaValue(e.delta);
      sign = deltaSign(e.delta);
    } else {
      deltaNum = -(e.value ?? 0);
      sign = -1;
    }
    rows.push({
      key: e.key,
      itemLabel: null,
      itemValue: null,
      equippedLabel: e.label,
      equippedValue: e.value,
      deltaLabel,
      deltaNum,
      sign,
    });
  });

  return consolidateMainStats(rows, { useGameDelta });
}

// Resumo agregado pra UI: contagem de ups/downs/same e flag heurística
// `isUpgrade`. Combina o sinal de cada linha com o gap de level item × equipado
// — diferença grande de level (item muito mais novo) é um forte sinal de
// upgrade mesmo perdendo alguns flats antigos. Cada 5 levels de gap valem
// 1 "ponto" no score, balanceado contra (ups − downs).
export function summarizeRows(rows, hasComparison, options = {}) {
  let up = 0, down = 0, same = 0;
  for (const r of rows) {
    if (!hasComparison) continue;
    if (r.sign > 0) up++;
    else if (r.sign < 0) down++;
    else same++;
  }
  const itemLevel = Number.isFinite(options.itemLevel) ? options.itemLevel : null;
  const equippedLevel = Number.isFinite(options.equippedLevel) ? options.equippedLevel : null;
  const lvlDiff = itemLevel !== null && equippedLevel !== null ? itemLevel - equippedLevel : 0;
  const score = (up - down) + lvlDiff / 5;
  return {
    up,
    down,
    same,
    lvlDiff,
    score: Math.round(score * 10) / 10,
    isUpgrade: hasComparison && score > 0,
    hasComparison,
  };
}

// Função "porteira" pro auction.js: dado um listing já parseado, devolve
// `{ category, comparison: { rows, summary, equippedName, itemLevel, equippedLevel } }`.
export function buildComparison(listing) {
  const itemBlock = listing.tooltip?.item;
  const equippedBlock = listing.tooltip?.equipped;
  // Há comparação se o equipado existe E tem ao menos um stat. Soulbound
  // sozinho não conta — slot pode estar tecnicamente vazio.
  const hasComparison = !!(equippedBlock && Array.isArray(equippedBlock.stats) && equippedBlock.stats.length > 0);
  // Painel 2: tooltip duplo do leilão tem delta canônico no equipped block
  // (= mudança no total do char ativo). Math direta entre values seria errada
  // porque equippedValue é o total do char, não o valor do slot.
  const rows = pairStats(itemBlock, equippedBlock, { useGameDelta: true });
  const itemLevel = itemBlock?.level ?? listing.level ?? null;
  const equippedLevel = equippedBlock?.level ?? null;
  const summary = summarizeRows(rows, hasComparison, { itemLevel, equippedLevel });
  return {
    category: categoryLabel(listing.itemType),
    comparison: {
      hasComparison,
      equippedName: equippedBlock?.name || null,
      itemLevel,
      equippedLevel,
      rows,
      summary,
    },
  };
}
