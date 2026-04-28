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
npm install
# (postinstall já baixa o channel do Playwright)
cp .env.example .env
# o .env padrão funciona; ajuste só BASE_URL se mudar de servidor
```

## Primeira run (login)

```bash
node src/index.js --once
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
node src/index.js --once          # uma iteração só (debug/teste)
node src/index.js --loop          # loop infinito até Ctrl+C
node src/index.js --loop --yes    # pula o prompt de confirmação (pra automação real)
```

Quando confiar que tá estável, ligue **headless mode** no `.env`:

```
HEADLESS=true
```

Aí o bot roda invisível em background.

## Debugging

```bash
node --inspect src/index.js --once
```

Abre `edge://inspect` no seu Edge → "inspect" → DevTools completo do Node (breakpoints, Network, Console, etc).

## Estrutura

```
src/
  index.js          entry, parseia flags, orquestra
  config.js         carrega .env
  log.js            logger leve
  browser.js        Playwright bootstrap + readSession + refreshSession
  client.js         HTTP client em cima de page.request, com retry em 401/403
  state.js          parser de overview HTML + merge com JSON AJAX
  orchestrator.js   tick: heal → expedição → masmorra → work
  actions/
    expedition.js   POST /game/ajax.php?mod=location&submod=attack
    dungeon.js      parse fights + GET /game/ajax/doDungeonFight.php
    heal.js         POST /game/ajax.php?mod=inventory&submod=move
    work.js         (stub — endpoint pendente)
docs/
  memory.md         contexto histórico
  flows.md          fluxogramas
  endpoints.md      catálogo das rotas AJAX
```

## Limitações conscientes

1. **Endpoint do "Iniciar trabalho"** ainda não capturado → `work.js` é stub. Loop fica idle quando ambos os pontos zeram.
2. **Endpoint do "Normal" (reiniciar masmorra)** idem → quando o boss morre, o bot pula o ciclo de masmorra.
3. **Login Google** ainda é manual (uma vez). Auto-login não tá no escopo.

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
3. Atualiza `docs/endpoints.md` + adiciona `src/actions/<feature>.js`
4. Plugar no `orchestrator.js` se for parte do loop
5. `/checkpoint` antes do commit (sync docs + memória)
