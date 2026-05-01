import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { fetchAuctionList, placeBid } from './auction.js';

// Parse `Usar: Cura X` do array de stats do tooltip do leilão (itemType=7).
function healNominalFromListing(listing) {
  const stats = listing?.tooltip?.item?.stats;
  if (!Array.isArray(stats)) return 0;
  for (const s of stats) {
    const m = String(s?.label || '').match(/Usar:\s*Cura\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

// Lista candidatos elegíveis: buyout em ouro definido + healNominal/preço ≥ minRatio.
// Ordenação: maior healNominal primeiro (encher inventário rápido). Ratio é só
// filtro (cumprir o "vale a pena"); entre os que passam, prioriza heal absoluto.
export function rankHealListings(listings, minRatio) {
  const out = [];
  for (const l of listings) {
    if (!l.buyoutGold || l.buyoutGold <= 0) continue;
    if (l.hasBids) continue; // outro player já lançou — ignora pra não competir
    const heal = healNominalFromListing(l);
    if (heal <= 0) continue;
    const ratio = heal / l.buyoutGold;
    if (ratio < minRatio) continue;
    out.push({ listing: l, heal, ratio });
  }
  out.sort((a, b) => b.heal - a.heal);
  return out;
}

// Auto-compra pró-ativa: enche inventário até `target` itens, respeitando
// `minRatio` (heal ≥ minRatio × preço) e `maxBudget` (gasto total no tick).
//
// `state` precisa ter `inventoryFood`, `gold`, `level`. `opts.itemLevel` é o
// filtro do leilão (default = menor opção do <select>); deixar undefined faz
// 1 fetch só pra descobrir.
export async function autoBuyHeal(client, state, opts = {}) {
  if (!isActionsEnabled()) return { bought: 0, reason: 'actions disabled' };
  const {
    target = 5,
    minRatio = 3,
    maxBudget = Infinity,
    itemLevel,           // se omitido, usa o menor option do filtro
    itemQuality = -1,
  } = opts;

  const currentCount = state?.inventoryFood?.length ?? 0;
  if (currentCount >= target) {
    return { bought: 0, reason: `already have ${currentCount} >= target ${target}` };
  }

  const startGold = state?.gold ?? 0;
  let spent = 0;
  let bought = 0;
  let count = currentCount;

  // 1ª fetch — descobre itemLevelOptions se itemLevel não veio. itemType=7 = Cura.
  const filter = { itemType: 7, itemQuality, doll: 1 };
  if (itemLevel !== undefined) filter.itemLevel = itemLevel;

  let list;
  try {
    list = await fetchAuctionList(client, { filter });
  } catch (e) {
    return { bought: 0, reason: `fetch failed: ${e.message}` };
  }
  // Se o caller não passou itemLevel e o servidor selecionou um padrão alto
  // (típico em chars de level médio-alto), refaz com o menor option pra ver
  // food de nível baixo (que costuma ter melhor ratio gold/HP).
  if (itemLevel === undefined && list.itemLevelOptions?.length > 0) {
    const minLevel = Math.min(...list.itemLevelOptions);
    if (list.filter?.itemLevel !== minLevel) {
      filter.itemLevel = minLevel;
      try { list = await fetchAuctionList(client, { filter }); } catch { /* keep prior */ }
    }
  }

  while (count < target) {
    const ranked = rankHealListings(list.listings, minRatio);
    if (ranked.length === 0) {
      return { bought, spent, reason: 'no eligible listing (ratio threshold or no buyout)' };
    }
    const { listing, heal, ratio } = ranked[0];
    if (spent + listing.buyoutGold > maxBudget) {
      return { bought, spent, reason: `budget ${maxBudget} exceeded by next buy ${listing.buyoutGold}` };
    }
    if ((startGold - spent) < listing.buyoutGold) {
      return { bought, spent, reason: `not enough gold (have ${startGold - spent}, need ${listing.buyoutGold})` };
    }
    log.info(
      `AUTOBUY heal "${listing.name ?? '?'}" auction=${listing.auctionId} heal=+${heal} price=${listing.buyoutGold}g ratio=${ratio.toFixed(2)}x`
    );
    try {
      const result = await placeBid(client, {
        auctionId: listing.auctionId,
        ttype: listing.formTtype ?? 1,
        buyout: true,
        rubyAmount: 60,
        filterEcho: { qry: '', itemType: 7, itemLevel: filter.itemLevel ?? -1, itemQuality: -1 },
      });
      if (!result?.ok) {
        return { bought, spent, reason: `placeBid failed: ${result?.reason || 'unknown'}` };
      }
      spent += listing.buyoutGold;
      bought++;
      count++;
      // O response do POST já vem parseado em result.list — usa pro próximo loop.
      list = result.list ?? list;
    } catch (e) {
      log.warn(`autobuy heal failed: ${e.message}`);
      return { bought, spent, reason: `placeBid threw: ${e.message}` };
    }
  }
  return { bought, spent, reason: `target ${target} reached` };
}
