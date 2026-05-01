import { config } from '../config.js';
import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import type { GladiatusClient } from '../client.js';
import type { BotSnapshot, InventoryFoodItem } from '@gladibot/shared';

// Greedy "no overflow": pick the largest food item where heal_nominal <= missing.
// Fallback: smallest item if everything overflows.
export function pickHealItem(state: BotSnapshot): InventoryFoodItem | null {
  if (!state.hp) return null;
  const missing = state.hp.max - state.hp.value;
  if (missing <= 0) return null;

  const food = [...state.inventoryFood].sort((a, b) => a.healNominal - b.healNominal);
  if (food.length === 0) return null;

  let chosen: InventoryFoodItem | null = null;
  for (const item of food) {
    if (item.healNominal <= missing) chosen = item;
    else break; // sorted asc — once it exceeds, all the next ones also do
  }
  return chosen ?? food[0]!; // fallback: smallest, accept the overflow
}

export async function healIfNeeded(client: GladiatusClient, state: BotSnapshot): Promise<{ acted: boolean; reason?: string; json?: unknown; item?: InventoryFoodItem }> {
  if (!isActionsEnabled()) {
    return { acted: false, reason: 'actions disabled' };
  }
  const pct = state.hpPercent ?? 100;
  if (pct >= config.heal.thresholdPct) {
    return { acted: false, reason: `HP ${pct}% >= threshold ${config.heal.thresholdPct}%` };
  }
  const item = pickHealItem(state);
  if (!item) return { acted: false, reason: 'no food in inventory' };

  log.info(`HEAL using ${item.name} (nominal +${item.healNominal})`);
  const json = await client.postForm('/game/ajax.php', {
    mod: 'inventory',
    submod: 'move',
    from: item.from,
    fromX: item.fromX,
    fromY: item.fromY,
    to: 8,
    toX: 1,
    toY: 1,
    amount: 1,
    doll: 1,
  });
  return { acted: true, json, item };
}
