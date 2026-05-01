import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

export async function launch() {
  const dir = path.resolve(config.browser.userDataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Playwright: `channel` aponta pra um binário INSTALADO no sistema (chrome,
  // msedge, chrome-beta, ...). Pra usar o chromium bundled do Playwright,
  // NÃO passar `channel` — qualquer valor "chromium"/vazio cai nesse caminho.
  const channel = config.browser.channel;
  const useBundledChromium = !channel || channel.toLowerCase() === 'chromium';
  log.info(
    `launching browser (channel=${useBundledChromium ? 'bundled chromium' : channel}, headless=${config.browser.headless})`
  );
  const ctx = await chromium.launchPersistentContext(dir, {
    ...(useBundledChromium ? {} : { channel }),
    headless: config.browser.headless,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      // WSLg: sem `--window-position` o chromium bundled abre a janela "invisível"
      // (presumivelmente fora dos limites visíveis). Forçar 0,0 + start-maximized
      // garante que aparece na área de trabalho do Windows.
      '--window-position=0,0',
      '--window-size=1280,800',
      '--start-maximized',
    ],
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

// Returns true if the page is the in-game (logged in on the configured server).
function isInGame(page) {
  try {
    return page.url().startsWith(`${config.baseUrl}/game/index.php`);
  } catch {
    return false; // page closed
  }
}

// Polls all pages of the context and resolves with the first one that lands on
// the in-game URL. Handles the lobby-opens-new-tab flow (game opens in a sibling
// page, not in the lobby page itself).
function waitForGamePage(ctx, intervalMs = 500) {
  return new Promise((resolve) => {
    const tick = () => {
      for (const p of ctx.pages()) {
        if (isInGame(p)) return resolve(p);
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// Opens the lobby URL. Returns the page that is in-game — may be the same one
// passed in, or a NEW tab opened when the user clicked "Jogar" in the lobby.
// Caller must use the returned page from there on (not the original).
export async function ensureLoggedIn(ctx, initialPage) {
  log.info(`Opening lobby: ${config.lobbyUrl}`);
  await initialPage.goto(config.lobbyUrl, { waitUntil: 'domcontentloaded' }).catch((e) => {
    log.warn(`lobby goto warning: ${e.message}`);
  });

  // Maybe an existing tab is already in-game (session restored after a refresh)
  const existing = ctx.pages().find(isInGame);
  if (existing) {
    log.info('Already in-game (session restored).');
    return existing;
  }

  if (config.browser.headless) {
    throw new Error(
      'Headless mode cannot prompt for login. Run with HEADLESS=false first to establish a session.'
    );
  }

  log.warn('Lobby aberto. Faça login no Google e clique em "Jogar" no servidor configurado.');
  log.warn('O jogo costuma abrir em NOVA ABA — não feche a aba do lobby até ver "Entrada no jogo detectada".');
  log.warn(`Aguardando alguma aba chegar em ${config.baseUrl}/game/index.php ...`);

  const gamePage = await waitForGamePage(ctx);
  log.info(`Entrada no jogo detectada: ${gamePage.url().slice(0, 100)}`);
  return gamePage;
}

// Lê sh + csrf da página. SEMPRE navega pra overview primeiro pra garantir
// uma página canônica completamente carregada — assim funciona mesmo quando
// o caller acabou de chegar via lobby (URL pode ainda estar em trampolim).
//
// Estruturas observadas no HTML real (BR62):
//   <meta name="csrf-token" content="<HEX64>">
//   var secureHash = "<HEX32>";
//   ?sh=<HEX32> em todos os links/URL
export async function readSession(page) {
  await page.goto(`${config.baseUrl}/game/index.php?mod=overview`, {
    waitUntil: 'domcontentloaded',
  });

  const url = page.url();
  const html = await page.content();

  // sh: query param da URL (rota canônica), com fallback pro `var secureHash`.
  const sh =
    (url.match(/[?&]sh=([a-f0-9]+)/) || [])[1] ||
    (html.match(/var\s+secureHash\s*=\s*["']([a-f0-9]+)["']/) || [])[1] ||
    null;

  // csrf: meta tag (formato observado).
  const csrf =
    (html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([a-f0-9]{64})["']/i) || [])[1] ||
    null;

  if (!sh || !csrf) {
    log.error(`readSession failed. URL=${url}`);
    log.error(`HTML head (first 600): ${html.slice(0, 600).replace(/\s+/g, ' ')}`);
    const grep = html.match(/.{0,40}(csrf-token|secureHash).{0,200}/);
    log.error(`grep: ${grep ? grep[0].slice(0, 300) : '<no match>'}`);
    throw new Error(
      `Could not extract sh/csrf (sh=${sh ? 'OK' : 'MISSING'}, csrf=${csrf ? 'OK' : 'MISSING'})`
    );
  }
  return { sh, csrf };
}

// Mantido para compatibilidade — readSession já navega.
export const refreshSession = readSession;
