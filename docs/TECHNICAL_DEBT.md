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

### DEBT-06 — Catálogo de sufixos só em EN; leilão BR usa PT-BR

**Arquivo**: `data/affixes.json`, `src/affixCatalog.js`
**Problema**: O catálogo do fansite (gladiatus.gamerz-bg.com) está em inglês — sufixos lá são "of Brightness", "of Strength" etc. No servidor BR62, sufixos vêm como "do Brilho", "da Força", etc. Resultado: lookup direto por nome falha — `lookupSuffix("do Brilho")` retorna null sempre.
Prefixos não têm esse problema porque o jogo usa nomes inventados (Bilgs, Calódiens, Asendacs) que são iguais em todos os idiomas.
**Impacto**: 🟡 Médio — filtro "⭐ só top" só pega itens com **prefix** top. Sufixos top ficam invisíveis.
**Ação**: Construir mapping PT↔EN. Opções:
- Scrape próprio jogo (filtrar leilão por sufixo até cobrir todos), cross-ref com catálogo EN por stats.
- Mapeamento manual dos ~36 top-suffixes (esforço pequeno, valor alto).
- Detectar sufixo BR pela combinação `(stat, value, level)` extraída do tooltip do item.
**Esforço**: ~1h (mapping manual dos top), ~3h (scrape automatizado)
**Prioridade**: 🟡

### DEBT-07 — Consolidação de stats flat+% cobre só 6 atributos principais

**Arquivo**: `src/itemCompare.js`, `consolidateMainStats`
**Problema**: Hardcoded em `CONSOLIDATABLE_STATS` = {força, destreza, agilidade, constituição, carisma, inteligência}. Se o jogo adicionar novos atributos ou modificar a consolidação, o código fica defasado.
**Impacto**: 🟡 Baixo — atributos estão estáveis no jogo (parece não haver plano pra adicionar).
**Ação**: Ao atualizar `data/affixes.json` (próximo patch do jogo), revisar lista de atributos principais em `CONSOLIDATABLE_STATS`.
**Esforço**: ~5 min (uma linha de grep/map)
**Prioridade**: 🟢

### DEBT-08 — `analyzeRecommendation` na UI só analisa stats com max conhecido

**Arquivo**: `src/ui/app.js`, `analyzeRecommendation`
**Problema**: Função que calcula `isRecommended` depende de `charSnapshot.stats[statKey].max` — valor de cap do atributo. Stats cujo max não é extraído do parser (ex: `max === null`) são ignorados na análise de gap. Resultado: item que preenche Dano (stat sem max no snapshot) não sai recomendado mesmo sendo upgrade.
**Impacto**: 🟡 Médio — stats secundários (Dano, Cura, Regen) tendem a ter cap booleano (0 ou não-0), não intervalo descoberto. `analyzeRecommendation` pode ser muito conservador.
**Ação**: Estender parser de stats para capturar `max` mesmo pra stats secundários (se tooltip do char expõe). Ou: usar heurística alternativa (ex: if sign > 0 && stat não é "mesma coisa" do que já tem, contar).
**Esforço**: ~30 min (revisar tooltip de stats no jogo real, confirmar formato)
**Prioridade**: 🟡

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
| DEBT-04 | UI vanilla local entregue (Express + `src/ui/public/`, polling 2s, pause/resume/tick-now). Ver DEC-08. | 2026-04-28 | sessão 2026-04-28 |
