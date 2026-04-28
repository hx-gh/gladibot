import { config } from '../config.js';
import { log } from '../log.js';

// TODO: capturar o endpoint exato do botão "Ir!" na página mod=work.
// Provável shape: POST /game/ajax.php?mod=work&submod=start com body
// { workId: <id_do_rapaz>, hours: <1..8>, ... }
//
// Until then, this stub logs the intent so the loop can still progress and we
// won't accidentally lock the character into 8h work via a guessed endpoint.
export async function startWork(client, state) {
  if ((state.expedition.points ?? 0) > 0 || (state.dungeon.points ?? 0) > 0) {
    return { acted: false, reason: 'still has expedition or dungeon points' };
  }
  log.warn(
    `WORK would start (${config.work.job}, ${config.work.hours}h) ` +
      `— endpoint not yet captured. No-op for now.`
  );
  return { acted: false, reason: 'work endpoint not implemented' };
}
