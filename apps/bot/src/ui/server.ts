import express, { type Request, type Response } from 'express';
import type { Server } from 'node:http';
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
import { fetchAuctionList, fetchAuctionLevelOptions, placeBid } from '../actions/auction.js';
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

// Helper: safely extract a query param string (undefined → null)
function qs(val: string | string[] | undefined): string | null {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0] ?? null;
  return null;
}

function qsInt(val: string | string[] | undefined, fallback: number): number {
  const s = qs(val);
  if (s === null) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function startUiServer(): Promise<Server | null> {
  if (!config.ui.enabled) {
    log.info('UI disabled (UI_ENABLED=false)');
    return null;
  }

  const app = express();
  app.use(express.json());

  app.get('/api/state', (_req: Request, res: Response) => {
    res.json(getStateView());
  });

  app.get('/api/logs', (req: Request, res: Response) => {
    const since = qsInt(req.query.since as string | undefined, 0);
    const level = qs(req.query.level as string | undefined) ?? undefined;
    res.json({ logs: getLogs({ since, level }), nowMs: Date.now() });
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(safeConfig());
  });

  app.post('/api/pause', (_req: Request, res: Response) => {
    pause();
    log.info('UI: loop paused');
    res.json({ ok: true });
  });

  app.post('/api/resume', (_req: Request, res: Response) => {
    resume();
    log.info('UI: loop resumed');
    res.json({ ok: true });
  });

  app.post('/api/tick', (_req: Request, res: Response) => {
    requestTickNow();
    log.info('UI: tick requested');
    res.json({ ok: true });
  });

  app.post('/api/actions/enable', (_req: Request, res: Response) => {
    setActionsEnabled(true);
    log.warn('UI: ACTIONS ENABLED');
    res.json({ ok: true, actionsEnabled: true });
  });

  app.post('/api/actions/disable', (_req: Request, res: Response) => {
    setActionsEnabled(false);
    log.warn('UI: ACTIONS DISABLED');
    res.json({ ok: true, actionsEnabled: false });
  });

  // Lazy fetch — costs only change when user trains or levels up.
  app.get('/api/training', async (_req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    try {
      const t = await fetchTrainingStatus(client);
      res.json(t);
    } catch (e) {
      log.warn(`UI /api/training failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/train', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    if (!isActionsEnabled()) {
      return res.status(409).json({ ok: false, error: 'actions disabled' });
    }
    const { skillId } = (req.body as { skillId?: unknown }) || {};
    if (!skillId) return res.status(400).json({ error: 'skillId required' });
    try {
      const result = await trainSkill(client, skillId as number);
      res.json(result);
    } catch (e) {
      log.warn(`UI /api/train failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Leilão (read-only). Aceita ttype + filtros via query string.
  // ttype: 1|2|3 (gladiador / item de mercenário / mercenário inteiro — semântica a confirmar)
  // doll, qry, itemLevel, itemType, itemQuality: passados como filter no POST quando presentes.
  app.get('/api/auction', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    const opts: Record<string, unknown> = {};
    const ttypeStr = qs(req.query.ttype as string | undefined);
    if (ttypeStr !== null) opts['ttype'] = parseInt(ttypeStr, 10);
    const filter: Record<string, unknown> = {};
    for (const k of ['doll', 'itemLevel', 'itemType', 'itemQuality']) {
      const v = qs(req.query[k] as string | undefined);
      if (v !== null) filter[k] = parseInt(v, 10);
    }
    const qryVal = qs(req.query.qry as string | undefined);
    if (qryVal !== null) filter['qry'] = qryVal;
    if (Object.keys(filter).length > 0) opts['filter'] = filter;
    const onlyTopStr = qs(req.query.onlyTop as string | undefined);
    if (onlyTopStr === '1' || onlyTopStr === 'true') opts['onlyTop'] = true;
    try {
      const list = await fetchAuctionList(client, opts as Parameters<typeof fetchAuctionList>[1]);
      res.json(list);
    } catch (e) {
      log.warn(`UI /api/auction failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Lance / compra imediata no leilão. Body JSON:
  //   { auctionId, ttype?, buyout?, bidAmount?, rubyAmount?, filterEcho? }
  // Gated por isActionsEnabled() (mesmo kill switch do training). Reusa
  // actions/auction.placeBid, que já loga + marca o ID em botState.myBidAuctionIds.
  app.post('/api/auction/bid', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    if (!isActionsEnabled()) {
      return res.status(409).json({ ok: false, error: 'actions disabled' });
    }
    const body = (req.body as Record<string, unknown>) || {};
    const { auctionId, ttype, buyout = false, bidAmount, rubyAmount = 60, filterEcho = {} } = body;
    if (!auctionId) return res.status(400).json({ ok: false, error: 'auctionId required' });
    if (!buyout && (bidAmount === undefined || bidAmount === null)) {
      return res.status(400).json({ ok: false, error: 'bidAmount required when buyout=false' });
    }
    try {
      const result = await placeBid(client, {
        auctionId: parseInt(String(auctionId), 10),
        ttype: ttype !== undefined ? parseInt(String(ttype), 10) : 1,
        buyout: !!buyout,
        bidAmount: bidAmount !== undefined ? parseInt(String(bidAmount), 10) : undefined,
        rubyAmount: Number(rubyAmount),
        filterEcho: filterEcho as Record<string, unknown>,
      });
      res.json(result);
    } catch (e) {
      log.warn(`UI /api/auction/bid failed: ${(e as Error).message}`);
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Characters (principal + espelho + 4 mercs). Lazy fetch — varre doll=1..6
  // em paralelo, persiste no SQLite, retorna JSON. ?from=db lê estado salvo
  // sem re-fetch (pra Claude consumir via curl sem onerar o servidor do jogo).
  async function loadCharacters(req: Request) {
    if (req.query['from'] === 'db') return readAllCharacters();
    const client = getClient();
    if (!client) throw new Error('client not ready');
    const all = await fetchAllCharacters(client);
    // fetchAllCharacters returns Record<string,unknown>[] — loosely typed since
    // the characters action predates the shared types. Cast is safe: the shape
    // matches ParsedChar structurally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persistCharacters(all as any);
    return all;
  }

  app.get('/api/characters', async (req: Request, res: Response) => {
    try {
      res.json({ characters: await loadCharacters(req) });
    } catch (e) {
      log.warn(`UI /api/characters failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/characters/attributes', async (req: Request, res: Response) => {
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
      log.warn(`UI /api/characters/attributes failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/characters/items', async (req: Request, res: Response) => {
    try {
      const all = await loadCharacters(req);
      res.json({
        characters: all.map((c) => ({
          doll: c.doll, role: c.role, name: c.name, level: c.level,
          equipped: c.equipped,
        })),
      });
    } catch (e) {
      log.warn(`UI /api/characters/items failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Faixa de level visível no leilão pelo jogo, derivada das fórmulas
  // `auction-min-level` / `auction-max-level` em data/formulas.json. Aceita
  // `?level=N` ou usa o level do snapshot do char ativo se omitido.
  // NOTA: pra popular o <select> da UI, use `/api/auction/level-options` —
  // o jogo usa step variável (não 6) que a fórmula sozinha não reproduz.
  app.get('/api/formulas/auction-level-range', (req: Request, res: Response) => {
    let level = qsInt(req.query.level as string | undefined, NaN);
    if (!Number.isFinite(level)) {
      const view = getStateView();
      level = view?.snapshot?.level ?? NaN;
    }
    if (!Number.isFinite(level)) return res.status(400).json({ error: 'level missing' });
    res.json(auctionLevelRange(level));
  });

  // Opções aceitas pelo <select name="itemLevel"> — extraídas direto do HTML
  // do leilão. Use isso pra popular o dropdown da UI, é a única fonte que
  // bate 100% com o que o servidor aceita (o step varia com o nível).
  app.get('/api/auction/level-options', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    try {
      const ttypeStr = qs(req.query.ttype as string | undefined);
      const ttype = ttypeStr !== null && ttypeStr !== '' ? parseInt(ttypeStr, 10) : undefined;
      const result = await fetchAuctionLevelOptions(client, { ttype });
      res.json(result);
    } catch (e) {
      log.warn(`UI /api/auction/level-options failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
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
  app.get('/api/mercs/suggestions', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: 'client not ready' });
    try {
      const ttypeStr = qs(req.query.ttype as string | undefined);
      const ttype = ttypeStr !== null && ttypeStr !== '' ? parseInt(ttypeStr, 10) : undefined;
      const itemQuality = qsInt(req.query.itemQuality as string | undefined, -1);
      const slotsToConsider = (() => {
        const n = qsInt(req.query.slots as string | undefined, NaN);
        if (!Number.isFinite(n)) return 4;
        return Math.max(1, Math.min(9, n));
      })();
      const refreshStr = qs(req.query.refresh as string | undefined);
      const refresh = refreshStr === '1' || refreshStr === 'true';
      const view = getStateView();
      const charLevel = view?.snapshot?.level ?? null;
      const range = charLevel ? auctionLevelRange(charLevel) : null;
      const itemLevelStr = qs(req.query.itemLevel as string | undefined);
      const itemLevel = itemLevelStr !== null ? parseInt(itemLevelStr, 10) : (range?.min ?? 36);

      // Refresh ou DB vazio → fetchAll antes de gerar sugestões.
      if (refresh || readAllCharacters().length === 0) {
        const all = await fetchAllCharacters(client);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persistCharacters(all as any);
      }
      const fetchOpts: Parameters<typeof fetchAuctionList>[1] = {
        filter: { itemType: 0, itemLevel, itemQuality, doll: 1 },
      };
      if (ttype !== undefined) (fetchOpts as Record<string, unknown>)['ttype'] = ttype;
      const list = await fetchAuctionList(client, fetchOpts);
      const chars = readAllCharacters();
      // Inclui o char principal (doll=1) + mercs reais. Player alts (mesmo
      // nome do main, doll!=1) são pulados pra não bagunçar a ordem
      // posicional dos mercs (médico, killer, tanque, killer).
      const playerName = view?.snapshot?.charName ?? chars.find((c) => c.doll === 1)?.name ?? null;
      const orderedChars = chars
        .filter((c) => c.doll === 1 || !playerName || c.name !== playerName)
        .sort((a, b) => a.doll - b.doll);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const suggestions = buildSuggestions(list.listings as any, orderedChars as any, { slotsToConsider });

      // Dedup entre slots (ring1/ring2 principalmente): se um mesmo
      // auctionId aparece em mais de um slot do mesmo merc, mantemos apenas
      // no primeiro (com priority maior) e anotamos `dupOf` no resto.
      type MercSuggEntry = { suggestions: Array<{ slot: string; candidates: Array<{ auctionId: number; dupOf?: string }> }> };
      for (const m of suggestions as MercSuggEntry[]) {
        const seen = new Map<number, string>();   // auctionId -> primeiro slot que listou
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
        globalTimeBucket: list.globalTimeBucket ?? null,
        mercs: suggestions,
      });
    } catch (e) {
      log.warn(`UI /api/mercs/suggestions failed: ${(e as Error).message}`);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Debug: capturar HTML cru do leilão com filtros aplicados (POST). Útil pra
  // refinar parser de "meu lance"/currentBid sem ter que decifrar o JSON parseado.
  app.get('/api/debug/auction-html', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).type('text').send('client not ready');
    const params: Record<string, string | number | undefined | null> = { mod: 'auction' };
    const ttypeVal = qs(req.query.ttype as string | undefined);
    if (ttypeVal !== null) params['ttype'] = ttypeVal;
    const body: Record<string, string | number | boolean | undefined | null> = {
      doll: qsInt(req.query.doll as string | undefined, 1),
      qry: qs(req.query.qry as string | undefined) ?? '',
      itemLevel: qsInt(req.query.itemLevel as string | undefined, 43),
      itemType: qsInt(req.query.itemType as string | undefined, 0),
      itemQuality: qsInt(req.query.itemQuality as string | undefined, -1),
    };
    try {
      const html = await client.postForm('/game/index.php', params, body);
      res.type('text/plain; charset=utf-8').send(typeof html === 'string' ? html : JSON.stringify(html));
    } catch (e) {
      res.status(500).type('text').send(`fetch failed: ${(e as Error).message}`);
    }
  });

  // Debug: GET arbitrary game route via the active client. Only listens on
  // 127.0.0.1, but still gated to common safe params. Returns text/html so it
  // renders raw in the browser (View Source). Useful to capture HTML when the
  // parser is missing some state (e.g., "working" indicator).
  app.get('/api/debug/html', async (req: Request, res: Response) => {
    const client = getClient();
    if (!client) return res.status(503).type('text').send('client not ready (login still in progress?)');
    const params: Record<string, string | number | undefined | null> = {};
    for (const k of ['mod', 'submod', 'loc', 'sub']) {
      const v = qs(req.query[k] as string | undefined);
      if (v !== null) params[k] = v;
    }
    if (!params['mod']) return res.status(400).type('text').send('usage: /api/debug/html?mod=overview[&submod=][&loc=][&doll=N][&raw=1]');
    const dollVal = qs(req.query.doll as string | undefined);
    if (dollVal !== null) params['doll'] = dollVal;
    const rawStr = qs(req.query.raw as string | undefined);
    const noXhr = rawStr === '1' || rawStr === 'true';
    try {
      log.debug(`UI debug GET ${JSON.stringify(params)} noXhr=${noXhr}`);
      const html = await client.fetchRawHtml('/game/index.php', params, { noXhr });
      res.type('text/plain; charset=utf-8').send(typeof html === 'string' ? html : JSON.stringify(html));
    } catch (e) {
      res.status(500).type('text').send(`fetch failed: ${(e as Error).message}`);
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  return await new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.ui.port, '127.0.0.1', () => {
      log.info(`UI running at http://localhost:${config.ui.port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
