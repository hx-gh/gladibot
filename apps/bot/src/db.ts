import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { log } from './log.js';
import type { CharacterRow, EquippedItemRow, DollId } from '@gladibot/shared';

// Estado atual (SEM histórico) — upsert por doll/slot. Schema simples,
// otimizado pra "qual o gear de cada char agora". Snapshot histórico, se
// precisar no futuro, vira tabela separada (chars_history etc).
//
// Uso `node:sqlite` built-in (Node 22+) em vez de better-sqlite3 pra evitar
// compilação nativa via node-gyp (que requer Python + build tools no Windows).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  doll        INTEGER PRIMARY KEY,
  role        TEXT,
  name        TEXT,
  level       INTEGER,
  hp_value    INTEGER,
  hp_max      INTEGER,
  hp_percent  INTEGER,
  armor       INTEGER,
  damage      TEXT,
  stats_json  TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS equipped_items (
  doll          INTEGER NOT NULL,
  slot          TEXT    NOT NULL,
  label         TEXT,
  container     INTEGER,
  content_type  INTEGER,
  item_id       TEXT,
  basis         TEXT,
  hash          TEXT,
  level         INTEGER,
  quality       INTEGER,
  price_gold    INTEGER,
  name          TEXT,
  stats_json    TEXT,
  durability_json TEXT,
  conditioning_json TEXT,
  soulbound     TEXT,
  empty         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (doll, slot)
);
`;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = path.resolve('data/state.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  log.debug(`SQLite ready at ${dbPath}`);
  return db;
}

const upsertCharSql = `
INSERT INTO characters (doll, role, name, level, hp_value, hp_max, hp_percent, armor, damage, stats_json, updated_at)
VALUES (:doll, :role, :name, :level, :hp_value, :hp_max, :hp_percent, :armor, :damage, :stats_json, :updated_at)
ON CONFLICT(doll) DO UPDATE SET
  role=excluded.role, name=excluded.name, level=excluded.level,
  hp_value=excluded.hp_value, hp_max=excluded.hp_max, hp_percent=excluded.hp_percent,
  armor=excluded.armor, damage=excluded.damage, stats_json=excluded.stats_json,
  updated_at=excluded.updated_at;
`;

const upsertItemSql = `
INSERT INTO equipped_items (doll, slot, label, container, content_type, item_id, basis, hash,
  level, quality, price_gold, name, stats_json, durability_json, conditioning_json, soulbound, empty, updated_at)
VALUES (:doll, :slot, :label, :container, :content_type, :item_id, :basis, :hash,
  :level, :quality, :price_gold, :name, :stats_json, :durability_json, :conditioning_json, :soulbound, :empty, :updated_at)
ON CONFLICT(doll, slot) DO UPDATE SET
  label=excluded.label, container=excluded.container, content_type=excluded.content_type,
  item_id=excluded.item_id, basis=excluded.basis, hash=excluded.hash, level=excluded.level,
  quality=excluded.quality, price_gold=excluded.price_gold, name=excluded.name,
  stats_json=excluded.stats_json, durability_json=excluded.durability_json,
  conditioning_json=excluded.conditioning_json, soulbound=excluded.soulbound,
  empty=excluded.empty, updated_at=excluded.updated_at;
`;

// node:sqlite não aceita undefined nos params nomeados — precisa ser null/string/number.
function n<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

// Shape loosely typed since it comes from parser output (not fully typed yet)
type ParsedChar = {
  doll: number;
  role?: string | null;
  name?: string | null;
  level?: number | null;
  hp?: { value: number; max: number } | null;
  hpPercent?: number | null;
  armor?: number | null;
  damage?: string | null;
  stats?: Record<string, unknown>;
  equipped?: ParsedEquipped[];
  error?: boolean;
};

type ParsedEquipped = {
  slot: string;
  label?: string | null;
  container?: number | null;
  contentType?: number | null;
  itemId?: string | null;
  basis?: string | null;
  hash?: string | null;
  level?: number | null;
  quality?: number | null;
  priceGold?: number | null;
  name?: string | null;
  stats?: unknown[];
  durability?: { value: number; max: number } | null;
  conditioning?: { value: number; max: number } | null;
  soulbound?: string | null;
  empty?: boolean;
};

export function persistCharacters(chars: ParsedChar[]): void {
  const dbi = getDb();
  const now = Date.now();
  const upsertChar = dbi.prepare(upsertCharSql);
  const upsertItem = dbi.prepare(upsertItemSql);
  dbi.exec('BEGIN');
  try {
    for (const c of chars) {
      if (!c || c.error) continue;
      upsertChar.run({
        doll: c.doll,
        role: n(c.role),
        name: n(c.name),
        level: n(c.level),
        hp_value: n(c.hp?.value),
        hp_max: n(c.hp?.max),
        hp_percent: n(c.hpPercent),
        armor: n(c.armor),
        damage: n(c.damage),
        stats_json: JSON.stringify(c.stats || {}),
        updated_at: now,
      });
      for (const it of c.equipped || []) {
        upsertItem.run({
          doll: c.doll,
          slot: it.slot,
          label: n(it.label),
          container: n(it.container),
          content_type: n(it.contentType),
          item_id: n(it.itemId),
          basis: n(it.basis),
          hash: n(it.hash),
          level: n(it.level),
          quality: n(it.quality),
          price_gold: n(it.priceGold),
          name: n(it.name),
          stats_json: JSON.stringify(it.stats || []),
          durability_json: it.durability ? JSON.stringify(it.durability) : null,
          conditioning_json: it.conditioning ? JSON.stringify(it.conditioning) : null,
          soulbound: n(it.soulbound),
          empty: it.empty ? 1 : 0,
          updated_at: now,
        });
      }
    }
    dbi.exec('COMMIT');
  } catch (e) {
    dbi.exec('ROLLBACK');
    throw e;
  }
}

// Reconstrói o bloco { name, level, stats } no shape que `pairStats` espera,
// lendo do snapshot persistido em equipped_items. Slot vazio → null. Stats
// vêm já no formato { label, color } herdado do parser do paperdoll
// (parseAuctionTooltipBlock). Usado pelo recomendador de upgrade dos mercs:
// evita re-fetch HTTP do char inteiro pra fazer a comparação localmente.
export function readEquippedBlock(doll: number, slot: string): {
  name: string | null;
  level: number | null;
  quality: number | null;
  stats: unknown[];
} | null {
  const dbi = getDb();
  const row = dbi.prepare('SELECT * FROM equipped_items WHERE doll = ? AND slot = ?').get(doll, slot) as Record<string, unknown> | undefined;
  if (!row || row['empty']) return null;
  return {
    name: row['name'] as string | null,
    level: row['level'] as number | null,
    quality: row['quality'] as number | null,
    stats: JSON.parse((row['stats_json'] as string | null) || '[]') as unknown[],
  };
}

export function readAllCharacters(): CharacterRow[] {
  const dbi = getDb();
  const chars = dbi.prepare('SELECT * FROM characters ORDER BY doll').all() as Record<string, unknown>[];
  const items = dbi.prepare('SELECT * FROM equipped_items ORDER BY doll, slot').all() as Record<string, unknown>[];
  return chars.map((c): CharacterRow => ({
    doll: c['doll'] as DollId,
    role: (c['role'] as string | null) as import('@gladibot/shared').MercRole,
    name: c['name'] as string | null,
    level: c['level'] as number | null,
    hp: c['hp_value'] !== null ? { value: c['hp_value'] as number, max: c['hp_max'] as number } : null,
    hpPercent: c['hp_percent'] as number | null,
    armor: c['armor'] as number | null,
    damage: c['damage'] as string | null,
    stats: JSON.parse((c['stats_json'] as string | null) || '{}') as Record<string, unknown>,
    equipped: items
      .filter((i) => i['doll'] === c['doll'])
      .map((i): EquippedItemRow => ({
        slot: i['slot'] as string,
        label: i['label'] as string | null,
        container: i['container'] as number | null,
        contentType: i['content_type'] as number | null,
        itemId: i['item_id'] as string | null,
        basis: i['basis'] as string | null,
        hash: i['hash'] as string | null,
        level: i['level'] as number | null,
        quality: i['quality'] as number | null,
        priceGold: i['price_gold'] as number | null,
        name: i['name'] as string | null,
        stats: JSON.parse((i['stats_json'] as string | null) || '[]') as import('@gladibot/shared').AuctionStatRowLike[],
        durability: i['durability_json'] ? JSON.parse(i['durability_json'] as string) as { value: number; max: number } : null,
        conditioning: i['conditioning_json'] ? JSON.parse(i['conditioning_json'] as string) as { value: number; max: number } : null,
        soulbound: i['soulbound'] as string | null,
        empty: !!(i['empty']),
      })),
    updatedAt: c['updated_at'] as number,
  }));
}
