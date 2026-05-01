---
tags: [index, moc]
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Índice de Documentação

> Ponto de entrada do vault. Bot de automação para Gladiatus (BR62 Speed x5).

---

## Estado Atual do Projeto

→ [[PROJECT_STATE]] — snapshot vivo: features prontas, pendentes, próximas ações

---

## Arquitetura e Padrões

| Documento | O que contém |
|---|---|
| [[../CLAUDE]] | Regras globais para o agente: arquitetura, "PODE/NÃO PODE", refs |
| [[CODE_PATTERNS]] | Padrões reais observados no código (HTTP client, parser, actions) |
| [[DECISIONS]] | Registro de decisões arquiteturais (DEC-XX) |

---

## Domínio do Jogo (Gladiatus)

| Documento | O que contém |
|---|---|
| [[memory]] | Contexto histórico, descobertas do projeto, glossário |
| [[flows]] | Fluxogramas dos loops (heal, expedição, masmorra, work) |
| [[endpoints]] | Catálogo dos endpoints AJAX descobertos (heal, fight, attack) |

---

## Qualidade e Processo

| Documento | O que contém |
|---|---|
| [[TECHNICAL_DEBT]] | Débitos abertos por categoria (DEBT-XX) |
| [[CONTRIBUTING]] | Branches, commits, DoD (versão 1-dev) |
| [[DEVELOPMENT_WORKFLOW]] | Setup, debug, mapeamento de novos fluxos |

---

## Operação

| Arquivo | O que contém |
|---|---|
| [[../README]] | Setup do bot, primeira run com login, modos de execução |
| [[../.env.example]] | Template de configuração |

---

## Sistema Claude (Framework arquiteto + agentes)

| Diretório/arquivo | Conteúdo |
|---|---|
| `.claude/settings.json` | Permissions + hook PostToolUse de session log |
| `.claude/commands/implement.md` | `/implement` — ciclo completo: plano → builder → review → checkpoint |
| `.claude/commands/checkpoint.md` | `/checkpoint` — sync docs+memória antes do commit |
| `.claude/commands/audit-sync.md` | `/audit-sync` — drift entre código e docs |
| `.claude/commands/review-pr.md` | `/review-pr` — review automatizado, gera `docs/reviews/...` |
| `.claude/agents/tech-architect.md` | Plano técnico → `docs/wip/<slug>.md` (Opus) |
| `.claude/agents/bot-builder.md` | Implementa bot/web conforme plano (Sonnet) |
| `.claude/agents/code-reviewer.md` | Pré-commit DoD + regras 1-7 (Sonnet) |
| `.claude/agents/doc-keeper.md` | Sync docs+memória (Haiku) |
| [[../prompt.bot]] | Guia consolidado de regras vigentes (consumido por `bot-builder` e `code-reviewer`) |
| [[validate-docs.sh]] | Script de gate de consistência docs ⇄ repo |
| `docs/reviews/` | Relatórios `review-<branch>-<data>.md` gerados por `/review-pr` |
| `docs/wip/.session-changes.log` | Log gitignored alimentado pelo hook (consumido pelo `doc-keeper`) |

---

## Sinais de Atenção

> Verificar antes de iniciar qualquer trabalho.

- 🟠 **Endpoints `/work` e dungeon-restart `Normal` não capturados** ([[TECHNICAL_DEBT]] DEBT-01, DEBT-02). Bot fica idle quando ambos os pontos zeram, ou quando boss cai.
- 🟡 **Sessão expira eventualmente.** Refresh manual via repetir `node src/index.js --once` e completar login no browser ([[TECHNICAL_DEBT]] DEBT-03).
- 🟡 **`stage` da expedição** é 1-based (Escaravelho = `stage=2`). Validado por 1 caso só. Se trocar de inimigo e quebrar, reverificar.
