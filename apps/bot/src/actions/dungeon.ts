import { log } from '../log.js';
import { isActionsEnabled } from '../botState.js';
import { config } from '../config.js';
import type { GladiatusClient } from '../client.js';
import type { BotSnapshot } from '@gladibot/shared';

interface DungeonFight {
  posi: number;
  did: number;
  isBoss: boolean;
}

// Parse dungeon page HTML for available fights: <img onclick="startFight(posi, did)">
// Returns the smallest-posi fight (deterministic; user can override via strategy later).
//
// Boss detection: o boss usa `<div class="map_label" ... onclick="startFight(...)">Chefe</div>`
// em vez do `<img>` dos monstros normais. Marcamos `isBoss: true` cruzando os dois regexes.
export function parseDungeonFights(html: string): DungeonFight[] {
  const fights: DungeonFight[] = [];
  const allRe = /onclick=["']\s*startFight\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/g;
  for (const m of html.matchAll(allRe)) {
    fights.push({ posi: parseInt(m[1]!, 10), did: parseInt(m[2]!, 10), isBoss: false });
  }

  const bossRe = /class=["']map_label["'][^>]*onclick=["']\s*startFight\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)[^>]*>\s*Chefe/gi;
  const bossKeys = new Set<string>();
  for (const m of html.matchAll(bossRe)) {
    bossKeys.add(`${m[1]!}-${m[2]!}`);
  }
  for (const f of fights) {
    if (bossKeys.has(`${f.posi}-${f.did}`)) f.isBoss = true;
  }

  fights.sort((a, b) => a.posi - b.posi);
  return fights;
}

// Detect "Entre na masmorra" landing page (boss defeated, dungeon needs restart).
// O form tem <h3>Entre na masmorra</h3> e <input name="dif1" value="Normal">.
export function isDungeonEntryPage(html: string): boolean {
  return /Entre na masmorra/i.test(html) && /name=["']dif1["']/i.test(html);
}

// Extrai o `dungeonId` do `<input type="hidden" name="dungeonId" value="...">`
// presente na página da masmorra ativa. Necessário pra POST cancelDungeon.
export function parseDungeonId(html: string): number | null {
  const m = html.match(/<input[^>]*name=["']dungeonId["'][^>]*value=["'](\d+)["']/i)
    || html.match(/<input[^>]*value=["'](\d+)["'][^>]*name=["']dungeonId["']/i);
  return m ? parseInt(m[1]!, 10) : null;
}

// POST do form "Entre na masmorra → Normal":
//   index.php?mod=dungeon&loc=<loc>&sh=<sh>   body: dif1=Normal
// Retorna o HTML pós-entrada (já é a página da masmorra com os monstros).
export async function restartDungeon(client: GladiatusClient, locId = 3): Promise<unknown> {
  log.info(`DUNGEON restart (Normal) loc=${locId}`);
  return client.postForm('/game/index.php', { mod: 'dungeon', loc: locId }, { dif1: 'Normal' });
}

// POST cancelDungeon (ver docs/endpoints.md). Volta pra página "Entre na masmorra".
// Não consome ponto. Usado quando só sobra boss e DUNGEON_SKIP_BOSS está ligado.
export async function cancelDungeon(client: GladiatusClient, locId: number, dungeonId: number): Promise<unknown> {
  log.info(`DUNGEON cancel loc=${locId} dungeonId=${dungeonId}`);
  return client.postForm(
    '/game/index.php',
    { mod: 'dungeon', loc: locId, action: 'cancelDungeon' },
    { dungeonId },
  );
}

export async function fetchDungeonState(client: GladiatusClient, locId = 3): Promise<{ html: string; fights: DungeonFight[]; needsRestart: boolean }> {
  const html = await client.getHtml('/game/index.php', { mod: 'dungeon', loc: locId });
  return {
    html,
    fights: parseDungeonFights(html),
    needsRestart: isDungeonEntryPage(html),
  };
}

export async function attackDungeon(client: GladiatusClient, state: BotSnapshot, locId = 3): Promise<{ acted: boolean; reason?: string; raw?: unknown; target?: DungeonFight }> {
  if (!isActionsEnabled()) {
    return { acted: false, reason: 'actions disabled' };
  }
  if ((state.dungeon.cooldownSec ?? 0) > 0) {
    return { acted: false, reason: `dungeon on cooldown ${state.dungeon.cooldownSec}s` };
  }
  if ((state.dungeon.points ?? 0) <= 0) {
    return { acted: false, reason: 'dungeon points exhausted' };
  }

  let { html, fights, needsRestart } = await fetchDungeonState(client, locId);

  // Se o boss caiu, primeiro entra numa nova masmorra (Normal), depois re-lê
  // o HTML pra pegar a lista de lutas atualizada e seguir no mesmo tick.
  if (needsRestart) {
    await restartDungeon(client, locId);
    ({ html, fights, needsRestart } = await fetchDungeonState(client, locId));
    if (needsRestart) {
      // Se ainda diz "Entre na masmorra", algo deu errado (ex: sem pontos).
      return { acted: false, reason: 'dungeon restart did not advance to fights page' };
    }
  }
  if (fights.length === 0) {
    return { acted: false, reason: 'no fights visible on dungeon page' };
  }

  // Skip boss: se só sobrou boss na masmorra, cancela e reinicia uma nova
  // (que vai ter monstros normais de novo). Sem isso, bot ficaria preso na
  // mesma masmorra eternamente, sem progredir os pontos.
  let eligible = config.dungeon.skipBoss ? fights.filter((f) => !f.isBoss) : fights;
  if (eligible.length === 0) {
    const dungeonId = parseDungeonId(html);
    if (dungeonId === null) {
      return { acted: false, reason: 'only boss available — could not parse dungeonId for cancel' };
    }
    log.warn(`DUNGEON only boss available — cancelling + restarting (DUNGEON_SKIP_BOSS)`);
    await cancelDungeon(client, locId, dungeonId);
    await restartDungeon(client, locId);
    ({ html, fights, needsRestart } = await fetchDungeonState(client, locId));
    if (needsRestart || fights.length === 0) {
      return { acted: false, reason: 'dungeon cancel+restart did not produce fights' };
    }
    eligible = config.dungeon.skipBoss ? fights.filter((f) => !f.isBoss) : fights;
    if (eligible.length === 0) {
      return { acted: false, reason: 'only boss available even after cancel+restart' };
    }
  }

  const target = eligible[0]!;
  log.info(`DUNGEON fight posi=${target.posi} did=${target.did}${target.isBoss ? ' (BOSS)' : ''}`);
  const text = await client.getAjax('/game/ajax/doDungeonFight.php', {
    did: target.did,
    posi: target.posi,
  });
  return { acted: true, raw: text, target };
}
