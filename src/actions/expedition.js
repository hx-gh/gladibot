import { config } from '../config.js';
import { log } from '../log.js';

export async function attackExpedition(client, state) {
  if ((state.expedition.cooldownSec ?? 0) > 0) {
    return { acted: false, reason: `expedition on cooldown ${state.expedition.cooldownSec}s` };
  }
  if ((state.expedition.points ?? 0) <= 0) {
    return { acted: false, reason: 'expedition points exhausted' };
  }

  const { location, stage } = config.expedition;
  log.info(`EXPEDITION attack loc=${location} stage=${stage}`);
  const text = await client.getAjax('/game/ajax.php', {
    mod: 'location',
    submod: 'attack',
    location,
    stage,
    premium: 0,
  });
  // Response is the combat report HTML/JS. We don't parse it here — the next
  // overview pull will reflect the new HP/points/cooldowns.
  return { acted: true, raw: text };
}
