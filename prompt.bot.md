---
tags: [prompt, bot, builder, reviewer]
date: 2026-05-01
---

# prompt.bot — Regras vigentes para builder e reviewer

> Guia consolidado consumido pelos agentes `bot-builder` e `code-reviewer`. Não duplica `CLAUDE.md`, `docs/CODE_PATTERNS.md`, `docs/memory.md`, `docs/flows.md` ou `docs/endpoints.md` — referencia. Carregar quando começar trabalho de código.

---

## Stack

- Node.js 18+ (ESM, `"type": "module"`)
- Playwright 1.49 (channel `msedge`, persistent context em `browser-data/`)
- Express (UI atual `apps/bot/src/ui/server.js`; será trocado por Next.js em PR futuro)
- TypeScript será adicionado no PR `refactor/bot-typescript` — até lá, JS puro com `// @ts-check` opcional
- node:sqlite (built-in) para persistência local — **não** `better-sqlite3` (build native quebra neste host)

## Arquitetura — referência rápida

```
.env (root do repo) → apps/bot/src/config.js
                                │
                                ▼
              apps/bot/src/browser.js ──▶ Playwright (Edge persistent context)
                              │             ├─ login Google manual (1x)
                              │             └─ readSession() pega sh+csrf do DOM
                              ▼
              apps/bot/src/client.js ──▶ page.request.get/post ──▶ Gladiatus AJAX
                              ▲                                      (cookies do browser)
                              │
apps/bot/src/index.js ──▶ apps/bot/src/orchestrator.js ──▶ apps/bot/src/actions/{exp,dung,heal,work,...}.js
                                   ▲
                                   │ lê
                            apps/bot/src/state.js (parser de overview HTML + merge JSON)
```

Detalhe completo em `CLAUDE.md` § Arquitetura. Componente por componente em `docs/PROJECT_STATE.md`.

---

## Regras invariantes (CLAUDE.md condensado)

1. **Playwright só pra sessão. Ações via AJAX direto** (`client.get`/`client.post`, herdam cookies). Nunca clicar em botão via Playwright.
2. **CSRF obrigatório:** todo POST AJAX leva `x-csrf-token`. Sem ele → 403. `client.js` re-extrai e retenta uma vez em 401/403.
3. **Login Google é manual.** Não tentar auto-login.
4. **Não simular cliques.** Se um controle não tem ref de acessibilidade (ex: `<img onclick="startFight(...)">`), descobrir o endpoint AJAX real via DevTools.
5. **Sem state local persistente entre ticks.** Estado canônico vem do servidor. Cooldowns/HP/pontos: re-lidos sempre.
6. **Heal greedy "não extrapolar":** `HP < HEAL_THRESHOLD_PCT` → maior item onde `heal_nominal ≤ HP_max - HP_atual`. Sem nenhum couber, menor (overflow mínimo).
7. **Cooldowns independentes:** exp e masm cada um seu. Tick dispara tudo que estiver pronto, dorme até o próximo cooldown.

Mudar qualquer dessas regras exige `DEC-XX` aprovado em `docs/DECISIONS.md` **antes** do código.

---

## Padrões de código (resumo de `docs/CODE_PATTERNS.md`)

### HTTP

- Toda chamada AJAX via `client.get(url)` ou `client.post(url, body)` — **não** `fetch` direto.
- Retry de 401/403 é automático no client. Não duplicar lógica em actions.
- Para HTML cru fora do tick principal (ex: capturar listagem em UI): usar `fetchRawHtml(client, url)`. **Não** `client.getHtml` em check secundário concorrente — causa `ERR_ABORTED` na aba ativa.

### Parser de HTML

- HTML do jogo é malformado. Regex sempre defensivo: `?` para opcionais, `*` para variações, fallback `|| null` ou `|| ''`.
- Validação empírica: salvar HTML cru em `docs/wip/<feature>.html` durante mapeamento. Não commitar (gitignored).
- Casos a cobrir: tooltip-wrapped buffs, flat+pct stat consolidation, PT-BR↔EN suffix mapping, level-based comparisons.

### Actions (side-effects no jogo)

Toda action que faz `client.post` com side-effect no servidor (gold, pontos, cooldown, equipamento) **deve** começar com:

```javascript
import { isActionsEnabled } from '../botState.js';

export async function placeBid(client, listing) {
  if (!isActionsEnabled()) {
    log.warn('placeBid bloqueado pelo kill switch');
    return null;
  }
  // ... resto
}
```

Sem essa checagem, ação pode disparar quando UI tiver pausado o bot.

### Logging

- `log.debug` — HTTP, retry, parser interno
- `log.info` — actions concluídas, transições de estado do tick
- `log.warn` — recuperáveis (bid recusado, sessão refresh)
- `log.error` — fatais (sessionExpired, parser quebrou)

**Nunca** `console.log` em código de produção. **Nunca** logar tokens completos — `sh`/`csrf` só primeiros 6 chars + `...`.

### Comentários

- Default: zero. Identificadores bem-nomeados já dizem WHAT.
- Adicionar só se WHY é não-óbvio: workaround pra bug específico, invariante escondida, decisão contraintuitiva.
- Nunca explicar o código línea por línea. Nunca referenciar tarefa/PR no código.

---

## Onde plugar coisa nova

| Tipo | Lugar |
|---|---|
| Novo endpoint AJAX | Captar via DevTools → catalogar em `docs/endpoints.md` → implementar action |
| Nova action | `apps/bot/src/actions/<nome>.js` |
| Novo ramo no tick | `apps/bot/src/orchestrator.js` — respeitar ordem heal → exp → masm → work → afk fallback |
| Novo campo do snapshot | `apps/bot/src/state.js` parser + `apps/bot/src/botState.js` shape |
| Nova UI | hoje `apps/bot/src/ui/server.js` + `public/`; futuro `apps/web/src/app/` (Next.js App Router) |
| Catálogo (afixos, fórmulas) | `apps/bot/data/<nome>.json` + validar empiricamente contra HTML real |

---

## DoD (Definition of Done)

Antes de declarar tarefa pronta:

1. **Smoke:** `pnpm tick` (do root) ou `pnpm --filter @gladibot/bot tick` sem erro fatal.
2. **Type-check** (quando TS instalado): `pnpm --filter bot typecheck`.
3. **Build web** (quando `apps/web` existir): `pnpm --filter web build`.
4. **Validate docs:** `bash docs/validate-docs.sh` → 0 erros.
5. **Doc trail:**
   - Endpoint novo → `docs/endpoints.md`
   - Mudança de tick → `docs/flows.md`
   - Decisão arquitetural → `docs/DECISIONS.md` (`DEC-XX`)
   - Débito → `docs/TECHNICAL_DEBT.md` (`DEBT-XX`)
   - Feature pronta → `docs/PROJECT_STATE.md`

**Iteração autônoma:** se gate falhar, diagnostique pelo output, corrija, rode de novo. Pause após 3 tentativas consecutivas com o mesmo erro.

---

## Limites duros (CLAUDE.md § O que NÃO PODE)

- Criar `.env` ou commitar cookies/CSRF/credenciais.
- Trocar "AJAX direto" por "cliques via Playwright" sem `DEC-XX`.
- Auto-login Google.
- Commitar/push sem instrução explícita.
- Mexer em `browser-data/`.
- Hardcode de URLs/IDs do servidor BR62 fora de `.env`/`config.js`.
- Memória que duplica conteúdo de `docs/` versionados.
- Adicionar `Co-Authored-By: Claude` ou footer "Generated with Claude Code" em commits.
