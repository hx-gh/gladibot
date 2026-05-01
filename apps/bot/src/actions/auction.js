import { log } from '../log.js';
import {
  isActionsEnabled,
  getStateView,
  markMyBid,
  getMyBidIds,
  setLastAuctionBucket,
  getLastAuctionBucket,
} from '../botState.js';
import { parseAuctionList } from '../state.js';
import { enrichListingWithAffixes } from '../affixCatalog.js';
import { buildComparison } from '../itemCompare.js';
import { enrichListingWithWaste } from '../mercSuggestions.js';

// Time bucket exigido pra dar LANCE (não-buyout). Regra do usuário:
// só lança quando o leilão está perto de fechar — minimiza chance de outbid.
const BID_REQUIRED_BUCKET = 'Curto';

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
  itemLevel: 43,
  itemType: 0,
  itemQuality: -1,
};

// Enriquece um result de parseAuctionList in-place: affixes, comparison, waste
// check, reforço de myBid via tracking local, totals. Compartilhado entre
// fetchAuctionList e placeBid (a resposta do POST de bid também é uma listing).
function enrichResult(result, { onlyTop = false } = {}) {
  const snap = getStateView()?.snapshot ?? null;
  const charStats = snap?.stats ?? null;
  const charName = snap?.charName ?? null;
  const myIds = getMyBidIds();

  for (const l of result.listings) {
    enrichListingWithAffixes(l);
    const cmp = buildComparison(l);
    l.category = cmp.category;
    l.comparison = cmp.comparison;
    if (l.comparison?.hasComparison && charStats) {
      enrichListingWithWaste(l, charStats);
    }
    // Resolve `myBid`: parser expõe o `bidderName` cru (link `<a mod=player>`);
    // comparamos com o nome do char ativo. Tracking local em `myIds` cobre
    // edge case (parser falhou em capturar bidderName, ou caracteres especiais
    // no nome diferem entre overview e leilão).
    if (l.bidderName && charName && l.bidderName.toLowerCase() === charName.toLowerCase()) {
      l.myBid = true;
    } else if (myIds.has(l.auctionId)) {
      l.myBid = true;
    }
  }
  if (onlyTop) {
    result.listings = result.listings.filter((l) => l.topAny);
  }
  result.totals = {
    visible: result.listings.length,
    topAny: result.listings.filter((l) => l.topAny).length,
    fullyClassified: result.listings.filter((l) => l.affixCoverage === 2).length,
    upgrades: result.listings.filter((l) => l.comparison?.summary?.isUpgrade).length,
    withBids: result.listings.filter((l) => l.hasBids).length,
    myBids: result.listings.filter((l) => l.myBid).length,
  };
  // Cache do bucket pro gate de lance (placeBid). Vale 60s por padrão (TTL em
  // botState.getLastAuctionBucket); a UI poll mantém o valor sempre fresco.
  setLastAuctionBucket(result.globalTimeBucket);
  return result;
}

// Faz só o GET cru e parseia o <select name="itemLevel"> + selected. Sem
// enrichment de listing — pra popular o dropdown da UI sem rodar comparações
// caras. Retorna `{ options: number[], selected: number|null }`.
export async function fetchAuctionLevelOptions(client, opts = {}) {
  const { ttype } = opts;
  const params = { mod: 'auction' };
  if (ttype !== undefined) params.ttype = ttype;
  const html = await client.fetchRawHtml('/game/index.php', params);
  const result = parseAuctionList(typeof html === 'string' ? html : '');
  return {
    options: result.itemLevelOptions || [],
    selected: result.filter?.itemLevel ?? null,
  };
}

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
  return enrichResult(result, { onlyTop });
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

  // Gate de bucket: só LANCE (buyout=false) é restrito. Buyout não tem risco
  // de outbid, então roda em qualquer bucket. `getLastAuctionBucket` retorna
  // null se o cache é mais velho que 60s — nesse caso refusamos por segurança
  // (UI sempre poll fresca).
  if (!buyout) {
    const bucket = getLastAuctionBucket();
    if (bucket !== BID_REQUIRED_BUCKET) {
      const reason = bucket === null
        ? `auction bucket unknown/stale — fetch leilão antes de dar lance`
        : `auction bucket=${bucket}, lances só permitidos em ${BID_REQUIRED_BUCKET}`;
      log.warn(`AUCTION lance rejeitado: ${reason}`);
      return { ok: false, reason };
    }
  }

  const body = {
    auctionid: auctionId,
    qry: filterEcho.qry ?? '',
    itemType: filterEcho.itemType ?? 0,
    itemLevel: filterEcho.itemLevel ?? 43,
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
  // Marca o ID localmente: o parser ainda não detecta confiavelmente "meu lance"
  // pelo HTML (sem sample pós-bid em produção). Para buyout o item some da
  // listagem, então marcar é inofensivo (o ID simplesmente não vai existir mais).
  markMyBid(auctionId);
  const parsed = parseAuctionList(typeof result === 'string' ? result : '');
  const list = enrichResult(parsed);
  return { ok: true, list };
}
