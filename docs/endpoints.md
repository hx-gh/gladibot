# Endpoints AJAX descobertos

Base: `https://s62-br.gladiatus.gameforge.com`

Headers obrigatórios em **todos** os endpoints AJAX:

```
x-csrf-token: <hex64>             # rotaciona por sessão
x-requested-with: XMLHttpRequest
cookie: <cookie string>           # extraída de um login válido
```

## Overview (read-only)

```
GET /game/index.php?mod=overview&sh=<sh>
```

HTML completo da página. Parser extrai do response:

- HP atual/máximo (texto `Pontos de vida X / Y` ou via `data-tooltip` da barra de HP)
- Pontos de expedição (`X / Y`)
- Pontos de masmorra (`X / Y`)
- Cooldowns dos slots (timer string `mm:ss` ou ausência → livre)
- Ouro / rubis / level / exp%
- Inventário (`#inv > div[data-content-type=64]` para comida)

## Atacar expedição

```
GET /game/ajax.php?mod=location&submod=attack
  &location=<loc_id>     # 2 = Caverna de Sangue
  &stage=<enemy_idx>     # 1-based, ordem da página
  &premium=0
  &a=<ts_ms>
  &sh=<sh>
```

Resposta: redireciona pra página de relatório de combate (HTML completo).

**Custo:** 1 ponto de expedição. Inicia cooldown do slot expedição (~60s).

## Atacar monstro de masmorra

```
GET /game/ajax/doDungeonFight.php
  ?did=<dungeon_instance_id>
  &posi=<monster_position>
  &a=<ts_ms>
  &sh=<sh>
```

`did` e `posi` são obtidos do HTML da página da masmorra (atributos dos `<img onclick="startFight(posi, did)">` ou via bridge userscript que os expõe como `<a aria-label="gladibot-fight-X-Y">`).

Resposta: HTML do relatório de combate.

**Custo:** 1 ponto de masmorra. Inicia cooldown do slot masmorra.

## Iniciar nova masmorra (Normal)

> **A capturar.** Botão "Normal" na tela "Entre na masmorra" (após boss derrotado). Via inspeção, é provavelmente um POST/GET para algo como `/game/index.php?mod=dungeon&submod=startNew&...` ou um `<form>` submit. Validar quando tivermos o curl.

## Curar (mover item da mochila para o doll)

```
POST /game/ajax.php?mod=inventory&submod=move
  &from=<bag_number>     # 512 = Ⅰ, 513 = Ⅱ, 514 = Ⅲ, 515 = Ⅳ
  &fromX=<grid_x>        # data-position-x do item
  &fromY=<grid_y>        # data-position-y do item
  &to=8                  # constante: 8 = doll do char
  &toX=1&toY=1           # constante
  &amount=1
  &doll=1

Body: a=<ts_ms>&sh=<sh>
Content-Type: application/x-www-form-urlencoded
```

Resposta JSON com:

```json
{
  "from": null, "to": null,
  "heal": "+711 Pontos de vida",
  "gold": 0, "rubies": 0,
  "status": { "leben": { "value": 100, "tooltip": [...] }, ... },
  "header": {
    "gold": { "value": 24191, "text": "24.191" },
    "health": { "value": 2483, "maxValue": 2711, "regenPerHour": 3264, ... },
    "experience": { "percentage": 60, ... },
    "expedition": { "points": 21, "pointsMax": 24, "cooldown": {"start":..., "end":...}, "text": "Ir em Expedição" },
    "dungeon": { "points": 22, "pointsMax": 24, "cooldown": {...}, "text": "Ir para a Masmorra" },
    "arena": { "cooldown": {...} },
    "grouparena": { "cooldown": {...} }
  }
}
```

**Use sempre `header.health.value` / `header.health.maxValue`** como fonte de verdade do HP, não o tooltip estático do item.

## Iniciar trabalho

```
POST /game/index.php?mod=work&submod=start&sh=<sh>
Content-Type: application/x-www-form-urlencoded
x-csrf-token: <csrf>

jobType=<id>&timeToWork=<hours>
```

**Não é AJAX** — é POST de form clássico, resposta HTML (a página `mod=work` re-renderizada com o estado de "trabalhando"). Usar `client.postForm('/game/index.php', { mod:'work', submod:'start' }, { jobType, timeToWork })`.

`jobType` (capturado do HTML do form, atributos `id="job_row_N"` + `setWorkTime(N, ...)`):

| ID | Trabalho | Horas (min-max) | Premium |
|---|---|---|---|
| 0 | Senador | 1–24 | sim (3 roupas) |
| 1 | Joalheiro | 1–4 | sim |
| 2 | Rapaz do estábulo | 1–8 | não |
| 3 | Agricultor | 1–6 | não |
| 4 | Talhante | 1–3 | não |
| 5 | Pescador | 4–10 | não |
| 6 | Padeiro | 1–4 | não |
| 7 | Ferreiro | 12 fixo | não |
| 8 | Mestre Ferreiro | 6 fixo | sim |

Default do bot: `WORK_JOB=2` (Rapaz do estábulo), `WORK_HOURS=8`.

## Iniciar nova masmorra (botão Normal)

```
POST /game/index.php?mod=dungeon&loc=<loc>&sh=<sh>
Content-Type: application/x-www-form-urlencoded
x-csrf-token: <csrf>

dif1=Normal
```

**Não é AJAX** — POST de form clássico, resposta HTML (a própria página `mod=dungeon` re-renderizada já com os monstros disponíveis pra `startFight`). Detecção da página de entrada (boss caiu): presença do `<h3>Entre na masmorra</h3>` + `<input name="dif1">`. O botão "Avançado" fica `disabled` abaixo do nível 90.

## Cancelar masmorra

```
POST /game/index.php?mod=dungeon&loc=<loc>&action=cancelDungeon&sh=<sh>
Content-Type: application/x-www-form-urlencoded
x-csrf-token: <csrf>

dungeonId=<id>
```

`dungeonId` é dinâmico — vem do `<input type="hidden" name="dungeonId" value="...">` na própria página da masmorra ativa. Não é parte do loop principal (bot não cancela masmorras automaticamente); fica documentado pra ferramentas/scripts ad-hoc se um dia for útil.

## Pendências de captura

- [x] Iniciar nova masmorra (botão Normal) — 2026-04-28
- [x] Iniciar trabalho (botão Ir!) — 2026-04-28
- [x] Cancelar masmorra — 2026-04-28
- [ ] Refresh "manual" do CSRF (se descobrirmos endpoint)
