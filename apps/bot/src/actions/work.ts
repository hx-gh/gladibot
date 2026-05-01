import { config } from '../config.js';
import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { parseWork } from '../state.js';
import type { GladiatusClient } from '../client.js';
import type { BotSnapshot, WorkStatus } from '@gladibot/shared';

// HTTP-only GET so we don't navigate the bot's main page (which would race
// with the orchestrator's overview navigation in subsequent ticks).
export async function fetchWorkStatus(client: GladiatusClient): Promise<WorkStatus> {
  const html = await client.fetchRawHtml('/game/index.php', { mod: 'work' });
  return parseWork(html as string);
}

// Job IDs (mod=work):
//   0 Senador (1-24h, premium)   1 Joalheiro (1-4h, premium)
//   2 Rapaz do estábulo (1-8h)   3 Agricultor (1-6h)
//   4 Talhante (1-3h)            5 Pescador (4-10h)
//   6 Padeiro (1-4h)             7 Ferreiro (12h)
//   8 Mestre Ferreiro (6h, premium)
const JOB_HOUR_LIMITS: Record<number, [number, number]> = {
  0: [1, 24], 1: [1, 4], 2: [1, 8], 3: [1, 6], 4: [1, 3],
  5: [4, 10], 6: [1, 4], 7: [12, 12], 8: [6, 6],
};

interface WorkOpts {
  force?: boolean;
  jobType?: number;
  hours?: number;
}

export async function startWork(client: GladiatusClient, state: BotSnapshot, opts: WorkOpts = {}): Promise<{ acted: boolean; reason?: string; raw?: unknown }> {
  if (!isActionsEnabled()) {
    return { acted: false, reason: 'actions disabled' };
  }
  if (!opts.force && ((state.expedition.points ?? 0) > 0 || (state.dungeon.points ?? 0) > 0)) {
    return { acted: false, reason: 'still has expedition or dungeon points' };
  }

  const job = opts.jobType ?? config.work.job;
  const limits = JOB_HOUR_LIMITS[job];
  if (!limits) {
    log.warn(`WORK unknown jobType=${job} — skipping`);
    return { acted: false, reason: `unknown job ${job}` };
  }
  const [minH, maxH] = limits;
  const requested = opts.hours ?? config.work.hours;
  const hours = Math.max(minH, Math.min(maxH, requested));

  log.info(`WORK start job=${job} hours=${hours}`);
  const html = await client.postForm('/game/index.php', {
    mod: 'work',
    submod: 'start',
  }, {
    jobType: job,
    timeToWork: hours,
  });
  return { acted: true, raw: html };
}
