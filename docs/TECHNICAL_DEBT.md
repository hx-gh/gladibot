---
date: 2026-04-28
updated: 2026-04-28
---

# Gladibot — Technical Debt

> Débitos abertos com IDs únicos (`DEBT-XX`). Quando resolver, mover para §Resolvidos com data e referência (commit/sessão).

## Prefixos

- **DEBT** — débito genérico (mais comum num bot single-package)

Quando o projeto crescer e justificar, separar em prefixos finos (`SEC`, `INFRA`, `BACK`, ...).

---

## Abertos

### DEBT-03 — Refresh de sessão expirada não-automático

**Arquivo**: `src/browser.js`, `src/index.js`
**Problema**: Em 401/403, o cliente já tenta uma vez re-extrair `sh+csrf` via `refreshSession`. Se isso também falhar (ex: cookie de login expirou de fato), o bot exit code 2 e pede pra usuário re-rodar. Não há recovery automático que dispare novo flow de login.
**Impacto**: 🟡 Baixo — login Google expira raramente (semanas?). Aceitável pedir intervenção manual.
**Ação** (se virar prioridade): detectar redirect para `login.gameforge.com` e abrir o browser não-headless mesmo se o `.env` pediu headless, esperar o usuário concluir, retomar.
**Esforço**: ~1h
**Prioridade**: 🟡

### DEBT-04 — Sem dashboard de monitoramento

**Arquivo**: _(não existe)_
**Problema**: Bot só loga em stdout. Pra monitorar 24/7 num fim-de-semana, é tail de log. Sem visualização de "HP atual", "ouro acumulado", "última ação", "próximo tick em X".
**Impacto**: 🟢 Baixo — qualidade de vida, não bloqueador.
**Ação**: Pequeno HTTP server (Express ou raw `http` do Node) em `src/dashboard.js` exposto em `localhost:3000`, polling do estado a cada N segundos. ~50 linhas.
**Esforço**: ~1-2h
**Prioridade**: 🟢

### DEBT-05 — `stage` da expedição validado por 1 caso só

**Arquivo**: `src/actions/expedition.js`, `.env.example`
**Problema**: O `EXPEDITION_STAGE=2` corresponde ao Escaravelho Gigante (índice 2 na lista). Não validamos os outros índices (1=Lobo? 3=Dançador? 4=Demônio?). Se o usuário trocar pra `stage=3`, pode quebrar.
**Impacto**: 🟢 Baixo — afeta só configuração, não código.
**Ação**: Capturar cURL de cada stage 1..4 em sessão de teste e documentar em `docs/endpoints.md`.
**Esforço**: ~15 min
**Prioridade**: 🟢

---

## Resolvidos

| ID | Descrição | Data | Ref |
|---|---|---|---|
| DEBT-01 | Endpoint "Ir!" do trabalho capturado e plugado em `src/actions/work.js` (POST `index.php?mod=work&submod=start` com `jobType`+`timeToWork`) | 2026-04-28 | sessão 2026-04-28 |
| DEBT-02 | Endpoint "Normal" da masmorra capturado e plugado em `src/actions/dungeon.js` (POST `index.php?mod=dungeon&loc=<loc>` com `dif1=Normal`); fix do `isDungeonEntryPage` (input, não button) | 2026-04-28 | sessão 2026-04-28 |
