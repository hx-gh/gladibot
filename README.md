# Gladibot

Bot de automação para Gladiatus (servidor BR62 Speed x5). Roda no seu PC com Node.js + Playwright: o **Playwright só cuida da sessão** (login Google e cookies persistentes); as **ações do jogo são chamadas direto via AJAX** (rápido, sem simulação de cliques).

## Como funciona

```
┌──────────────────────────────────────────────┐
│  Playwright (Edge persistent context)        │
│  ┌────────────────────────────────────────┐  │
│  │  Login Google manual (1 vez)           │  │
│  │  Cookies + perfil ficam salvos em      │  │
│  │  ./browser-data                        │  │
│  └────────────────────────────────────────┘  │
│                  │                           │
│                  ▼                           │
│  page.request.get/post (HTTP usando os       │
│  cookies da sessão real do browser)          │
└──────────────────────────────────────────────┘
                   │
                   ▼
       Gladiatus AJAX endpoints
       (heal, fight, work, ...)
```

Loop por iteração:

1. `GET overview` → parse HP, pontos, cooldowns
2. Se HP < 20% → escolhe item de cura ótimo (greedy, sem extrapolar) → `POST inventory/move`
3. Se cooldown expedição livre + pontos > 0 → `GET location/attack`
4. Se cooldown masmorra livre + pontos > 0 → `GET doDungeonFight`
5. Se ambos os pontos = 0 → `POST work` (Rapaz do Estábulo)
6. Sleep até o próximo cooldown ativo terminar
7. Repete

Em 401/403 (CSRF rotacionado), o bot **re-navega pra overview, extrai novo `sh`+`csrf` e tenta de novo automaticamente**. Sessão expirada de verdade → mensagem clara, exit 2.

## Pré-requisitos

- **Node 18+**
- **Microsoft Edge** ou Chrome instalado (o canal padrão é `msedge`)
- Conta no Gladiatus já existente (login Google é o método)

## Setup

```bash
cd projetos/gladibot
pnpm install
# (postinstall já baixa o channel do Playwright)
cp .env.example .env
# o .env padrão funciona; ajuste só BASE_URL se mudar de servidor
```

## Primeira run (login)

```bash
pnpm tick
```

Vai abrir o Edge **na lobby do Gladiatus** (`lobby.gladiatus.gameforge.com`).

1. **Faça login com Google** manualmente na janela aberta.
2. **Selecione o servidor configurado** (BR62 por padrão, conforme `BASE_URL` do `.env`).
3. Quando você entrar no jogo (URL chega em `s62-br...gladiatus.../game/index.php`), o bot detecta sozinho.
4. O bot **pausa no terminal** com `Pressione Enter para iniciar...`. Quando estiver pronto, dá Enter.
5. Bot roda 1 tick (modo `--once`) ou inicia o loop (`--loop`).

O perfil fica salvo em `./browser-data/` — próximas runs já abrem logadas, mas ainda passam pela lobby (pra você selecionar o servidor) e ainda esperam Enter.

## Runs subsequentes

```bash
pnpm tick           # uma iteração só (debug/teste)
pnpm loop           # loop infinito até Ctrl+C, sobe UI em http://localhost:3000
```

Flags do bot passadas diretamente via `--filter` + `--`:

```bash
pnpm --filter @gladibot/bot tick -- --yes      # pula prompt de confirmação
pnpm --filter @gladibot/bot tick -- --no-ui    # tick sem control panel
```

### Control panel (UI)

Em `--loop`, o bot sobe um servidor Express em `127.0.0.1:3000` e abre o browser default automaticamente. A UI mostra:

- **Status** — HP/Ouro/Rubis/Level/XP, pontos de expedição/masmorra com barras + cooldowns, contagem de comida.
- **Loop** — estado (running/paused/ticking), última tick, duração, contagem total, próxima tick.
- **Logs** — últimas 200 linhas (ring buffer in-memory) com filtro por nível e autoscroll.
- **Controles** — `Tick now` força tick imediato; `Pause` interrompe o agendamento sem derrubar o browser do jogo; `Resume` retoma.

Configurável via `.env`: `UI_PORT`, `UI_AUTO_OPEN`, `UI_ENABLED`. Logs também são escritos em `apps/bot/logs/session.log` (truncado a cada startup, gitignored).

Quando confiar que tá estável, ligue **headless mode** no `.env`:

```
HEADLESS=true
```

Aí o bot roda invisível em background.

## Debugging

```bash
cd apps/bot && node --inspect src/index.js --once
# ou via script do workspace:
# pnpm --filter @gladibot/bot tick -- --yes
```

Abre `edge://inspect` no seu Edge → "inspect" → DevTools completo do Node (breakpoints, Network, Console, etc).

## Estrutura

```
apps/bot/
  src/
    index.js          entry, parseia flags, orquestra
    config.js         carrega .env do root do repo via path absoluto
    log.js            logger (console + ring buffer + apps/bot/logs/session.log)
    botState.js       singleton in-memory: snapshot, loopStatus, logs (ring 200)
    browser.js        Playwright bootstrap + readSession + refreshSession
    client.js         HTTP client em cima de page.request, com retry em 401/403
    state.js          parser de overview HTML + merge com JSON AJAX
    orchestrator.js   tick: heal → expedição → masmorra → work
    actions/
      expedition.js   POST /game/ajax.php?mod=location&submod=attack
      dungeon.js      parse fights + GET /game/ajax/doDungeonFight.php
      heal.js         POST /game/ajax.php?mod=inventory&submod=move
      work.js         POST /game/index.php?mod=work&submod=start
    ui/
      server.js       Express, endpoints /api/state /logs /tick /pause /resume
      public/         index.html + styles.css + app.js (vanilla, polling 2s)
  data/
    affixes.json      catálogo de afixos
    formulas.json     catálogo de fórmulas
docs/
  memory.md           contexto histórico
  flows.md            fluxogramas
  endpoints.md        catálogo das rotas AJAX
```

## Limitações conscientes

1. **Login Google** é manual (1 vez, depois cookies persistem). Auto-login não tá no escopo.
2. **Refresh de sessão expirada** pede intervenção manual depois que o cookie de login morre (ver `DEBT-03`).
3. **UI sem auth** — bind em `127.0.0.1` só. Não exponha pra rede sem mexer nisso.

## Documentação

Ponto de entrada: **[`docs/INDEX.md`](docs/INDEX.md)**.

| Pra que | Onde |
|---|---|
| Estado atual + próximas ações | `docs/PROJECT_STATE.md` |
| Decisões arquiteturais (ADRs) | `docs/DECISIONS.md` |
| Débitos técnicos abertos | `docs/TECHNICAL_DEBT.md` |
| Padrões de código | `docs/CODE_PATTERNS.md` |
| Setup, debug, mapear fluxos | `docs/DEVELOPMENT_WORKFLOW.md` |
| Branch, commit, DoD | `docs/CONTRIBUTING.md` |
| Endpoints AJAX descobertos | `docs/endpoints.md` |
| Fluxogramas dos loops | `docs/flows.md` |
| Contexto histórico, glossário | `docs/memory.md` |

Regras pro agente Claude: **[`CLAUDE.md`](CLAUDE.md)**.

## Como mapear novos fluxos

Detalhe em `docs/DEVELOPMENT_WORKFLOW.md`. TL;DR:

1. Abre Claude Code com browsermcp na aba do Gladiatus
2. Captura cURL via DevTools no fluxo manual
3. Atualiza `docs/endpoints.md` + adiciona `apps/bot/src/actions/<feature>.js`
4. Plugar no `apps/bot/src/orchestrator.js` se for parte do loop
5. `/checkpoint` antes do commit (sync docs + memória)
