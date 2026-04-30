import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../log.js';
import {
  getStateView,
  getLogs,
  pause,
  resume,
  requestTickNow,
  getClient,
  setActionsEnabled,
  isActionsEnabled,
} from '../botState.js';
import { fetchTrainingStatus, trainSkill } from '../actions/training.js';
import { fetchAuctionList, placeBid } from '../actions/auction.js';
import { fetchAllCharacters } from '../actions/characters.js';
import { persistCharacters, readAllCharacters } from '../db.js';
import { buildSuggestions } from '../mercSuggestions.js';
import { auctionLevelRange } from '../formulas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function safeConfig() {
  return {
    baseUrl: config.baseUrl,
    expedition: config.expedition,
    heal: config.heal,
    work: config.work,
    loop: config.loop,
    logLevel: config.logLevel,
    browser: { headless: config.browser.headless, channel: config.browser.channel },
    ui: { port: config.ui.port, enabled: config.ui.enabled },
  };
}

export function startUiServer() {
  if (!config.ui.enabled) {
    log.info('UI disabled (UI_ENABLED=false)');
    return null;
  }

  const app = express();
  app.use(express.json());

  app.get('/api/state', (_req, res) => {
    res.json(getStateView());
  });

  app.get('/api/logs', (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    res.json({ logs: getLogs({ since, level }), nowMs: Date.now() });
  });

  app.get('/api/config', (_req, res) => {
    res.json(safeConfig());
  });

  app.post('/api/pause', (_req, res) => {
    pause();
    log.info('UI: loop paused');
    res.json({ ok: true });
  });

  app.post('/api/resume', (_req, res) => {
    resume();
    log.info('UI: loop resumed');
    res.json({ ok: true });
  });

  app.post('/api/tick', (_req, res) => {
    requestTickNow();
    log.info('UI: tick requested');
    res.json({ ok: true });
  });

  app.post('/api/actions/enable', (_req, res) => {
    setActionsEnabled(true);
    log.warn('UI: ACTIONS ENABLED');
    res.json({ ok: true, actionsEnabled: true });
  });

  app.post('/api/actions/disable', (_req, res) => {
    setActionsEnabled(false);
    log.warn('UI: ACTIONS DISABLED');
    res.json({ ok: true, actionsEnabled: false });
  });

  // Lazy fetch — costs only change when user trains or levels up.
  app.get('/api/training', async (_req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    try {
      const t = await fetchTrainingStatus(client);
      res.json(t);
    } catch (e) {
      log.warn(`UI /api/training failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/train', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    if (!isActionsEnabled()) {
      return res.status(409).json({ ok: false, error: 'actions disabled' });
    }
    const { skillId } = req.body || {};
    if (!skillId) return res.status(400).json({ error: 'skillId required' });
    try {
      const result = await trainSkill(client, skillId);
      res.json(result);
    } catch (e) {
      log.warn(`UI /api/train failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Leilão (read-only). Aceita ttype + filtros via query string.
  // ttype: 1|2|3 (gladiador / item de mercenário / mercenário inteiro — semântica a confirmar)
  // doll, qry, itemLevel, itemType, itemQuality: passados como filter no POST quando presentes.
  app.get('/api/auction', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    const opts = {};
    if (req.query.ttype !== undefined) opts.ttype = parseInt(req.query.ttype, 10);
    const filter = {};
    for (const k of ['doll', 'itemLevel', 'itemType', 'itemQuality']) {
      if (req.query[k] !== undefined) filter[k] = parseInt(req.query[k], 10);
    }
    if (typeof req.query.qry === 'string') filter.qry = req.query.qry;
    if (Object.keys(filter).length > 0) opts.filter = filter;
    if (req.query.onlyTop === '1' || req.query.onlyTop === 'true') opts.onlyTop = true;
    try {
      const list = await fetchAuctionList(client, opts);
      res.json(list);
    } catch (e) {
      log.warn(`UI /api/auction failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Lance / compra imediata no leilão. Body JSON:
  //   { auctionId, ttype?, buyout?, bidAmount?, rubyAmount?, filterEcho? }
  // Gated por isActionsEnabled() (mesmo kill switch do training). Reusa
  // actions/auction.placeBid, que já loga + marca o ID em botState.myBidAuctionIds.
  app.post('/api/auction/bid', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    if (!isActionsEnabled()) {
      return res.status(409).json({ ok: false, error: 'actions disabled' });
    }
    const { auctionId, ttype, buyout = false, bidAmount, rubyAmount = 60, filterEcho = {} } = req.body || {};
    if (!auctionId) return res.status(400).json({ ok: false, error: 'auctionId required' });
    if (!buyout && (bidAmount === undefined || bidAmount === null)) {
      return res.status(400).json({ ok: false, error: 'bidAmount required when buyout=false' });
    }
    try {
      const result = await placeBid(client, {
        auctionId: parseInt(auctionId, 10),
        ttype: ttype !== undefined ? parseInt(ttype, 10) : 1,
        buyout: !!buyout,
        bidAmount: bidAmount !== undefined ? parseInt(bidAmount, 10) : undefined,
        rubyAmount,
        filterEcho,
      });
      res.json(result);
    } catch (e) {
      log.warn(`UI /api/auction/bid failed: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Characters (principal + espelho + 4 mercs). Lazy fetch — varre doll=1..6
  // em paralelo, persiste no SQLite, retorna JSON. ?from=db lê estado salvo
  // sem re-fetch (pra Claude consumir via curl sem onerar o servidor do jogo).
  async function loadCharacters(req) {
    if (req.query.from === 'db') return readAllCharacters();
    const client = getClient();
    if (!client) throw new Error('client not ready');
    const all = await fetchAllCharacters(client);
    persistCharacters(all);
    return all;
  }

  app.get('/api/characters', async (req, res) => {
    try {
      res.json({ characters: await loadCharacters(req) });
    } catch (e) {
      log.warn(`UI /api/characters failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/characters/attributes', async (req, res) => {
    try {
      const all = await loadCharacters(req);
      res.json({
        characters: all.map((c) => ({
          doll: c.doll, role: c.role, name: c.name, level: c.level,
          hp: c.hp, hpPercent: c.hpPercent, armor: c.armor, damage: c.damage,
          stats: c.stats,
        })),
      });
    } catch (e) {
      log.warn(`UI /api/characters/attributes failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/characters/items', async (req, res) => {
    try {
      const all = await loadCharacters(req);
      res.json({
        characters: all.map((c) => ({
          doll: c.doll, role: c.role, name: c.name, level: c.level,
          equipped: c.equipped,
        })),
      });
    } catch (e) {
      log.warn(`UI /api/characters/items failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Faixa de level visível no leilão pelo jogo, derivada das fórmulas
  // `auction-min-level` / `auction-max-level` em data/formulas.json. Aceita
  // `?level=N` ou usa o level do snapshot do char ativo se omitido.
  app.get('/api/formulas/auction-level-range', (req, res) => {
    let level = parseInt(req.query.level, 10);
    if (!Number.isFinite(level)) {
      const view = getStateView();
      level = view?.snapshot?.level ?? null;
    }
    if (!Number.isFinite(level)) return res.status(400).json({ error: 'level missing' });
    res.json(auctionLevelRange(level));
  });

  // Sugestões de upgrade pros mercs (Painel 3). 1 fetch único do leilão +
  // comparação local com o gear salvo no SQLite.
  // Query params:
  //   ttype       — '' (gladiador, default) ou '3' (mercenário)
  //   itemLevel   — default = auction-min-level pelo char level
  //   itemQuality — default = -1 (Padrão+)
  //   slots       — quantos slots prioritários considerar por merc (1..9, default 4)
  //   refresh     — '1' força fetchAllCharacters antes (gear/stats fresh)
  // Dedup: candidato que aparece em ring1 E ring2 do mesmo merc é marcado
  // com `dupOf: 'ring2'` no segundo slot pra UI esconder/agrupar.
  app.get('/api/mercs/suggestions', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    try {
      const ttype = req.query.ttype !== undefined && req.query.ttype !== ''
        ? parseInt(req.query.ttype, 10)
        : undefined;
      const itemQuality = req.query.itemQuality !== undefined ? parseInt(req.query.itemQuality, 10) : -1;
      const slotsToConsider = (() => {
        const n = parseInt(req.query.slots, 10);
        if (!Number.isFinite(n)) return 4;
        return Math.max(1, Math.min(9, n));
      })();
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const view = getStateView();
      const charLevel = view?.snapshot?.level ?? null;
      const range = charLevel ? auctionLevelRange(charLevel) : null;
      const itemLevel = req.query.itemLevel !== undefined
        ? parseInt(req.query.itemLevel, 10)
        : (range?.min ?? 36);

      // Refresh ou DB vazio → fetchAll antes de gerar sugestões.
      if (refresh || readAllCharacters().length === 0) {
        const all = await fetchAllCharacters(client);
        persistCharacters(all);
      }
      const fetchOpts = { filter: { itemType: 0, itemLevel, itemQuality, doll: 1 } };
      if (ttype !== undefined) fetchOpts.ttype = ttype;
      const list = await fetchAuctionList(client, fetchOpts);
      const chars = readAllCharacters();
      const mercs = chars.filter((c) => c.doll !== 1);
      const suggestions = buildSuggestions(list.listings, mercs, { slotsToConsider });

      // Dedup entre slots (ring1/ring2 principalmente): se um mesmo
      // auctionId aparece em mais de um slot do mesmo merc, mantemos apenas
      // no primeiro (com priority maior) e anotamos `dupOf` no resto.
      for (const m of suggestions) {
        const seen = new Map();   // auctionId -> primeiro slot que listou
        for (const s of m.suggestions) {
          for (const c of s.candidates) {
            const prev = seen.get(c.auctionId);
            if (prev) {
              c.dupOf = prev;
            } else {
              seen.set(c.auctionId, s.slot);
            }
          }
        }
      }

      res.json({
        ttype: ttype ?? null, itemLevel, itemQuality, slotsToConsider, refreshed: refresh,
        charLevel, range,
        listingsCount: list.listings.length,
        mercs: suggestions,
      });
    } catch (e) {
      log.warn(`UI /api/mercs/suggestions failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Debug: capturar HTML cru do leilão com filtros aplicados (POST). Útil pra
  // refinar parser de "meu lance"/currentBid sem ter que decifrar o JSON parseado.
  app.get('/api/debug/auction-html', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).type('text').send('client not ready');
    const params = { mod: 'auction' };
    if (typeof req.query.ttype === 'string') params.ttype = req.query.ttype;
    const body = {
      doll: parseInt(req.query.doll, 10) || 1,
      qry: typeof req.query.qry === 'string' ? req.query.qry : '',
      itemLevel: parseInt(req.query.itemLevel, 10) || 43,
      itemType: parseInt(req.query.itemType, 10) || 0,
      itemQuality: parseInt(req.query.itemQuality, 10) || -1,
    };
    try {
      const html = await client.postForm('/game/index.php', params, body);
      res.type('text/plain; charset=utf-8').send(typeof html === 'string' ? html : JSON.stringify(html));
    } catch (e) {
      res.status(500).type('text').send(`fetch failed: ${e.message}`);
    }
  });

  // Debug: GET arbitrary game route via the active client. Only listens on
  // 127.0.0.1, but still gated to common safe params. Returns text/html so it
  // renders raw in the browser (View Source). Useful to capture HTML when the
  // parser is missing some state (e.g., "working" indicator).
  app.get('/api/debug/html', async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).type('text').send('client not ready (login still in progress?)');
    const params = {};
    for (const k of ['mod', 'submod', 'loc', 'sub']) {
      if (typeof req.query[k] === 'string') params[k] = req.query[k];
    }
    if (!params.mod) return res.status(400).type('text').send('usage: /api/debug/html?mod=overview[&submod=][&loc=][&doll=N][&raw=1]');
    if (typeof req.query.doll === 'string') params.doll = req.query.doll;
    const noXhr = req.query.raw === '1' || req.query.raw === 'true';
    try {
      log.debug(`UI debug GET ${JSON.stringify(params)} noXhr=${noXhr}`);
      const html = await client.fetchRawHtml('/game/index.php', params, { noXhr });
      res.type('text/plain; charset=utf-8').send(html);
    } catch (e) {
      res.status(500).type('text').send(`fetch failed: ${e.message}`);
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  return new Promise((resolve, reject) => {
    const server = app.listen(config.ui.port, '127.0.0.1', () => {
      log.info(`UI running at http://localhost:${config.ui.port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
