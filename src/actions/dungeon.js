import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';

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
// O form tem <h3>Entre na masmorra</h3> e <input name="dif1" value="Normal">.
export function isDungeonEntryPage(html) {
  return /Entre na masmorra/i.test(html) && /name=["']dif1["']/i.test(html);
}

// POST do form "Entre na masmorra → Normal":
//   index.php?mod=dungeon&loc=<loc>&sh=<sh>   body: dif1=Normal
// Retorna o HTML pós-entrada (já é a página da masmorra com os monstros).
export async function restartDungeon(client, locId = 3) {
  log.info(`DUNGEON restart (Normal) loc=${locId}`);
  return client.postForm('/game/index.php', { mod: 'dungeon', loc: locId }, { dif1: 'Normal' });
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
  if (!isActionsEnabled()) {
    return { acted: false, reason: 'actions disabled' };
  }
  if ((state.dungeon.cooldownSec ?? 0) > 0) {
    return { acted: false, reason: `dungeon on cooldown ${state.dungeon.cooldownSec}s` };
  }
  if ((state.dungeon.points ?? 0) <= 0) {
    return { acted: false, reason: 'dungeon points exhausted' };
  }

  let { fights, needsRestart } = await fetchDungeonState(client, locId);

  // Se o boss caiu, primeiro entra numa nova masmorra (Normal), depois re-lê
  // o HTML pra pegar a lista de lutas atualizada e seguir no mesmo tick.
  if (needsRestart) {
    await restartDungeon(client, locId);
    ({ fights, needsRestart } = await fetchDungeonState(client, locId));
    if (needsRestart) {
      // Se ainda diz "Entre na masmorra", algo deu errado (ex: sem pontos).
      return { acted: false, reason: 'dungeon restart did not advance to fights page' };
    }
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
