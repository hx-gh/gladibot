import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

export async function launch() {
  const dir = path.resolve(config.browser.userDataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  log.info(`launching browser (channel=${config.browser.channel}, headless=${config.browser.headless})`);
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: config.browser.channel,
    headless: config.browser.headless,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

// Returns true if the page is the in-game (logged in on the configured server).
function isInGame(page) {
  return page.url().startsWith(`${config.baseUrl}/game/index.php`);
}

// Opens the lobby URL. If we're not already in the game, waits for the user to
// finish login and select the configured server. Headless mode cannot do this
// (no UI for login), so it errors out clearly.
export async function ensureLoggedIn(page) {
  log.info(`Opening lobby: ${config.lobbyUrl}`);
  await page.goto(config.lobbyUrl, { waitUntil: 'domcontentloaded' }).catch((e) => {
    log.warn(`lobby goto warning: ${e.message}`);
  });

  if (isInGame(page)) {
    log.info('Already in-game (session restored).');
    return;
  }

  if (config.browser.headless) {
    throw new Error(
      'Headless mode cannot prompt for login. Run with HEADLESS=false first to establish a session.'
    );
  }

  log.warn('Lobby aberto. Faça login no Google e entre no servidor configurado.');
  log.warn(`Aguardando sua entrada em ${config.baseUrl}/game/index.php ...`);
  await page.waitForURL((url) => url.toString().startsWith(`${config.baseUrl}/game/index.php`), {
    timeout: 0,
  });
  log.info('Entrada no jogo detectada.');
}

// Reads sh + csrf from the current overview page. Caller is expected to
// already be on /game/index.php?mod=overview (or call refreshSession to navigate).
export async function readSession(page) {
  const url = page.url();
  const sh = (url.match(/[?&]sh=([a-f0-9]+)/) || [])[1];
  const html = await page.content();
  const csrf =
    (html.match(/csrf[_-]?token['":=\s]+["']?([a-f0-9]{64})/i) || [])[1] ||
    (await page.evaluate(() => window.csrfToken || null));
  if (!sh || !csrf) {
    throw new Error('Could not extract sh/csrf from current page');
  }
  return { sh, csrf };
}

export async function refreshSession(page) {
  await page.goto(`${config.baseUrl}/game/index.php?mod=overview`, { waitUntil: 'domcontentloaded' });
  return readSession(page);
}
