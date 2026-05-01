---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Code Patterns

> Padrões reais observados no código. Não inventar — referenciar este doc ao adicionar código novo.

## Geral

- **ESM**: `"type": "module"` no `package.json`. `import`/`export` em todos os arquivos.
- **Node 18+**: usa `URL`, `URLSearchParams`, `setTimeout` nativos.
- **Sem any**: objetos com shape conhecido (parsers retornam shape descrito em comentário).
- **Imports relativos**: `'./config.js'`, `'../client.js'` — sem aliases TS.
- **Sem default exports** — `export const`/`export function`/`export class`.

## Logging

- Logger leve em `apps/bot/src/log.js`. Níveis: `debug | info | warn | error`.
- Threshold via `LOG_LEVEL` no `.env`.

```js
import { log } from './log.js';

log.debug('HTTP', method, url);          // ruído de baixo nível
log.info('TICK', summarizeState(state)); // marcos do loop
log.warn('HTTP 403 — refreshing');       // recuperáveis
log.error('fatal:', e?.stack || e);      // saídas
```

## Configuração

- `apps/bot/src/config.js` carrega `.env` do root do repo via path absoluto (dotenv), valida ausentes, expõe objeto tipado por convenção.
- **Nunca** ler `process.env.X` direto fora de `config.js`.

```js
import { config } from './config.js';
const { baseUrl, expedition } = config;
```

## HTTP client

- `apps/bot/src/client.js` encapsula `page.request` do Playwright.
- Métodos: `getHtml`, `getAjax`, `postForm`. Cada um seta o `accept` correto.
- `_exec` faz retry automático em 401/403 chamando `refreshSession`.
- **Sempre** passar `params` via `buildUrl`, nunca concatenar string.

```js
// ✅
const text = await client.getAjax('/game/ajax.php', {
  mod: 'location', submod: 'attack', location: 2, stage: 2, premium: 0,
});

// ❌
const text = await client.getAjax(`/game/ajax.php?mod=location&submod=attack&location=2&stage=2`);
```

## Actions

Cada arquivo em `apps/bot/src/actions/` exporta funções com a assinatura:

```js
export async function actionName(client, state, ...optional) {
  // 1. Pre-check (cooldown, pontos, HP)
  if (!canAct(state)) return { acted: false, reason: '...' };

  // 2. Side-effect (HTTP via client)
  const res = await client.<getAjax|postForm>(...);

  // 3. Return shape mínimo
  return { acted: true, raw: res, ...extra };
}
```

- **Retorno padrão**: `{ acted: boolean, reason?: string, ...extra }`.
- **Não muta `state`**: retorna info; orchestrator decide se re-fetcha.
- **Não loga decisões**: o orchestrator/caller loga.

## Parser de estado

`apps/bot/src/state.js#parseOverview(html)` retorna shape:

```js
{
  gold, rubies, hpPercent,
  hp: { value, max } | null,
  expedition: { points, max, cooldownSec },
  dungeon:    { points, max, cooldownSec },
  arena:      { cooldownSec },
  grouparena: { cooldownSec },
  inventoryFood: [{ itemId, from, fromX, fromY, name, healNominal }],
}
```

- Campos não encontrados → `null` (não chutar).
- `mergeAjaxResponse(state, json)`: merge defensivo com response do servidor — usa `header.health.value/maxValue` como verdade.

## Erros e retry

- 401/403 do servidor → `client._exec` tenta `refreshSession` 1x. Se persistir, `throw SessionExpiredError`.
- Outros erros HTTP (4xx/5xx) → `throw Error(...)` com snippet do body.
- `index.js` captura `SessionExpiredError` separadamente: `process.exitCode = 2` (vs 1 pra outros).

## Testes

- _Não há suite formal por enquanto (1 dev, MVP)._
- Sanity check: `pnpm tick` (do root) antes de commit.
- Em mudanças de parser, escrever script ad-hoc em `docs/wip/` que carrega um HTML salvo e roda `parseOverview`.

## TypeScript / tsx (PR 3 em diante)

- **Runtime**: `tsx` (não `tsc --emit`, não `node --strip-types`). Scripts: `pnpm tick` / `pnpm loop` via `tsx src/index.ts`.
- **Imports literais**: manter `.js` no import string mesmo que o source seja `.ts`. `tsx` + `NodeNext` resolvem `.js → .ts` automaticamente. **Nunca mudar para `.ts`** no import — quebra a compatibilidade de ferramentas que esperam ESM puro.

```ts
// correto
import { log } from './log.js';
import { GladiatusClient } from './client.js';

// errado
import { log } from './log.ts';  // NOT this
```

- **`import type` na boundary shared/bot**: tipos do `@gladibot/shared` são type-only. Use sempre `import type`.

```ts
import type { BotSnapshot, WorkStatus } from '@gladibot/shared';
// NUNCA: import { BotSnapshot } from '@gladibot/shared'; // runtime error
```

- **Sem build step**: `noEmit: true` é invariante. Nenhum `dist/` — preserva DEC-30 (CWD relativo em `db.ts`, `log.ts`, `formulas.ts`).
- **`packages/shared` type-only**: qualquer `import` de valor (não `import type`) do shared quebra em runtime. `main` aponta para `./src/index.js` que não existe — só tipos são consumidos.
- **`strict: true` global**: sem `@ts-ignore` — usar `// eslint-disable-next-line @typescript-eslint/no-explicit-any` com comentário justificativo quando `any` é inevitável (ex: boundary com código legado sem tipos, `node:sqlite` rows, `mercSuggestions.ts` Char vs CharacterRow).
- **Gate obrigatório**: `pnpm typecheck` (turbo, shared antes do bot) — 0 erros antes de qualquer commit.

## Anti-padrões observados (do que NÃO fazer)

- ❌ **Cachear `sh` ou `csrf` em arquivo** — sempre re-extrair via `browser.js#readSession`.
- ❌ **`fetch` direto** dentro de actions/state — sempre via `client`. Cookies não chegariam.
- ❌ **Esperar tempo fixo** (`setTimeout(60000)`) — usar `state.cooldownSec` do servidor.
- ❌ **Side-effects no parser** — `state.js` é puro: HTML → objeto.
- ❌ **Lógica de jogo no client.js** — client é HTTP; decisão é no orchestrator/actions.
