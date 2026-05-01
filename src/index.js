import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { GladiatusClient, SessionExpiredError } from './client.js';
import { tick } from './orchestrator.js';
import { launch, ensureLoggedIn, readSession } from './browser.js';
import { log } from './log.js';
import { config } from './config.js';
import { startUiServer } from './ui/server.js';
import {
  setLoopMode,
  setClient,
  setActionsEnabled,
  markTickStart,
  markTickEnd,
  setNextTickAt,
  consumeTickNowRequest,
  isPaused,
} from './botState.js';

function parseFlags(argv) {
  const flags = { loop: false, once: false, noConfirm: false, noUi: false, noActions: false };
  for (const a of argv.slice(2)) {
    if (a === '--loop') flags.loop = true;
    if (a === '--once') flags.once = true;
    if (a === '--no-confirm' || a === '--yes' || a === '-y') flags.noConfirm = true;
    if (a === '--no-ui') flags.noUi = true;
    if (a === '--no-actions' || a === '--observe') flags.noActions = true;
  }
  if (!flags.loop && !flags.once) flags.once = true;
  return flags;
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

// Heartbeat: durante sleep longo (cooldown ou work), navega pra overview a
// cada ~90s±45s pra renovar cookies + sh/csrf. Sem isso, POSTs (filtro do
// leilão principalmente) caem em redirect pro lobby Gameforge depois de
// alguns minutos parados, sem que o `_exec` perceba (resposta é 200 com HTML
// do lobby, não 401/403). Jitter pra mascarar — distribuição uniforme em
// [45s, 135s], indistinguível de player olhando a aba a cada 1–2min.
const HEARTBEAT_BASE_SEC = 90;
const HEARTBEAT_JITTER_SEC = 45;
function nextHeartbeatDelay() {
  const j = (Math.random() * 2 - 1) * HEARTBEAT_JITTER_SEC;
  return Math.max(30, HEARTBEAT_BASE_SEC + j);
}

// Sleep that wakes up early on tick-now request and checks pause state.
// Polls every 500ms — fine for a UI driven by 2s polling on the other side.
async function interruptibleSleep(seconds, stopRef, page, session) {
  const end = Date.now() + seconds * 1000;
  let nextHb = Date.now() + nextHeartbeatDelay() * 1000;
  setNextTickAt(end);
  while (Date.now() < end) {
    if (stopRef.stopping) return 'stop';
    if (consumeTickNowRequest()) return 'tick-now';
    // Heartbeat: só dispara se ainda sobrar pelo menos 5s de sleep — perto do
    // fim, o tick natural já vai navegar e renovar.
    if (page && session && Date.now() >= nextHb && Date.now() + 5000 < end) {
      try {
        const fresh = await readSession(page);
        session.sh = fresh.sh;
        session.csrf = fresh.csrf;
        log.debug('heartbeat: session refreshed');
      } catch (e) {
        log.warn(`heartbeat refresh failed: ${e.message}`);
      }
      nextHb = Date.now() + nextHeartbeatDelay() * 1000;
    }
    await sleepMs(Math.min(500, end - Date.now()));
  }
  return 'done';
}

async function awaitUserOk(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

function openInBrowser(url) {
  // Cross-platform open. start "" forces Windows to treat the URL as a target
  // rather than a window title. Detached + unref so the bot doesn't block.
  try {
    const cmd = process.platform === 'win32' ? 'start "" "' + url + '"'
              : process.platform === 'darwin' ? `open "${url}"`
              : `xdg-open "${url}"`;
    const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    log.warn(`Falha ao abrir browser: ${e.message}. Abra manualmente: ${url}`);
  }
}

async function main() {
  const flags = parseFlags(process.argv);

  // CLI flag overrides env. Defaults to env (which defaults to true).
  setActionsEnabled(flags.noActions ? false : config.actions.enabled);
  if (flags.noActions || !config.actions.enabled) {
    log.warn('ACTIONS DISABLED — bot will only observe (no heal/exp/dung/work)');
  }

  // Spin up the UI as early as possible so the user can already see logs of
  // browser launch / login flow streaming in. UI only runs in --loop mode
  // (in --once it'd die before the user could open it).
  let uiServer = null;
  if (flags.loop && !flags.noUi) {
    try {
      uiServer = await startUiServer();
      const url = `http://localhost:${config.ui.port}`;
      if (config.ui.autoOpen) openInBrowser(url);
    } catch (e) {
      log.warn(`UI failed to start: ${e.message}. Continuing without UI.`);
    }
  }

  const { ctx, page } = await launch();

  try {
    const gamePage = await ensureLoggedIn(ctx, page);
    const session = await readSession(gamePage);
    log.info(`session OK (sh=${session.sh.slice(0, 8)}…, csrf=${session.csrf.slice(0, 8)}…)`);

    if (!flags.noConfirm) {
      await awaitUserOk('\n>>> Login OK e dentro do jogo. Pressione Enter para iniciar o bot (Ctrl+C cancela)... ');
    }

    const client = new GladiatusClient(gamePage, session);
    setClient(client);
    setLoopMode(flags.loop ? 'loop' : 'once');
    log.info(`gladibot starting (mode=${flags.loop ? 'loop' : 'once'})`);

    const stopRef = { stopping: false };
    const onSig = () => {
      if (!stopRef.stopping) {
        stopRef.stopping = true;
        log.info('shutdown requested…');
      }
    };
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);

    // Errors raised inside tick() should NOT kill the loop in --loop mode.
    // Only SessionExpiredError (auth re-login required) and bootstrap errors
    // (which raise outside this loop) are fatal. Network blips, parser
    // hiccups, transient game-side 5xx — log.warn + sleep brief + retry.
    const TICK_ERROR_RETRY_SEC = 30;

    let nextPauseHb = Date.now() + nextHeartbeatDelay() * 1000;
    do {
      // Pause gate — block (with polling) while UI keeps us paused. Mesmo
      // ritmo de heartbeat do sleep: durante pause longo (user investigando
      // algo na UI), session ainda precisa ficar viva.
      while (isPaused() && !stopRef.stopping) {
        setNextTickAt(null);
        if (Date.now() >= nextPauseHb) {
          try {
            const fresh = await readSession(gamePage);
            client.session.sh = fresh.sh;
            client.session.csrf = fresh.csrf;
            log.debug('heartbeat (pause): session refreshed');
          } catch (e) {
            log.warn(`heartbeat (pause) refresh failed: ${e.message}`);
          }
          nextPauseHb = Date.now() + nextHeartbeatDelay() * 1000;
        }
        await sleepMs(500);
      }
      if (stopRef.stopping) break;

      markTickStart();
      let sleepSec;
      let tickError = null;
      try {
        sleepSec = await tick(client);
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          markTickEnd();
          throw e; // fatal — bubbles to outer catch
        }
        tickError = e;
      } finally {
        markTickEnd();
      }

      if (tickError) {
        if (!flags.loop) throw tickError; // --once still treats tick errors as fatal
        log.warn(`tick failed: ${tickError?.message || tickError}; retrying in ${TICK_ERROR_RETRY_SEC}s`);
        if (tickError?.stack) log.debug(tickError.stack);
        sleepSec = TICK_ERROR_RETRY_SEC;
      }

      if (!flags.loop || stopRef.stopping) break;

      log.info(`sleeping ${sleepSec}s`);
      const reason = await interruptibleSleep(sleepSec, stopRef, gamePage, client.session);
      if (reason === 'tick-now') log.info('tick-now requested, waking up early');
    } while (!stopRef.stopping);
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      log.error('SESSION EXPIRED beyond auto-refresh. Re-run with --once and complete login again.');
      log.error(e.message);
      process.exitCode = 2;
    } else {
      log.error('fatal:', e?.stack || e);
      process.exitCode = 1;
    }
  } finally {
    await ctx.close().catch(() => {});
    if (uiServer) {
      await new Promise((r) => uiServer.close(r));
    }
    log.info('gladibot done.');
  }
}

main();
