// Recomendador de upgrade pros mercs (Painel 3) e ranqueador comum reusado
// pelo Painel 2 via `enrichListingWithWaste`.
//
// Score model:
//   score = Σ (statWeight × roleBoost × Δabs) + lvlDiff/5 + topAffixBonus
//   onde:
//     - Δabs = max(0, itemValue − equippedValue) pra rows úteis (não wasted)
//     - statWeight: peso por categoria (str/dex/.../dano/saúde/cr/...)
//     - roleBoost: vocação do char via `itemsMax` daquela stat (mais alto =
//       char foca naquela stat → peso maior)
//     - lvlDiff/5: continuidade do score original
//     - topAffixBonus: +1 por prefix top, +1 por suffix top
//
//   Stats já no cap do char viram `wasted`: contribuição zero, marcadas pra UI.
//   Stats que viraram down (rows com sign<0) descontam pelo módulo do delta.
//
// Filtros:
//   itemLevelMin = max(currentSlotLevel + 5, charLevel - 14)
//   — pra mercs com gear MUITO atrasado (anel L21 num char L57), aceitamos
//   candidatos a partir de L43 mesmo (charLevel - 14) ou pelo menos +5 sobre
//   o equipado atual. Antes usávamos charLevel - 6 e perdíamos upgrades baratos.
//
// Anéis (ring1/ring2):
//   Cada slot compara contra seu próprio equipado (NÃO contra o pior dos dois).
//   Se ring2 tá L21, candidato L62 é upgrade pro ring2; se ring1 tá L60,
//   o mesmo candidato pode aparecer também (substitui ring2, não ring1).
//   Dedup é responsabilidade do client (mostra "substitui ring2" quando
//   candidato aparece nos dois slots).

import { pairStats, summarizeRows } from './itemCompare.js';
import { EQUIPPED_SLOTS } from './state.js';
import { readEquippedBlock } from './db.js';

// PT-BR → chave canônica do snapshot.stats. Bate com STAT_KEY_PT_TO_EN do client.
const STAT_KEY_PT_TO_EN: Record<string, string> = {
  'força': 'strength',
  'destreza': 'dexterity',
  'agilidade': 'agility',
  'constituição': 'constitution',
  'carisma': 'charisma',
  'inteligência': 'intelligence',
};

// Pesos por unidade absoluta de delta. Calibrados pra atributo principal (+1)
// dominar sobre saúde/armadura — esses dois vêm em magnitude alta no jogo
// (50-500 típico) e estavam inflacionando o score.
//
// IMPORTANTE: as keys são os prefixos canônicos extraídos por `statKey()`.
// Stats compostos como "valor de cura crítica +6" produzem prefix
// `valor de cura crítica`. As versões curtas ('bloqueio', 'cura crítica')
// usadas anteriormente NUNCA batiam com prefixes reais — corrigido em
// 2026-04-30.
//
// Anchors aproximados:
//   +25 atributo principal     ≈ 25 score
//   +250 saúde                 ≈  5 score
//   +100 armadura              ≈ 10 score
//   +50 dano (range)           ≈ 20 score
//   +5% crítico                ≈  7.5 score
const STAT_VALUE_WEIGHT: Record<string, number> = {
  'força': 1.0, 'destreza': 1.0, 'agilidade': 1.0,
  'constituição': 1.0, 'carisma': 1.0, 'inteligência': 1.0,
  'dano': 0.4,
  'armadura': 0.1,
  'saúde': 0.02,
  'cura': 0.02,
  'valor de dano crítico': 1.5,
  'valor de cura crítica': 1.5,
  'valor de bloqueio': 1.5,
  'evoluindo o valor': 1.5,    // bônus de bloqueio
  'ameaça': 0.5,
  'resistência': 0.5,
  'redução': 0.5,
  'experiência': 0.4,
};

// Overrides de peso por role da merc. Cada role tem stats que importam (peso
// alto) e stats irrelevantes/contraproducentes (peso 0). Aplicados em cima do
// STAT_VALUE_WEIGHT quando a role da merc é classificada.
//
// Roles:
//   medico  — cura, cura crítica, inteligência (sustento de party)
//   tanque  — bloqueio, ameaça, evoluindo (puxar dano), saúde, constituição
//   killer  — dano, dano crítico, força/destreza (DPS puro)
//
// Default fica STAT_VALUE_WEIGHT pra char sem role classificada.
const ROLE_WEIGHT_OVERRIDES: Record<string, Record<string, number>> = {
  medico: {
    'cura': 1.0,
    'valor de cura crítica': 2.5,
    'inteligência': 1.5,
    'constituição': 0.8,
    'saúde': 0.05,
    'carisma': 0.3,
    'dano': 0.0,
    'valor de dano crítico': 0.0,
    'força': 0.1,
    'destreza': 0.1,
    'agilidade': 0.1,
    'ameaça': 0.0,
    'valor de bloqueio': 0.0,
    'evoluindo o valor': 0.0,
  },
  tanque: {
    'valor de bloqueio': 2.0,
    'evoluindo o valor': 2.0,
    'ameaça': 1.5,
    'constituição': 1.5,
    'saúde': 0.1,
    'armadura': 0.2,
    'dano': 0.1,
    'valor de dano crítico': 0.2,
    'cura': 0.3,
    'valor de cura crítica': 0.5,
    'inteligência': 0.0,
    'força': 0.5,
    'destreza': 0.5,
    'agilidade': 0.5,
  },
  killer: {
    'dano': 0.8,
    'valor de dano crítico': 2.5,
    'força': 1.0,
    'destreza': 1.0,
    'agilidade': 1.0,
    'carisma': 1.0,
    'cura': 0.0,
    'valor de cura crítica': 0.0,
    'inteligência': 0.0,
    'ameaça': 0.0,
    'valor de bloqueio': 0.0,
    'evoluindo o valor': 0.0,
  },
};

// Ordem fixa de roles por posição da merc (usuário mapeou em 2026-04-30).
// Aplicada quando inferência por nome/equipamento falha. Posição = index na
// lista de MERCS REAIS (doll != 1), ordenados por doll asc.
const ROLE_BY_POSITION: string[] = ['medico', 'killer', 'tanque', 'killer'];

type MercRole = 'medico' | 'killer' | 'tanque' | null;

interface CharEquipItem {
  stats?: Array<{ label?: string | null }> | null;
}

interface Char {
  doll: number;
  role?: string | null;
  level?: number | null;
  name?: string | null;
  stats?: Record<string, { total?: number | null; max?: number | null; itemsMax?: number | null } | null> | null;
  equipped?: CharEquipItem[] | null;
}

// Detecta role pelo nome da role do char ou pelas stats do equipamento.
// Druida → medico; presença de bloqueio/ameaça em múltiplas peças → tanque;
// resto → null (caller decide fallback).
//
// Contagem por PEÇA (não por stat): uma armadura defensiva pode ter 3 stats
// de bloqueio/ameaça/evoluindo numa peça só — sem o `break`, killer com 1 peça
// defensiva era classificado como tanque.
function inferRoleFromChar(char: Char): MercRole {
  const roleName = (char.role || '').toLowerCase();
  if (/druida|sacerdote|curandeir|m[eé]dico/.test(roleName)) return 'medico';
  let healPieces = 0;
  let blockPieces = 0;
  for (const it of char.equipped || []) {
    let pieceHasHeal = false;
    let pieceHasBlock = false;
    for (const s of it.stats || []) {
      const lbl = (s.label || '').toLowerCase();
      if (/^cura\b|valor de cura/.test(lbl)) pieceHasHeal = true;
      if (/valor de bloqueio|^ameaça|evoluindo o valor/.test(lbl)) pieceHasBlock = true;
    }
    if (pieceHasHeal) healPieces++;
    if (pieceHasBlock) blockPieces++;
  }
  if (healPieces >= 3) return 'medico';
  if (blockPieces >= 3) return 'tanque';
  return null;
}

// `mercPosition` é o index entre MERCS reais (doll != 1). Pra doll=1 (player
// main), não aplica ROLE_BY_POSITION — usa só inferência por nome/stats e cai
// pra null (= sem override; usa STAT_VALUE_WEIGHT puro + roleStatBoost).
export function resolveMercRole(char: Char, mercPosition: number): MercRole {
  if (char.doll === 1) {
    return inferRoleFromChar(char); // pode ser null
  }
  return inferRoleFromChar(char) || (ROLE_BY_POSITION[mercPosition] as MercRole) || 'killer';
}

// Cap de retornos: stat com magnitude muito acima do "típico" tem returns
// diminuídos (50% após o cap). Evita item especial com saúde +1000 dominar
// o ranking.
const STAT_DELTA_CAP: Record<string, number> = {
  'saúde': 400,
  'cura': 400,
  'armadura': 200,
  'dano': 100,
};

function statValueWeight(prefix: string, role: MercRole): number {
  if (role && ROLE_WEIGHT_OVERRIDES[role]) {
    const overrides = ROLE_WEIGHT_OVERRIDES[role]!;
    if (prefix in overrides) return overrides[prefix]!;
  }
  return STAT_VALUE_WEIGHT[prefix] ?? 0.5;
}

function capDelta(prefix: string, delta: number): number {
  const cap = STAT_DELTA_CAP[prefix];
  if (!cap || Math.abs(delta) <= cap) return delta;
  const overflow = Math.abs(delta) - cap;
  const sign = delta < 0 ? -1 : 1;
  return sign * (cap + overflow * 0.5);
}

// roleStatBoost: usa `itemsMax` (cap dos items pra aquela stat no char) como
// proxy da vocação. Stat com itemsMax alto = char foca aí (e provavelmente
// quer mais). Stat com itemsMax 0 = irrelevante pro role (ex: Inteligência
// num lutador puro).
function roleStatBoost(charStats: Char['stats'], prefix: string): number {
  if (!charStats) return 1.0;
  const enKey = STAT_KEY_PT_TO_EN[prefix];
  if (!enKey) return 1.0; // dano/armor/saúde: sem boost de vocação
  const s = charStats[enKey];
  if (!s || s.itemsMax == null) return 1.0;
  if (s.itemsMax >= 80) return 1.6;
  if (s.itemsMax >= 30) return 1.0;
  if (s.itemsMax >= 5) return 0.6;
  return 0.25;             // praticamente irrelevante pro role
}

interface ScoredRow {
  key: string;
  sign: number;
  wasted?: boolean;
  deltaNum?: number | null;
  itemValue?: number | null;
  equippedValue?: number | null;
}

// Marca rows com `wasted` quando vão pra stat já no cap do char.
// Retorna contagem pra summary.
function annotateWaste(rows: ScoredRow[], charStats: Char['stats']): { wastedUps: number; usefulUps: number; atCap: string[] } {
  let wastedUps = 0;
  let usefulUps = 0;
  const atCap: string[] = [];
  for (const r of rows) {
    if (r.sign <= 0) continue;
    const prefix = (r.key.split('-')[0] ?? '').toLowerCase();
    const charKey = STAT_KEY_PT_TO_EN[prefix];
    if (!charKey) { usefulUps++; continue; }
    const s = charStats?.[charKey];
    if (!s || s.total == null || s.max == null) { usefulUps++; continue; }
    if (s.total >= s.max) {
      r.wasted = true;
      wastedUps++;
      atCap.push(prefix);
    } else {
      usefulUps++;
    }
  }
  return { wastedUps, usefulUps, atCap };
}

// Magnitude weighted score: Σ (peso × boost × cap(Δ)) + lvlDiff/5 + topBonus.
// `cap(Δ)` aplica diminishing returns acima do "típico" pra evitar items
// outlier (saúde +1000) dominar o ranking.
//
// `role` (opcional): aplica ROLE_WEIGHT_OVERRIDES por cima de STAT_VALUE_WEIGHT.
function computeWeightedScore(rows: ScoredRow[], charStats: Char['stats'], lvlDiff: number, topBonus: number, role: MercRole = null): number {
  let weighted = 0;
  for (const r of rows) {
    if (r.wasted) continue;
    const prefix = (r.key.split('-')[0] ?? '').toLowerCase();
    const w = statValueWeight(prefix, role);
    const boost = roleStatBoost(charStats, prefix);
    const rawDelta = r.deltaNum != null
      ? r.deltaNum
      : (r.itemValue ?? 0) - (r.equippedValue ?? 0);
    const delta = capDelta(prefix, rawDelta);
    if (delta === 0) continue;
    weighted += w * boost * delta;
  }
  return weighted + (lvlDiff || 0) / 5 + (topBonus || 0);
}

// Custo do candidato em "gold equivalent" pra ranking de eficiência. 1 ruby
// ≈ 1500 gold no servidor BR62 (estimativa empírica — refinar se vier dado).
const RUBY_TO_GOLD = 1500;

interface ListingCandidate {
  buyoutGold?: number | null;
  buyoutRubies?: number | null;
  minBid?: number | null;
  prefixCatalog?: { top?: boolean } | null;
  suffixCatalog?: { top?: boolean } | null;
  itemType?: number | null;
  level?: number | null;
  auctionId?: number;
  formTtype?: number | null;
  name?: string | null;
  baseName?: string | null;
  quality?: number | null;
  buyoutAvailable?: boolean;
  hasBids?: boolean;
  tooltip?: { item?: { stats?: unknown[]; level?: number | null; soulbound?: string | null; name?: string | null } | null } | null;
}

function candidateCost(c: ListingCandidate): number {
  const gold = c.buyoutGold ?? 0;
  const rubies = c.buyoutRubies ?? 0;
  const fallback = c.minBid ?? 0;
  const cost = gold + rubies * RUBY_TO_GOLD;
  return cost > 0 ? cost : fallback;
}

function computeEfficiency(score: number, cost: number): number {
  if (!cost || cost <= 0) return 0;
  return Math.round((score / (cost / 1000)) * 100) / 100; // score por 1k gold
}

function topAffixBonus(listing: ListingCandidate): number {
  let bonus = 0;
  if (listing.prefixCatalog?.top) bonus += 1;
  if (listing.suffixCatalog?.top) bonus += 1;
  return bonus;
}

export const SLOT_TO_ITEMTYPE: Record<string, number> = {
  helmet: 4, weapon: 1, offhand: 2, armor: 3,
  ring1: 6, ring2: 6, pants: 5, boots: 8, amulet: 9,
  // pants = 5 (bracers/luvas/calça); confirmed via data-basis=5-X em
  // paperdoll equipped. type=11 é consumível (Frasco/Falcão/Ampulheta).
};

const SLOT_LABEL: Record<string, string> = Object.fromEntries(EQUIPPED_SLOTS.map((d) => [d.slot, d.label]));

function qualityPenalty(quality: number | null | undefined): number {
  if (quality === null || quality === undefined) return 5;
  if (quality === 0) return 3;
  return 0;
}

interface EquippedSlotItem {
  slot: string;
  empty?: boolean;
  level?: number | null;
  quality?: number | null;
  name?: string | null;
}

export function rankSlots(char: Char & { equipped?: EquippedSlotItem[] | null }): Array<{ slot: string; priority: number; current: EquippedSlotItem | null }> {
  const equippedByslot: Record<string, EquippedSlotItem> = {};
  for (const it of char.equipped || []) equippedByslot[it.slot] = it;
  const ranked: Array<{ slot: string; priority: number; current: EquippedSlotItem | null }> = [];
  for (const slot of Object.keys(SLOT_TO_ITEMTYPE)) {
    const it = equippedByslot[slot];
    let priority: number;
    if (!it || it.empty) {
      priority = 999;
    } else {
      const lvlGap = (char.level ?? 0) - (it.level ?? 0);
      priority = lvlGap + qualityPenalty(it.quality);
    }
    ranked.push({ slot, priority, current: it && !it.empty ? it : null });
  }
  ranked.sort((a, b) => b.priority - a.priority);
  return ranked;
}

// Helper genérico pro Painel 2: enriquece um listing já com `comparison.rows`
// vindas do `buildComparison` original aplicando waste check + score
// magnitude-weighted contra o snapshot do char ativo. Mutates `listing`.
export function enrichListingWithWaste(listing: Record<string, unknown>, charStats: Char['stats']): void {
  const cmp = listing.comparison as { rows?: ScoredRow[]; summary?: Record<string, unknown> } | null;
  if (!cmp || !Array.isArray(cmp.rows)) return;
  const waste = annotateWaste(cmp.rows, charStats);
  const lvlDiff = (cmp.summary?.['lvlDiff'] as number | undefined) ?? 0;
  const topBonus = topAffixBonus(listing as ListingCandidate);
  const weightedScore = computeWeightedScore(cmp.rows, charStats, lvlDiff, topBonus);
  const score = Math.round(weightedScore * 10) / 10;
  const summary = {
    ...(cmp.summary || {}),
    up: waste.usefulUps,
    rawUp: (cmp.summary?.['up'] as number | undefined) ?? waste.usefulUps + waste.wastedUps,
    wastedUps: waste.wastedUps,
    atCap: waste.atCap,
    topAffixBonus: topBonus,
    score,
    isUpgrade: score > 0,
  };
  cmp.summary = summary;
}

interface BuildSuggestionsOptions {
  topPerSlot?: number;
  slotsToConsider?: number;
}

export function buildSuggestions(allListings: ListingCandidate[], mercs: Array<Char & { equipped?: EquippedSlotItem[] | null }>, options: BuildSuggestionsOptions = {}): unknown[] {
  const topPerSlot = options.topPerSlot ?? 3;
  const slotsToConsider = options.slotsToConsider ?? 4;

  // Conta posição entre mercs reais (doll != 1) pra ROLE_BY_POSITION.
  let mercIndex = 0;
  return mercs.map((char) => {
    const position = char.doll === 1 ? -1 : mercIndex++;
    const mercRole = resolveMercRole(char, position);
    const ranked = rankSlots(char).slice(0, slotsToConsider);
    const suggestions: unknown[] = [];
    for (const r of ranked) {
      const itemType = SLOT_TO_ITEMTYPE[r.slot];
      const baseline = readEquippedBlock(char.doll, r.slot);
      // Filtro mais permissivo: aceita itens 5 acima do equipado atual ou
      // ate 14 abaixo do char (cobre upgrades baratos pra slots muito
      // atrasados).
      const itemLevelMin = Math.max(
        (baseline?.level ?? 0) + 5,
        (char.level ?? 0) - 14,
      );

      const scored: unknown[] = [];
      for (const l of allListings) {
        if (l.itemType !== itemType) continue;
        const itemBlock = l.tooltip?.item;
        if (!itemBlock) continue;
        if (Number.isFinite(l.level) && l.level! < itemLevelMin) continue;

        const rows = pairStats(itemBlock as Parameters<typeof pairStats>[0], baseline as Parameters<typeof pairStats>[1]);
        const itemLevel = itemBlock.level ?? l.level ?? null;
        const equippedLevel = baseline?.level ?? 0;
        const rawSummary = summarizeRows(rows, true, { itemLevel: itemLevel ?? undefined, equippedLevel });

        // 1. Marca rows wasted conforme o cap do merc.
        const waste = annotateWaste(rows, char.stats);

        // 2. Score weighted por magnitude × peso(role) × role boost + bonus de top.
        const topBonus = topAffixBonus(l);
        const weightedScore = computeWeightedScore(
          rows, char.stats, rawSummary.lvlDiff, topBonus, mercRole,
        );
        const score = Math.round(weightedScore * 10) / 10;
        if (score <= 0) continue; // descarta se net não positivo

        // 3. Cost effectiveness.
        const cost = candidateCost(l);
        const efficiency = computeEfficiency(score, cost);

        const adjustedSummary = {
          ...rawSummary,
          up: waste.usefulUps,
          rawUp: rawSummary.up,
          wastedUps: waste.wastedUps,
          atCap: waste.atCap,
          topAffixBonus: topBonus,
          score,
          efficiency,
          isUpgrade: true,
        };

        scored.push({
          auctionId: l.auctionId,
          formTtype: l.formTtype ?? null,
          name: l.name,
          baseName: l.baseName,
          level: l.level,
          quality: l.quality,
          buyoutGold: l.buyoutGold,
          buyoutRubies: l.buyoutRubies,
          minBid: l.minBid,
          buyoutAvailable: l.buyoutAvailable,
          hasBids: l.hasBids,
          soulbound: itemBlock.soulbound ?? null,
          cost,
          summary: adjustedSummary,
          comparison: {
            hasComparison: true,
            equippedName: baseline?.name ?? null,
            itemLevel,
            equippedLevel,
            rows,
            summary: adjustedSummary,
          },
        });
      }

      // Sort: score primário, eficiência como tiebreaker.
      (scored as Array<{ summary: { score?: number; efficiency?: number } }>).sort((a, b) => {
        const ds = (b.summary.score ?? 0) - (a.summary.score ?? 0);
        if (Math.abs(ds) > 0.5) return ds;
        return (b.summary.efficiency ?? 0) - (a.summary.efficiency ?? 0);
      });

      suggestions.push({
        slot: r.slot,
        slotLabel: SLOT_LABEL[r.slot] ?? r.slot,
        priority: r.priority,
        currentName: r.current?.name ?? null,
        currentLevel: r.current?.level ?? null,
        currentQuality: r.current?.quality ?? null,
        candidates: (scored as unknown[]).slice(0, topPerSlot),
      });
    }
    return {
      doll: char.doll,
      name: char.name,
      level: char.level,
      role: char.role,
      mercRole,
      suggestions,
    };
  });
}
