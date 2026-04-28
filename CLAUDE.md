# CLAUDE.md — gladibot

## Visão Geral

**Nome**: `gladibot`
**Descrição**: Bot de automação para o jogo de navegador **Gladiatus** (servidor BR62 Speed x5). Foco inicial: drenar pontos de expedição e masmorra, curar quando necessário, mandar pra trabalho quando esgotar.

**Stack**: Node.js 18+ (ESM) + Playwright (msedge channel, persistent context) + AJAX HTTP direto.

**Escopo**: 1 personagem, 1 servidor, 1 dev. Single-package — não é monorepo, não tem backend/frontend split, nem migrations/CI/CD.

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
.env (BASE_URL, USER_DATA_DIR, headless?)
   │
   ▼
src/config.js
   │
   ▼
src/browser.js ──▶ Playwright (Edge persistent context)
       │             ├─ login Google manual (1x)
       │             └─ readSession() pega sh+csrf do DOM
       ▼
src/client.js ──▶ page.request.get/post ──▶ Gladiatus AJAX endpoints
       ▲                                     (cookies do browser)
       │
src/index.js ──▶ src/orchestrator.js ──▶ src/actions/{exp,dung,heal,work}.js
                       ▲
                       │ lê
                  src/state.js (parser de overview HTML + merge JSON)
```

### Estrutura de Diretórios

```
gladibot/
├── src/             ← código do bot
│   ├── index.js          entry + flags --once / --loop
│   ├── config.js         carrega .env
│   ├── log.js            logger leve
│   ├── browser.js        Playwright bootstrap + readSession + refreshSession
│   ├── client.js         HTTP client em cima de page.request, retry em 401/403
│   ├── state.js          parser de overview + merge AJAX
│   ├── orchestrator.js   tick: heal → expedição → masmorra → work
│   └── actions/
│       ├── expedition.js
│       ├── dungeon.js
│       ├── heal.js
│       └── work.js
├── docs/            ← documentação versionada
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
├── .claude/         ← integração com Claude Code
│   ├── settings.json     permissions + hook de session log
│   ├── settings.local.json   overrides locais (gitignored se necessário)
│   ├── commands/checkpoint.md
│   └── agents/doc-keeper.md
└── browser-data/    ← perfil persistente do Playwright (gitignored)
```

## Regras Arquiteturais Fundamentais

### 1. Playwright só pra sessão. Ações via AJAX
- `src/browser.js` cuida de login + extração de `sh+csrf`. Persistent context guarda cookies entre runs.
- `src/client.js` usa `page.request.get/post` — herda os cookies do browser, mas envia HTTP "puro". **Não** clica em botões via Playwright.
- **Por que:** velocidade (HTTP é instantâneo, click visual é lento) + simplicidade (DOM muda, endpoints AJAX são estáveis).

### 2. CSRF é obrigatório em todo AJAX
- Cabeçalho `x-csrf-token` em todas as requests AJAX. Sem ele → 403.
- Token rotaciona por sessão. `client.js` re-extrai automaticamente em 401/403 e retenta uma vez.

### 3. Login manual, sem auto-login
- Login Google é fora do escopo do bot. Usuário faz uma vez, browser-data persiste.
- Auto-login via OAuth seria fragilíssimo (captcha, 2FA, mudanças do Google). Não tentar.

### 4. Não simular cliques
- Quando um controle não tem ref de acessibilidade (ex: `<img onclick="startFight(...)">` na masmorra), descobrir o **endpoint AJAX real** via DevTools e chamá-lo direto.
- O `gladibot-bridge.user.js` (Tampermonkey userscript) **só serve pra mapeamento via Claude+browsermcp** durante desenvolvimento — não é parte do bot em runtime.

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

- Adicionar/modificar `src/actions/<nome>.js` para novos fluxos do jogo.
- Atualizar parsers em `src/state.js` quando o jogo expor novos campos.
- Adicionar slash commands em `.claude/commands/`.
- Editar docs (PROJECT_STATE, DECISIONS, TECHNICAL_DEBT, memory, flows, endpoints).
- Criar scratchpad em `docs/wip/<feature-slug>.md` durante exploração.
- Estender `gladibot-bridge.user.js` para expor novos controles invisíveis.

## O que a IA NÃO PODE fazer

- Criar arquivos `.env` ou commitar cookies/CSRF/credenciais.
- Trocar a estratégia de "AJAX direto" por "cliques via Playwright" sem aprovação explícita.
- Tentar implementar auto-login Google.
- Commitar ou fazer push sem instrução explícita do usuário.
- Mexer em `browser-data/` (perfil do browser).
- Hardcodar URLs/IDs específicos do servidor BR62 fora de `.env`/`config.js`.
- Criar memória que duplique conteúdo de `docs/` versionados — memórias só pra contexto/decisões/preferências.

## Documentação Contínua (Definition of Done)

Resumo (detalhe em `docs/CONTRIBUTING.md`):

- **Durante exploração**: scratchpad em `docs/wip/<slug>.md` (gitignored).
- **Ao concluir feature**: atualizar `docs/PROJECT_STATE.md`.
- **Ao tomar decisão arquitetural**: registrar `DEC-XX` em `docs/DECISIONS.md`.
- **Ao identificar débito**: registrar `DEBT-XX` em `docs/TECHNICAL_DEBT.md`.
- **Ao mapear novo endpoint AJAX**: atualizar `docs/endpoints.md`.
- **Ao mudar fluxo do loop**: atualizar `docs/flows.md`.
- **Antes de commit**: rodar `/checkpoint` (sync repo + memória).
