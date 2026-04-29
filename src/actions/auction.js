import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { parseAuctionList } from '../state.js';
import { enrichListingWithAffixes } from '../affixCatalog.js';
import { buildComparison } from '../itemCompare.js';

// Fase 1 do Painel 2: read-only.
//
// `fetchAuctionList` faz GET na página do leilão (HTTP raw, sem navegar a aba
// principal). Quando filtros são passados, vai por POST (mesma URL) — comportamento
// observado no `<form name="filterForm">`.
//
// `placeBid` é gated por kill switch e fica documentado mas DESATIVADO até a
// fase de autobuy. Não é chamado pelo orchestrator nem pela UI ainda.

const DEFAULT_FILTER = {
  doll: 1,
  qry: '',
  itemLevel: 36,
  itemType: 0,
  itemQuality: -1,
};

export async function fetchAuctionList(client, opts = {}) {
  const { ttype, filter, onlyTop = false } = opts;
  const params = { mod: 'auction' };
  if (ttype !== undefined) params.ttype = ttype;

  let result;
  if (filter && Object.keys(filter).length > 0) {
    const body = { ...DEFAULT_FILTER, ...filter };
    const html = await client.postForm('/game/index.php', params, body);
    result = parseAuctionList(typeof html === 'string' ? html : '');
  } else {
    const html = await client.fetchRawHtml('/game/index.php', params);
    result = parseAuctionList(html);
  }

  for (const l of result.listings) {
    enrichListingWithAffixes(l);
    const cmp = buildComparison(l);
    l.category = cmp.category;
    l.comparison = cmp.comparison;
  }
  if (onlyTop) {
    result.listings = result.listings.filter((l) => l.topAny);
  }
  result.totals = {
    visible: result.listings.length,
    topAny: result.listings.filter((l) => l.topAny).length,
    fullyClassified: result.listings.filter((l) => l.affixCoverage === 2).length,
    upgrades: result.listings.filter((l) => l.comparison?.summary?.isUpgrade).length,
  };
  return result;
}

export async function placeBid(client, params = {}) {
  if (!isActionsEnabled()) return { ok: false, reason: 'actions disabled' };

  const {
    auctionId,
    ttype = 1,
    buyout = false,
    bidAmount,
    rubyAmount = 60,
    filterEcho = {},
  } = params;
  if (!auctionId) return { ok: false, reason: 'missing auctionId' };
  if (!buyout && !bidAmount) return { ok: false, reason: 'bidAmount required when buyout=false' };

  const body = {
    auctionid: auctionId,
    qry: filterEcho.qry ?? '',
    itemType: filterEcho.itemType ?? 0,
    itemLevel: filterEcho.itemLevel ?? 36,
    itemQuality: filterEcho.itemQuality ?? -1,
    buyouthd: buyout ? '1' : '0',
  };
  if (buyout) {
    body.buyout = 'Comprar';
  } else {
    body.bid = 'Proposta';
    body.bid_amount = String(bidAmount);
  }

  log.info(`AUCTION ${buyout ? 'BUYOUT' : 'BID'} auction=${auctionId} amount=${bidAmount ?? 'n/a'}`);
  const result = await client.postForm(
    '/game/index.php',
    { mod: 'auction', submod: 'placeBid', ttype, rubyAmount },
    body
  );
  const list = parseAuctionList(typeof result === 'string' ? result : '');
  return { ok: true, list };
}
