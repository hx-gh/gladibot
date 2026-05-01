import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { parseTraining } from '../state.js';

const STAT_NAMES = {
  1: 'strength', 2: 'dexterity', 3: 'agility',
  4: 'constitution', 5: 'charisma', 6: 'intelligence',
};

// HTTP-only GET. Doesn't navigate the bot's main page (avoids racing tick).
export async function fetchTrainingStatus(client) {
  const html = await client.fetchRawHtml('/game/index.php', { mod: 'training' });
  return parseTraining(html);
}

// Train one skill. Endpoint observed: GET /game/index.php?mod=training&submod=train&skillToTrain=N
// Behaves like a navigation in the browser (link click), but HTTP GET works the same — server
// applies the training and redirects back to mod=training. We re-parse the response to give the
// UI an immediate updated cost / available-gold view.
export async function trainSkill(client, skillId) {
  if (!isActionsEnabled()) return { ok: false, reason: 'actions disabled' };

  const id = parseInt(skillId, 10);
  if (!STAT_NAMES[id]) return { ok: false, reason: `invalid skillId ${skillId}` };

  log.info(`TRAINING ${STAT_NAMES[id]} (skillToTrain=${id})`);
  const html = await client.fetchRawHtml('/game/index.php', {
    mod: 'training',
    submod: 'train',
    skillToTrain: id,
  });
  return { ok: true, training: parseTraining(html) };
}
