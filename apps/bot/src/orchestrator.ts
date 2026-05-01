import type { BotSnapshot, WorkStatus } from '@gladibot/shared';
import type { GladiatusClient } from './client.js';
import { parseOverview, mergeAjaxResponse, summarizeState } from './state.js';
import { healIfNeeded } from './actions/heal.js';
import { attackExpedition } from './actions/expedition.js';
import { attackDungeon } from './actions/dungeon.js';
import { startWork, fetchWorkStatus } from './actions/work.js';
import { openHealPackages } from './actions/packages.js';
import { autoBuyHeal } from './actions/buyHeal.js';
import { log } from './log.js';
import { config } from './config.js';
import { setSnapshot } from './botState.js';

// Slack added on top of work.secondsLeft before next tick. Avoids racing the
// server: if we wake exactly at end-time, the work might still be settling
// (gold credit, status flip). 10s is generous and irrelevant on hour-scale jobs.
const WORK_SLACK_SEC = 10;

async function fetchState(client: GladiatusClient): Promise<BotSnapshot> {
  const html = await client.getHtml('/game/index.php', { mod: 'overview' });
  return parseOverview(html);
}

// Returns the number of seconds to sleep before the next tick.
// Strategy: take the smallest active cooldown across the slots we care about.
function sleepUntil(state: BotSnapshot): number {
  const cds = [
    state.expedition.cooldownSec,
    state.dungeon.cooldownSec,
  ].filter((c): c is number => typeof c === 'number' && c > 0);
  if (cds.length === 0) return Math.ceil(config.loop.tickMinMs / 1000);
  return Math.max(Math.ceil(config.loop.tickMinMs / 1000), Math.min(...cds));
}

// One tick: read state, do every action that's ready *right now*, return
// next sleep duration. The user's clarified semantic: expedition AND dungeon
// fire on the same tick when both are off cooldown, then we sleep.
async function maybeHeal(client: GladiatusClient, state: BotSnapshot, label: string): Promise<BotSnapshot> {
  const heal = await healIfNeeded(client, state);
  if (heal.acted) {
    log.info(`  after heal (${label}):`, summarizeState(mergeAjaxResponse(state, heal.json)));
    return mergeAjaxResponse(state, heal.json);
  }
  log.debug(`  heal skipped (${label}):`, heal.reason);
  return state;
}

export async function tick(client: GladiatusClient): Promise<number> {
  let state = await fetchState(client);

  // 0. Gate "trabalhando". Overview NÃO sinaliza isso — é preciso consultar
  //    mod=work. Se trabalhando, pula tudo (heal/exp/dung) e dorme até terminar.
  //    Sem esse gate, dungeon points regeneram durante o trabalho e o bot
  //    tentava atacar mesmo com personagem ocupado.
  const work: WorkStatus = await fetchWorkStatus(client);
  state.working = work;
  setSnapshot(state);
  if (work.active) {
    log.info(`WORKING ${work.jobName || ''} — ${work.secondsLeft ?? '?'}s restantes; skipping actions`);
    return Math.max((work.secondsLeft ?? 0) + WORK_SLACK_SEC, Math.ceil(config.loop.tickMinMs / 1000));
  }

  log.info('TICK', summarizeState(state));

  // 1. Heal pre-fight — cobre cenário de startup com HP crítico (ou HP que
  //    ficou crítico no fim do tick anterior, esperando dormir o cooldown).
  state = await maybeHeal(client, state, 'pre');

  // 1b. Top-off de comida (pró-ativo): packages (grátis) + auto-buy no leilão.
  //     Roda quando inventário tem menos do que `autobuy.target` itens de cura.
  //     Antes do AFK fallback porque pode resolvê-lo (low HP sem food → busca
  //     comida em vez de mandar pro estábulo). Erros aqui não derrubam o tick.
  const target = config.heal.autobuy.target;
  if ((state.inventoryFood?.length ?? 0) < target) {
    if (config.packages.enabled) {
      try {
        const r = await openHealPackages(client, state.inventoryGrid, target * 2);
        if (r.opened > 0) {
          state = await fetchState(client);
          setSnapshot(state);
        }
      } catch (e) { log.warn(`openHealPackages failed: ${(e as Error).message}`); }
    }
    if (config.heal.autobuy.enabled && (state.inventoryFood?.length ?? 0) < target) {
      try {
        const r = await autoBuyHeal(client, state, {
          target,
          minRatio: config.heal.autobuy.minRatio,
          maxBudget: config.heal.autobuy.maxBudgetPerTick,
        });
        if (r.bought > 0) {
          state = await fetchState(client);
          setSnapshot(state);
        }
      } catch (e) { log.warn(`autoBuyHeal failed: ${(e as Error).message}`); }
    }
  }

  // 1c. AFK fallback — HP baixo e inventário ainda sem comida (packages e
  //     leilão não cobriram): não dá pra batalhar e pontos NÃO regeneram com
  //     o tempo, só HP. Mandamos pra Rapaz do estábulo (8h) pra queimar tempo
  //     até o HP voltar. Bypass do gate de pontos via { force: true }.
  const noFood = (state.inventoryFood?.length ?? 0) === 0;
  const lowHp = (state.hpPercent ?? 100) < config.heal.thresholdPct;
  if (lowHp && noFood) {
    log.warn(`AFK fallback: HP ${state.hpPercent}% sem comida — Rapaz do estábulo 8h`);
    await startWork(client, state, { force: true, jobType: 2, hours: 8 });
    return Math.ceil(config.loop.tickMinMs / 1000);
  }

  // 2. Expedition (if free)
  const exp = await attackExpedition(client, state);
  if (exp.acted) {
    log.info('  expedition fired');
  } else {
    log.debug('  expedition skipped:', exp.reason);
  }

  // 3. Dungeon (if free) — independent cooldown
  const dung = await attackDungeon(client, state, config.dungeon.location);
  if (dung.acted) {
    log.info('  dungeon fired');
  } else {
    log.debug('  dungeon skipped:', dung.reason);
  }

  // 4. Work fallback (only if both pools are dry)
  if ((state.expedition.points ?? 1) <= 0 && (state.dungeon.points ?? 1) <= 0) {
    await startWork(client, state);
  }

  // 5. Re-pull state — fresh cooldowns + HP pós-luta
  const fresh = await fetchState(client);
  setSnapshot(fresh);

  // 6. Heal pós-luta — se a expedição/masmorra deixou o HP abaixo do
  //    threshold, curamos AGORA (antes de dormir o cooldown), com missing
  //    grande o suficiente pra usar comida grande sem overflow.
  await maybeHeal(client, fresh, 'post');

  const sleepSec = sleepUntil(fresh);
  log.info(`  next tick in ${sleepSec}s`);
  return sleepSec;
}
