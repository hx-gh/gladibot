// Types for the characters / mercenaries module (Painel 4 + DB schema).

export type DollId = 1 | 2 | 3 | 4 | 5 | 6;

export type MercRole = 'medico' | 'killer' | 'tanque' | null;

export interface EquippedItemRow {
  slot: string;
  label: string | null;
  container: number | null;
  contentType: number | null;
  itemId: string | null;
  basis: string | null;
  hash: string | null;
  level: number | null;
  quality: number | null;
  priceGold: number | null;
  name: string | null;
  stats: AuctionStatRowLike[];
  durability: { value: number; max: number } | null;
  conditioning: { value: number; max: number } | null;
  soulbound: string | null;
  empty: boolean;
}

// Minimal stat-row shape reused by equipped items (mirrors AuctionStatRow
// but without a required `delta`).
export interface AuctionStatRowLike {
  label: string;
  color: string | null;
  delta?: string | null;
}

export interface CharacterRow {
  doll: DollId;
  role: MercRole;
  name: string | null;
  level: number | null;
  hp: { value: number; max: number } | null;
  hpPercent: number | null;
  armor: number | null;
  damage: string | null;
  stats: Record<string, unknown>;
  equipped: EquippedItemRow[];
  updatedAt: number;
}
