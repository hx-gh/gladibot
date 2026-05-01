// Lookup do catálogo de prefixos/sufixos.
// Source: data/affixes.json (gerado por docs/wip/auction/build-affixes.mjs).
//
// Limitação conhecida: o catálogo do fansite está em EN. Prefixos têm nomes
// genéricos (Bilgs, Calódiens, ...) que são iguais em PT-BR — match 100%.
// Sufixos são traduzidos no jogo ("of Brightness" / "do Brilho") — match
// quase zero contra o leilão BR. Ver DEBT-06 em TECHNICAL_DEBT.md.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = resolve(__dirname, '..', 'data', 'affixes.json');

interface AffixEntry {
  name: string;
  level?: number;
  top?: boolean;
  effects?: string[];
  rawStats?: unknown;
}

interface AffixCache {
  prefixes: AffixEntry[];
  suffixes: AffixEntry[];
  byName: { prefix: Map<string, AffixEntry>; suffix: Map<string, AffixEntry> };
}

let cache: AffixCache | null = null;

function load(): AffixCache {
  if (cache) return cache;
  if (!existsSync(JSON_PATH)) {
    cache = { prefixes: [], suffixes: [], byName: { prefix: new Map(), suffix: new Map() } };
    return cache;
  }
  const j = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { prefixes?: AffixEntry[]; suffixes?: AffixEntry[] };
  // Filtra ruído: entries de scroll levels "+1..+9" no catálogo de sufixos
  // não são sufixos reais — são níveis de encantamento.
  const isAffix = (a: AffixEntry) => !/^\+\d+$/.test(a.name);
  const prefixes = (j.prefixes || []).filter(isAffix);
  const suffixes = (j.suffixes || []).filter(isAffix);
  const byName = {
    prefix: new Map(prefixes.map((a) => [normalizeName(a.name), a])),
    suffix: new Map(suffixes.map((a) => [normalizeName(a.name), a])),
  };
  cache = { prefixes, suffixes, byName };
  return cache;
}

function normalizeName(s: string): string {
  return String(s || '').trim().toLowerCase();
}

// Busca um prefix pelo nome (case-insensitive). Retorna o entry do catálogo
// ou null. Nomes de prefixo no leilão BR vêm idênticos ao catálogo EN.
export function lookupPrefix(name: string | null | undefined): AffixEntry | null {
  if (!name) return null;
  const c = load();
  return c.byName.prefix.get(normalizeName(name)) ?? null;
}

// Busca um suffix pelo nome inteiro ("do Sofrimento") OU pelo "tail" sem
// conector ("Sofrimento"). Hoje quase nunca acha porque o catálogo é EN —
// retorna null pra esses casos. Quando tivermos mapping PT↔EN (DEBT-06),
// melhora.
export function lookupSuffix(name: string | null | undefined): AffixEntry | null {
  if (!name) return null;
  const c = load();
  const direct = c.byName.suffix.get(normalizeName(name));
  if (direct) return direct;
  const tail = String(name).replace(/^(do|da|dos|das|de)\s+/i, '');
  return c.byName.suffix.get(normalizeName(tail)) ?? null;
}

// Enriquece uma listing já parseada com referências do catálogo.
// Mutates and returns the listing for convenience.
export function enrichListingWithAffixes(listing: Record<string, unknown>): Record<string, unknown> {
  const p = lookupPrefix(listing.prefix as string | null);
  const s = lookupSuffix(listing.suffix as string | null);
  listing.prefixCatalog = p
    ? { name: p.name, level: p.level, top: !!p.top, effects: p.effects, rawStats: p.rawStats }
    : null;
  listing.suffixCatalog = s
    ? { name: s.name, level: s.level, top: !!s.top, effects: s.effects, rawStats: s.rawStats }
    : null;
  listing.topAny = !!(p?.top ?? s?.top);
  listing.affixCoverage =
    (p ? 1 : 0) + (s ? 1 : 0); // 0 = nenhum, 1 = parcial, 2 = ambos no catálogo
  return listing;
}
