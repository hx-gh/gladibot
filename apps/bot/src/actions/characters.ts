import { parseCharSnapshot } from '../state.js';
import { log } from '../log.js';
import type { GladiatusClient } from '../client.js';

// Total de dolls do servidor BR62 Speed x5: 1 principal + espelho + 4 mercs = 6.
// Loop fixo varre 1..MAX_DOLLS; dolls inexistentes vêm sem nome/level e são
// filtrados pelo caller. Configurável via .env só se virar problema.
export const MAX_DOLLS = 6;

// Fetch HTML do overview para um doll específico. CRÍTICO: precisa noXhr=true
// (omite x-requested-with: XMLHttpRequest) — o servidor PHP do Gladiatus só
// honra ?doll=N como troca de doll quando vê uma navegação "real". Com o
// header XHR a página retorna sempre o doll=1, ignorando o param.
export async function fetchCharacter(client: GladiatusClient, doll: number): Promise<Record<string, unknown>> {
  const html = await client.fetchRawHtml(
    '/game/index.php',
    { mod: 'overview', doll },
    { noXhr: true },
  );
  const snap = parseCharSnapshot(html as string);
  // Em raros casos o servidor pode retornar a página default (doll=1) mesmo
  // com o param — proteção contra associar gear errado a um doll.
  if (snap.doll !== null && snap.doll !== doll) {
    log.warn(`fetchCharacter(${doll}) returned active=${String(snap.doll)} — ignoring`);
    return { doll, role: null, error: 'mismatch' };
  }
  return { ...snap, doll };
}

// Varre todos os dolls em paralelo. fetchRawHtml é HTTP-only (não navega a aba
// principal), então não há race com o tick. Erros isolados por doll não
// derrubam o resto.
export async function fetchAllCharacters(client: GladiatusClient): Promise<Record<string, unknown>[]> {
  const tasks: Promise<Record<string, unknown>>[] = [];
  for (let d = 1; d <= MAX_DOLLS; d++) {
    tasks.push(
      fetchCharacter(client, d).catch((e: Error) => {
        log.warn(`fetchCharacter(${d}) failed: ${e.message}`);
        return { doll: d, error: e.message };
      }),
    );
  }
  const all = await Promise.all(tasks);
  return all.filter((c) => c && (c['name'] || c['role']));
}
