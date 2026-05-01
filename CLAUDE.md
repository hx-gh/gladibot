# CLAUDE.md — gladibot

## Framework de Trabalho

Este projeto opera em modo **arquiteto + agentes**. Você fala com Claude (orquestrador); Claude despacha agentes especializados via Agent tool. **Use as skills abaixo — não improvise o ciclo.**

### Workflow obrigatório por tipo de tarefa

| Tipo de tarefa | Skill |
|---|---|
| Feature nova ou débito > 4h | `/implement <slug>` |
| Mudança manual já feita, sincronizar antes do commit | `/checkpoint` |
| Suspeita de drift entre código e docs/memória | `/audit-sync` |
| Review do diff da branch atual | `/review-pr` |

### Agentes ativos (`.claude/agents/`)

| Agente | Modelo | Responsabilidade |
|---|---|---|
| `tech-architect` | Opus | Plano técnico → `docs/wip/<slug>.md` |
| `bot-builder` | Sonnet | Implementa Node+Playwright+AJAX e (futuro) Next.js conforme plano |
| `code-reviewer` | Sonnet | Pré-commit DoD + regras arquiteturais 1-7 + security smells |
| `doc-keeper` | Haiku (escala em diff grande) | Sincroniza docs do repo + memórias Claude antes do commit |

### Regras invariantes do framework

1. **Nunca commitar sozinho.** Após `doc-keeper` rodar, apresentar diff e mensagem sugerida; usuário decide.
2. **Em conflito memória vs. repo, repo vence.** `docs/PROJECT_STATE.md` é fonte de verdade; memória atualiza para refletir.
3. **Agentes não criam docs novos** em `docs/`. Se demanda surgir, reportar ao usuário.
4. **Hook PostToolUse** loga em `docs/wip/.session-changes.log` (gitignored). Não tocar manualmente — `doc-keeper` consome e trunca.
5. **Sem `Co-Authored-By: Claude`** ou footer "Generated with Claude Code" em commits.
6. **Edições em bloco**: ao modificar um arquivo, aplicar todas as alterações de uma vez — nunca linha por linha.

### Prompt consolidado

`prompt.bot.md` no root é o **guia consolidado** que `bot-builder` e `code-reviewer` carregam. Concentra: stack, regras invariantes (1-7 abaixo), padrões de código, DoD, limites duros. Detalhe completo continua nos docs específicos (`CODE_PATTERNS.md`, `endpoints.md`, `flows.md`, `memory.md`).

---

## Visão Geral

**Nome**: `gladibot`
**Descrição**: Bot de automação para o jogo de navegador **Gladiatus** (BR62 Speed x5 hoje; alvo: todos os servidores). Foco inicial: drenar pontos de expedição e masmorra, curar quando necessário, mandar pra trabalho quando esgotar.

**Stack**: Node.js 18+ (ESM) + Playwright (msedge channel, persistent context) + AJAX HTTP direto. TypeScript, monorepo TurboRepo+pnpm e Next.js+Tailwind+shadcn estão na pista de migração — ver `docs/wip/framework-monorepo-migration.md`.

**Escopo atual**: 1 personagem, 1 servidor, 1 dev. **Roadmap:** monorepo + Next.js + multi-server + hosting BYOK (R$50/mês).

## Documentos de referência

> Leia antes de tarefas não-triviais. `docs/INDEX.md` é o ponto de entrada.

*Estado e processo:*
- `docs/INDEX.md` — índice navegável da documentação
- `docs/PROJECT_STATE.md` — snapshot vivo: o que está pronto, o que está pendente, próximas ações
- `docs/DECISIONS.md` — ADRs (DEC-01..)
- `docs/TECHNICAL_DEBT.md` — débitos abertos com IDs (DEBT-XX)
- `docs/CONTRIBUTING.md` — branch, commit, fluxo (versão 1-dev)
- `docs/DEVELOPMENT_WORKFLOW.md` — setup, debug, mapeamento de novos fluxos
- `docs/CODE_PATTERNS.md` — padrões reais observados no código

*Referência técnica do domínio (Gladiatus):*
- `docs/memory.md` — contexto histórico, descobertas, glossário
- `docs/flows.md` — fluxogramas dos loops de ação
- `docs/endpoints.md` — catálogo dos endpoints AJAX descobertos

## Arquitetura (resumo)

```
.env (BASE_URL, USER_DATA_DIR, headless?)   ← fica no root do repo
   │
   ▼
apps/bot/src/config.js   (carrega .env do root via path absoluto)
   │
   ▼
apps/bot/src/browser.js ──▶ Playwright (Edge persistent context)
       │                       ├─ login Google manual (1x)
       │                       └─ readSession() pega sh+csrf do DOM
       ▼
apps/bot/src/client.js ──▶ page.request.get/post ──▶ Gladiatus AJAX endpoints
       ▲                                              (cookies do browser)
       │
apps/bot/src/index.js ──▶ apps/bot/src/orchestrator.js ──▶ apps/bot/src/actions/{exp,dung,heal,work}.js
                                 ▲
                                 │ lê
                          apps/bot/src/state.js (parser de overview HTML + merge JSON)
```

### Estrutura de Diretórios

```
gladibot/                    ← monorepo root (pnpm workspaces + TurboRepo)
├── apps/
│   └── bot/                 ← pacote @gladibot/bot
│       ├── package.json
│       ├── src/             ← código do bot
│       │   ├── index.js          entry + flags --once / --loop
│       │   ├── config.js         carrega .env do root; define userDataDir absoluto
│       │   ├── log.js            logger leve
│       │   ├── browser.js        Playwright bootstrap + readSession + refreshSession
│       │   ├── client.js         HTTP client em cima de page.request, retry em 401/403
│       │   ├── state.js          parser de overview + merge AJAX
│       │   ├── orchestrator.js   tick: heal → expedição → masmorra → work
│       │   └── actions/
│       │       ├── expedition.js
│       │       ├── dungeon.js
│       │       ├── heal.js
│       │       └── work.js
│       └── data/
│           ├── affixes.json
│           └── formulas.json
├── packages/                ← pacotes compartilhados (futuro)
│   └── .gitkeep
├── docs/                    ← documentação versionada
│   ├── INDEX.md
│   ├── PROJECT_STATE.md
│   ├── DECISIONS.md
│   ├── TECHNICAL_DEBT.md
│   ├── CONTRIBUTING.md
│   ├── DEVELOPMENT_WORKFLOW.md
│   ├── CODE_PATTERNS.md
│   ├── memory.md         contexto histórico do domínio
│   ├── flows.md          fluxogramas
│   ├── endpoints.md      catálogo AJAX
│   └── wip/              scratchpads efêmeros (gitignored)
├── .claude/               ← integração com Claude Code
│   ├── settings.json         permissions + hook de session log
│   ├── settings.local.json   overrides locais (gitignored se necessário)
│   ├── commands/checkpoint.md
│   └── agents/doc-keeper.md
├── package.json           ← root workspace (turbo devDep, scripts delegam ao bot)
├── pnpm-workspace.yaml
├── turbo.json
└── browser-data/          ← perfil persistente do Playwright (gitignored, no root)
```

## Database

- Use Node's built-in `node:sqlite` module instead of `better-sqlite3` (native build issues on this system)

## HTTP Fetching

- For game site requests, use direct `curl` with required XHR headers (e.g., `X-Requested-With: XMLHttpRequest`) rather than naive query-param URLs like `?doll=N`. Avoid spawning sub-agents for repetitive HTML scraping — they tend to hang; prefer direct curl loops.

## Parser Iteration

- HTML from this game is malformed; write parser regex defensively and add unit tests for: tooltip-wrapped buffs, flat+pct stat consolidation, PT-BR↔EN suffix mapping, and level-based upgrade comparisons (e.g., lvl 65 vs lvl 32 ring).

## Debug Endpoints

- Never reuse the active browser tab for debug/probe endpoints — open in a new tab or use curl to avoid ERR_ABORTED crashes.

## Regras Arquiteturais Fundamentais

### 1. Playwright só pra sessão. Ações via AJAX
- `apps/bot/src/browser.js` cuida de login + extração de `sh+csrf`. Persistent context guarda cookies entre runs.
- `apps/bot/src/client.js` usa `page.request.get/post` — herda os cookies do browser, mas envia HTTP "puro". **Não** clica em botões via Playwright.
- **Por que:** velocidade (HTTP é instantâneo, click visual é lento) + simplicidade (DOM muda, endpoints AJAX são estáveis).

### 2. CSRF é obrigatório em todo AJAX
- Cabeçalho `x-csrf-token` em todas as requests AJAX. Sem ele → 403.
- Token rotaciona por sessão. `client.js` re-extrai automaticamente em 401/403 e retenta uma vez.

### 3. Login manual, sem auto-login
- Login Google é fora do escopo do bot. Usuário faz uma vez, browser-data persiste.
- Auto-login via OAuth seria fragilíssimo (captcha, 2FA, mudanças do Google). Não tentar.

### 4. Não simular cliques
- Quando um controle não tem ref de acessibilidade (ex: `<img onclick="startFight(...)">` na masmorra), descobrir o **endpoint AJAX real** via DevTools e chamá-lo direto.

### 5. Sem state local persistente do bot
- Estado canônico vem do servidor a cada tick (`GET overview` + parser). Bot é stateless entre ticks.
- Cooldowns, HP, pontos: sempre re-lidos. Nunca cachear.

### 6. Heal greedy "não extrapolar"
- Cura quando HP < `HEAL_THRESHOLD_PCT` (default 20%).
- Escolhe **maior** item onde `heal_nominal ≤ HP_max - HP_atual`. Se nenhum couber, usa o **menor** (overflow mínimo).

### 7. Loop com cooldowns independentes
- Expedição e masmorra têm cooldowns separados. A cada tick, dispara **tudo** que estiver pronto, depois dorme até o próximo cooldown ativo terminar.

## Padrões de Código

Ver `docs/CODE_PATTERNS.md`. Resumo:

- ESM (`import`/`export`), Node 18+ fetch quando aplicável.
- Sem `any` em estado/configs — objetos com shape conhecido.
- Logs estruturados: `debug` (HTTP), `info` (ações), `warn` (recuperáveis), `error` (fatais).
- **Proibido**: cachear `sh`/`csrf`/cookies em arquivos versionados; logar tokens completos.

## O que a IA PODE fazer

- Adicionar/modificar `apps/bot/src/actions/<nome>.js` para novos fluxos do jogo.
- Atualizar parsers em `apps/bot/src/state.js` quando o jogo expor novos campos.
- Adicionar slash commands em `.claude/commands/`.
- Editar docs (PROJECT_STATE, DECISIONS, TECHNICAL_DEBT, memory, flows, endpoints).
- Criar scratchpad em `docs/wip/<feature-slug>.md` durante exploração.

## O que a IA NÃO PODE fazer

- Criar arquivos `.env` ou commitar cookies/CSRF/credenciais.
- Trocar a estratégia de "AJAX direto" por "cliques via Playwright" sem aprovação explícita.
- Tentar implementar auto-login Google.
- Commitar ou fazer push sem instrução explícita do usuário.
- Mexer em `browser-data/` (perfil do browser).
- Hardcodar URLs/IDs específicos do servidor BR62 fora de `.env`/`config.js`.
- Criar memória que duplique conteúdo de `docs/` versionados — memórias só pra contexto/decisões/preferências.
- Adicionar `Co-Authored-By: Claude` ou footer "Generated with Claude Code" em commits (regra do framework adotado).

## Documentação Contínua (Definition of Done)

Resumo (detalhe em `docs/CONTRIBUTING.md`):

- **Durante exploração**: scratchpad em `docs/wip/<slug>.md` (gitignored).
- **Ao concluir feature**: atualizar `docs/PROJECT_STATE.md`.
- **Ao tomar decisão arquitetural**: registrar `DEC-XX` em `docs/DECISIONS.md`.
- **Ao identificar débito**: registrar `DEBT-XX` em `docs/TECHNICAL_DEBT.md`.
- **Ao mapear novo endpoint AJAX**: atualizar `docs/endpoints.md`.
- **Ao mudar fluxo do loop**: atualizar `docs/flows.md`.
- **Antes de commit**: rodar `/checkpoint` (sync repo + memória).
