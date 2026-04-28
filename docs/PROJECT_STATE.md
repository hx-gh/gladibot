---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Project State

Snapshot vivo. Atualizar ao concluir feature ou ao identificar mudança de prioridade.

## Stack

- Node.js 18+ (ESM, `"type": "module"`)
- Playwright 1.49 (channel `msedge`, persistent context)
- dotenv 16
- Sem lib de teste por enquanto (1 dev, MVP)

## Componentes

| Componente | Status | Notas |
|---|---|---|
| `src/browser.js` (Playwright bootstrap) | ✅ Pronto | Detecta login multi-aba; readSession navega overview pra extrair `sh`+`csrf` (meta tag) |
| `src/client.js` (HTTP + retry em 401/403) | ✅ Pronto | `getHtml` via `page.goto` (JS roda); auto-refresh CSRF |
| `src/state.js` (parser overview) | ✅ Pronto | Parser por IDs específicos (gold/HP/pontos/cooldowns/inventário) — validado em produção |
| `src/actions/heal.js` | ✅ Pronto | Greedy "não extrapolar" |
| `src/actions/expedition.js` | ✅ Pronto | `mod=location&submod=attack` |
| `src/actions/dungeon.js` | ✅ Pronto | `startFight` por AJAX + `restartDungeon` (POST `dif1=Normal`) quando boss cai |
| `src/actions/work.js` | ✅ Pronto | POST `index.php?mod=work&submod=start` (`jobType`+`timeToWork`) |
| `src/orchestrator.js` (tick loop) | ✅ Pronto | Heal → exp → masm → work fallback |
| `gladibot-bridge.user.js` (Tampermonkey) | ✅ Pronto | Para mapeamento via MCP, não runtime |

## Features

### Completas

| Feature | Data |
|---|---|
| Bridge userscript (heals + dungeon fights) | 2026-04-28 |
| Captura de endpoints: heal, dungeon fight, expedition attack | 2026-04-28 |
| Bot Node.js base (Playwright + AJAX) | 2026-04-28 |
| Lobby flow (entrada via lobby.gladiatus, multi-aba) | 2026-04-28 |
| Parser de overview por IDs (HP, ouro, pontos, cooldowns, inventário) | 2026-04-28 |
| Validação end-to-end no WSL (chromium + WSLg) | 2026-04-28 |
| `actions/work.js` real (DEBT-01 fechado) | 2026-04-28 |
| `actions/dungeon.js` auto-restart (DEBT-02 fechado) | 2026-04-28 |
| Heal pré + pós-luta no orchestrator | 2026-04-28 |

### Em andamento

_(nenhuma)_

### Pendentes

| Feature | Bloqueio |
|---|---|
| Refresh de sessão automático | Não-MVP. Ver DEBT-03 |
| Dashboard de monitoramento | Backlog. Ver DEBT-04 |

## Próximas Ações Sugeridas

1. **Validar end-to-end no jogo** — `node src/index.js --once` cobrindo:
   - heal disparando com HP < 20% (start do bot e pós-luta);
   - dungeon entrando automaticamente após boss cair (POST `dif1=Normal`);
   - work iniciando com `jobType=2` quando ambos os pools zeram.
2. **Ligar `--loop`** depois de confirmar que cada um dos três cenários acima passa.

## Métricas observadas (sessão 2026-04-28)

- Ouro/expedição (Lobo Sanguinário, level 41): ~1.500 ouro/luta
- Ouro/expedição (Escaravelho Gigante, level 41-42): ~2.500 ouro/luta
- Tick (expedição+masmorra simultâneos): **+3.827 ouro** validado em produção
- HP máx atual: **2.736** (level 50, +25 vs level 49 anterior)
- Regen: 3.294/h
- Cooldown por ataque: ~60s real (independente entre slots; Speed x5 não acelera)
