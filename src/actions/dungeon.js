import { log } from '../log.js';

// Parse dungeon page HTML for available fights: <img onclick="startFight(posi, did)">
// Returns the smallest-posi fight (deterministic; user can override via strategy later).
export function parseDungeonFights(html) {
  const fights = [];
  const re = /onclick=["']\s*startFight\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/g;
  for (const m of html.matchAll(re)) {
    fights.push({ posi: parseInt(m[1], 10), did: parseInt(m[2], 10) });
  }
  fights.sort((a, b) => a.posi - b.posi);
  return fights;
}

// Detect "Entre na masmorra" landing page (boss defeated, dungeon needs restart).
export function isDungeonEntryPage(html) {
  return /Entre na masmorra/i.test(html) && /button[^>]*>\s*Normal\s*</i.test(html);
}

export async function fetchDungeonState(client, locId = 3) {
  const html = await client.getHtml('/game/index.php', { mod: 'dungeon', loc: locId });
  return {
    html,
    fights: parseDungeonFights(html),
    needsRestart: isDungeonEntryPage(html),
  };
}

export async function attackDungeon(client, state, locId = 3) {
  if ((state.dungeon.cooldownSec ?? 0) > 0) {
    return { acted: false, reason: `dungeon on cooldown ${state.dungeon.cooldownSec}s` };
  }
  if ((state.dungeon.points ?? 0) <= 0) {
    return { acted: false, reason: 'dungeon points exhausted' };
  }

  const { fights, needsRestart } = await fetchDungeonState(client, locId);

  if (needsRestart) {
    log.warn('DUNGEON cleared (boss down) — restart endpoint not yet captured. Skipping.');
    // TODO: implement startNewDungeon when the cURL is captured.
    return { acted: false, reason: 'dungeon needs restart (Normal endpoint TBD)' };
  }
  if (fights.length === 0) {
    return { acted: false, reason: 'no fights visible on dungeon page' };
  }

  const target = fights[0];
  log.info(`DUNGEON fight posi=${target.posi} did=${target.did}`);
  const text = await client.getAjax('/game/ajax/doDungeonFight.php', {
    did: target.did,
    posi: target.posi,
  });
  return { acted: true, raw: text, target };
}
