import readline from 'node:readline/promises';
import { GladiatusClient, SessionExpiredError } from './client.js';
import { tick } from './orchestrator.js';
import { launch, ensureLoggedIn, readSession } from './browser.js';
import { log } from './log.js';

function parseFlags(argv) {
  const flags = { loop: false, once: false, noConfirm: false };
  for (const a of argv.slice(2)) {
    if (a === '--loop') flags.loop = true;
    if (a === '--once') flags.once = true;
    if (a === '--no-confirm' || a === '--yes' || a === '-y') flags.noConfirm = true;
  }
  if (!flags.loop && !flags.once) flags.once = true;
  return flags;
}

function sleep(seconds) {
  return new Promise((r) => setTimeout(r, Math.max(0, seconds * 1000)));
}

async function awaitUserOk(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function main() {
  const flags = parseFlags(process.argv);
  const { ctx, page } = await launch();

  try {
    await ensureLoggedIn(page);
    const session = await readSession(page);
    log.info(`session OK (sh=${session.sh.slice(0, 8)}…, csrf=${session.csrf.slice(0, 8)}…)`);

    if (!flags.noConfirm) {
      await awaitUserOk('\n>>> Login OK e dentro do jogo. Pressione Enter para iniciar o bot (Ctrl+C cancela)... ');
    }

    const client = new GladiatusClient(page, session);
    log.info(`gladibot starting (mode=${flags.loop ? 'loop' : 'once'})`);

    let stopping = false;
    const onSig = () => { if (!stopping) { stopping = true; log.info('shutdown requested…'); } };
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);

    do {
      const sleepSec = await tick(client);
      if (!flags.loop || stopping) break;
      log.info(`sleeping ${sleepSec}s`);
      await sleep(sleepSec);
    } while (!stopping);
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
    log.info('gladibot done.');
  }
}

main();
