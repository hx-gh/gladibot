import { parseOverview, mergeAjaxResponse, summarizeState } from './state.js';
import { healIfNeeded } from './actions/heal.js';
import { attackExpedition } from './actions/expedition.js';
import { attackDungeon } from './actions/dungeon.js';
import { startWork } from './actions/work.js';
import { log } from './log.js';
import { config } from './config.js';

async function fetchState(client) {
  const html = await client.getHtml('/game/index.php', { mod: 'overview' });
  return parseOverview(html);
}

// Returns the number of seconds to sleep before the next tick.
// Strategy: take the smallest active cooldown across the slots we care about.
function sleepUntil(state) {
  const cds = [
    state.expedition.cooldownSec,
    state.dungeon.cooldownSec,
  ].filter((c) => typeof c === 'number' && c > 0);
  if (cds.length === 0) return Math.ceil(config.loop.tickMinMs / 1000);
  return Math.max(Math.ceil(config.loop.tickMinMs / 1000), Math.min(...cds));
}

// One tick: read state, do every action that's ready *right now*, return
// next sleep duration. The user's clarified semantic: expedition AND dungeon
// fire on the same tick when both are off cooldown, then we sleep.
export async function tick(client) {
  let state = await fetchState(client);
  log.info('TICK', summarizeState(state));

  // 1. Heal first (so subsequent fights start with the most HP we can spare)
  const heal = await healIfNeeded(client, state);
  if (heal.acted) {
    state = mergeAjaxResponse(state, heal.json);
    log.info('  after heal:', summarizeState(state));
  } else {
    log.debug('  heal skipped:', heal.reason);
  }

  // 2. Expedition (if free)
  const exp = await attackExpedition(client, state);
  if (exp.acted) {
    log.info('  expedition fired');
  } else {
    log.debug('  expedition skipped:', exp.reason);
  }

  // 3. Dungeon (if free) — independent cooldown
  const dung = await attackDungeon(client, state);
  if (dung.acted) {
    log.info('  dungeon fired');
  } else {
    log.debug('  dungeon skipped:', dung.reason);
  }

  // 4. Work fallback (only if both pools are dry)
  if ((state.expedition.points ?? 1) <= 0 && (state.dungeon.points ?? 1) <= 0) {
    await startWork(client, state);
  }

  // 5. Re-pull state to recompute next sleep window with fresh cooldowns
  const fresh = await fetchState(client);
  const sleepSec = sleepUntil(fresh);
  log.info(`  next tick in ${sleepSec}s`);
  return sleepSec;
}
