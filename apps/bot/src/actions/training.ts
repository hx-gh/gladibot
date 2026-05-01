import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { parseTraining } from '../state.js';
import type { GladiatusClient } from '../client.js';

const STAT_NAMES: Record<number, string> = {
  1: 'strength', 2: 'dexterity', 3: 'agility',
  4: 'constitution', 5: 'charisma', 6: 'intelligence',
};

// HTTP-only GET. Doesn't navigate the bot's main page (avoids racing tick).
export async function fetchTrainingStatus(client: GladiatusClient): Promise<ReturnType<typeof parseTraining>> {
  const html = await client.fetchRawHtml('/game/index.php', { mod: 'training' });
  return parseTraining(html as string);
}

// Train one skill. Endpoint observed: GET /game/index.php?mod=training&submod=train&skillToTrain=N
// Behaves like a navigation in the browser (link click), but HTTP GET works the same — server
// applies the training and redirects back to mod=training. We re-parse the response to give the
// UI an immediate updated cost / available-gold view.
export async function trainSkill(client: GladiatusClient, skillId: number | string): Promise<{ ok: boolean; reason?: string; training?: ReturnType<typeof parseTraining> }> {
  if (!isActionsEnabled()) return { ok: false, reason: 'actions disabled' };

  const id = parseInt(String(skillId), 10);
  if (!STAT_NAMES[id]) return { ok: false, reason: `invalid skillId ${skillId}` };

  log.info(`TRAINING ${STAT_NAMES[id]} (skillToTrain=${id})`);
  const html = await client.fetchRawHtml('/game/index.php', {
    mod: 'training',
    submod: 'train',
    skillToTrain: id,
  });
  return { ok: true, training: parseTraining(html as string) };
}
