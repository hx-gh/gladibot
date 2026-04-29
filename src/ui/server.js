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
import { fetchAuctionList } from '../actions/auction.js';

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
    if (!params.mod) return res.status(400).type('text').send('usage: /api/debug/html?mod=overview[&submod=][&loc=]');
    try {
      log.debug(`UI debug GET ${JSON.stringify(params)}`);
      const html = await client.fetchRawHtml('/game/index.php', params);
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
