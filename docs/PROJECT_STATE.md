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
| `src/browser.js` (Playwright bootstrap) | ✅ Pronto | Detecta login, extrai `sh`+`csrf` |
| `src/client.js` (HTTP + retry em 401/403) | ✅ Pronto | Auto-refresh CSRF |
| `src/state.js` (parser overview) | ✅ Pronto | Parser HTML + merge JSON AJAX |
| `src/actions/heal.js` | ✅ Pronto | Greedy "não extrapolar" |
| `src/actions/expedition.js` | ✅ Pronto | `mod=location&submod=attack` |
| `src/actions/dungeon.js` | ✅ Pronto (parcial) | Stub para "iniciar nova" quando boss cai |
| `src/actions/work.js` | 🟠 Stub | Endpoint não capturado |
| `src/orchestrator.js` (tick loop) | ✅ Pronto | Heal → exp → masm → work fallback |
| `gladibot-bridge.user.js` (Tampermonkey) | ✅ Pronto | Para mapeamento via MCP, não runtime |

## Features

### Completas

| Feature | Data |
|---|---|
| Bridge userscript (heals + dungeon fights) | 2026-04-28 |
| Captura de endpoints: heal, dungeon fight, expedition attack | 2026-04-28 |
| Bot Node.js base (Playwright + AJAX) | 2026-04-28 |

### Em andamento

_(nenhuma)_

### Pendentes

| Feature | Bloqueio |
|---|---|
| `actions/work.js` real | Aguarda captura do cURL "Ir!" do trabalho ([[TECHNICAL_DEBT]] DEBT-01) |
| `actions/dungeon.js` auto-restart | Aguarda captura do cURL "Normal" da masmorra ([[TECHNICAL_DEBT]] DEBT-02) |
| Refresh de sessão automático | Não-MVP. Ver DEBT-03 |
| Dashboard de monitoramento | Backlog. Ver DEBT-04 |

## Próximas Ações Sugeridas

1. **Capturar cURLs pendentes** (DEBT-01 + DEBT-02) — usuário com DevTools, próxima vez que clicar "Ir!" e "Normal".
2. **Plugar work.js real** após captura.
3. **Plugar dungeon-restart** após captura.
4. **Validar end-to-end** com `node src/index.js --once` antes de ativar `--loop`.

## Métricas observadas (sessão 2026-04-28)

- Ouro/expedição (Lobo Sanguinário, level 41): ~1.500 ouro/luta
- Ouro/expedição (Escaravelho Gigante, level 41): ~2.500 ouro/luta
- HP máx atual: 2.711, regen 3.264/h
- Cooldown por ataque: ~60s real (Speed x5 não acelera cooldown de ataque)
