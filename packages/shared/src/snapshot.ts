// Canonical shape of the game state snapshot produced by parseOverview
// and merged with AJAX responses. Consumed by botState, the UI server,
// and (future) apps/web.

import type { WorkStatus } from './work.js';

export interface HpInfo {
  value: number;
  max: number;
}

export interface PoolInfo {
  points: number | null;
  max: number | null;
  cooldownSec: number | null;
}

export interface InventoryFoodItem {
  itemId: string | null;
  from: number;
  fromX: number;
  fromY: number;
  name: string;
  healNominal: number;
}

export interface StatDetail {
  total: number | null;
  base: number | null;
  max: number | null;
  items: number | null;
  itemsMax: number | null;
  label?: string;
  trainId?: number;
  bonus?: number;
}

export interface StatBlock {
  strength: StatDetail | null;
  dexterity: StatDetail | null;
  agility: StatDetail | null;
  constitution: StatDetail | null;
  charisma: StatDetail | null;
  intelligence: StatDetail | null;
}

export interface BuffEntry {
  title?: string;
  name?: string;
  effect?: string | null;
  endsAtMs: number;
}

export interface BuffsBlock {
  global: BuffEntry[];
  personal: BuffEntry[];
}

export interface InventoryCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type InventoryGrid = Record<number, InventoryCell[]>;

export interface BotSnapshot {
  charName: string | null;
  gold: number | null;
  rubies: number | null;
  level: number | null;
  expPercent: number | null;
  hpPercent: number | null;
  hp: HpInfo | null;
  expedition: PoolInfo;
  dungeon: PoolInfo;
  arena: { cooldownSec: number | null };
  grouparena: { cooldownSec: number | null };
  inventoryFood: InventoryFoodItem[];
  stats: StatBlock;
  buffs: BuffsBlock;
  working: WorkStatus;
  inventoryGrid: InventoryGrid;
}
