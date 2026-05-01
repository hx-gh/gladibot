import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import {
  parsePackages,
  parseInventoryGrid,
  findFreeBagSlot,
  BAG_COLS,
  BAG_ROWS,
} from '../state.js';
import type { GladiatusClient } from '../client.js';
import type { InventoryGrid } from '@gladibot/shared';

// Bags I..IV ativos por padrão (BR62 free). Move em ordem do I pro IV — quando
// I lota, tenta II, etc. Se TODOS lotaram, retorna sem fazer nada (o package
// fica esperando o próximo tick — espaço pode liberar quando a comida for
// usada ou um item for vendido).
const ACTIVE_BAGS = [512, 513, 514, 515];

interface PackageItem {
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

export async function fetchPackages(client: GladiatusClient): Promise<{ html: unknown; packages: PackageItem[] }> {
  const html = await client.fetchRawHtml('/game/index.php', { mod: 'packages' });
  return { html, packages: parsePackages(typeof html === 'string' ? html : '') as PackageItem[] };
}

// Move 1 pacote pra um slot livre no inventário. Retorna `{ ok, json?, reason? }`.
// `gridSnapshot` é mutado: o slot escolhido é marcado como ocupado pra próxima
// chamada do mesmo tick (sem precisar re-fetchar o inventário).
export async function movePackageToInventory(client: GladiatusClient, pkg: PackageItem, gridSnapshot: InventoryGrid): Promise<{ ok: boolean; reason?: string; json?: unknown; bag?: number; slot?: { x: number; y: number } }> {
  if (!isActionsEnabled()) return { ok: false, reason: 'actions disabled' };
  const { w, h } = pkg.measurement;
  if (w > BAG_COLS || h > BAG_ROWS) return { ok: false, reason: `item ${w}x${h} > bag ${BAG_COLS}x${BAG_ROWS}` };

  let chosenBag: number | null = null;
  let chosenSlot: { x: number; y: number } | null = null;
  for (const bag of ACTIVE_BAGS) {
    const occupied = gridSnapshot[bag] ?? [];
    const slot = findFreeBagSlot(occupied, w, h);
    if (slot) { chosenBag = bag; chosenSlot = slot; break; }
  }
  if (!chosenBag || !chosenSlot) return { ok: false, reason: 'no free slot in any bag' };

  log.info(
    `PACKAGE move "${pkg.name ?? '?'}" pkg=${pkg.packageId} (${w}x${h}) → bag=${chosenBag} slot=${chosenSlot.x},${chosenSlot.y}`
  );
  const json = await client.postForm('/game/ajax.php', {
    mod: 'inventory',
    submod: 'move',
    from: pkg.from,
    fromX: pkg.fromX,
    fromY: pkg.fromY,
    to: chosenBag,
    toX: chosenSlot.x,
    toY: chosenSlot.y,
    amount: 1,
  });

  // Mutate gridSnapshot pra o próximo move do mesmo tick não escolher o mesmo slot.
  gridSnapshot[chosenBag] = [
    ...(gridSnapshot[chosenBag] ?? []),
    { x: chosenSlot.x, y: chosenSlot.y, w, h },
  ];
  return { ok: true, json, bag: chosenBag, slot: chosenSlot };
}

interface OpenPackagesOpts {
  maxToOpen?: number;
  onlyHeal?: boolean;
}

// Drena packages até `maxToOpen` ou até falhar (sem espaço). Filtros opcionais
// — se `onlyHeal` for true, só pega items com `healNominal > 0`.
export async function openPackages(client: GladiatusClient, currentGrid: InventoryGrid | null | undefined, opts: OpenPackagesOpts = {}): Promise<{ opened: number; skipped: number; total?: number; reason?: string }> {
  if (!isActionsEnabled()) return { opened: 0, skipped: 0, reason: 'actions disabled' };
  const { maxToOpen = Infinity, onlyHeal = false } = opts;

  const { packages } = await fetchPackages(client);
  if (packages.length === 0) return { opened: 0, skipped: 0, reason: 'no packages' };

  // Snapshot do grid: preferimos receber `currentGrid` do parseOverview do tick
  // (já fresco). Fallback: se não veio, parsea o próprio HTML do mod=packages
  // (BagLoader script tem os items mas em form escapada — ignoramos por
  // simplicidade e assumimos bags vazios). Pior caso colide e o servidor
  // devolve erro, que cai no catch abaixo.
  const grid: InventoryGrid = currentGrid
    ? Object.fromEntries(Object.entries(currentGrid).map(([k, v]) => [k, [...v]]))
    : { 512: [], 513: [], 514: [], 515: [] };

  let opened = 0;
  let skipped = 0;
  for (const pkg of packages) {
    if (opened >= maxToOpen) break;
    if (onlyHeal && pkg.healNominal <= 0) { skipped++; continue; }
    try {
      const r = await movePackageToInventory(client, pkg, grid);
      if (r.ok) opened++;
      else { skipped++; log.debug(`  package skip: ${r.reason}`); if (r.reason === 'no free slot in any bag') break; }
    } catch (e) {
      log.warn(`package ${pkg.packageId} move failed: ${(e as Error).message}`);
      skipped++;
    }
  }
  log.info(`PACKAGES opened=${opened} skipped=${skipped} total=${packages.length}`);
  return { opened, skipped, total: packages.length };
}

// Convenience: filtra só `healNominal > 0`. Usado pelo orchestrator antes de
// recorrer ao auto-buy do leilão.
export function openHealPackages(client: GladiatusClient, currentGrid: InventoryGrid | null | undefined, maxToOpen = Infinity): Promise<{ opened: number; skipped: number; total?: number; reason?: string }> {
  return openPackages(client, currentGrid, { maxToOpen, onlyHeal: true });
}

// Re-export pro UI/server poder chamar sem importar do state.
export { parsePackages };
