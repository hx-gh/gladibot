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

## Trocar de doll (overview com doll=N)

```
GET /game/index.php?mod=overview&doll=<N>&sh=<sh>
```

`N=1` é o gladiador principal, `N=2` é o "espelho" (mesmo char, gear separado pra outro tipo de batalha), `N=3..6` são os 4 mercenários do squad. Total: **6 dolls**.

**CRÍTICO:** o servidor PHP do Gladiatus só honra `doll=N` quando vê uma **navegação "real"** — ou seja, **sem** o header `x-requested-with: XMLHttpRequest`. Com o header XHR (default do `client._exec`), a página retorna sempre o doll=1, ignorando o param.

Solução: `client.fetchRawHtml(path, params, { noXhr: true })` omite o header XHR só pra essa request. Não afeta os outros endpoints AJAX.

A sidebar lateral do overview lista os 6 dolls (`<div class="charmercsel">`). O parser `parseDollTabs(html)` extrai role+active de cada um.

### Stats por doll (dentro do HTML)

O **header global** (`#header_values_level`, `#header_values_hp_bar`, `.playername`) continua refletindo o **principal** mesmo em `?doll=N`. Para stats do doll selecionado, usar:

| Anchor | Conteúdo |
|---|---|
| `#char_level` | nível do char ativo |
| `#char_leben` | HP em % (ex: "100 %") |
| `#char_leben_tt[data-tooltip]` | linha `["Pontos de vida:", "X / Y"]` com HP absoluto |
| `#char_f0..f5` | atributos (Força, Destreza, …) — texto direto + tooltip detalhado |
| `#char_panzer` | armadura |
| `#char_schaden` | dano |

`parseCharSnapshot(html)` em `src/state.js` consolida todos esses anchors + `parseEquipped()` + `parseDollTabs()` num objeto único.

### Slots equipados (paperdoll)

Cada slot é um `<div data-container-number="N" data-content-type="X" data-tooltip="..." data-item-id="...">`. Container `8` é a área droppable do avatar (heal target), **não** slot de equipment.

| container | content-type | slot |
|---|---|---|
| 2 | 1 | Capacete (helmet) |
| 3 | 2 | Arma principal (weapon) |
| 4 | 4 | Arma secundária / Escudo (offhand) |
| 5 | 8 | Armadura (armor) |
| 6 | 48 | Anel 1 (ring1) |
| 7 | 48 | Anel 2 (ring2) |
| 9 | 256 | Calças (pants) |
| 10 | 512 | Sapatos (boots) |
| 11 | 1024 | Amuleto (amulet) |

Slots vazios têm o `<div>` mas sem `data-item-id`. `parseEquipped` distingue.

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

## Pacotes (read + abrir/mover pro inventário)

### Listagem (read)

```
GET /game/index.php?mod=packages&sh=<sh>
```

HTML completo. Cada pacote é um `<div class="packageItem">` que contém:

- `<input form="pa" type="hidden" name="packages[]" value="<packageId>">`
- `<div data-no-combine="true" data-no-destack="true" data-container-number="-<packageId>">` ← **container = `-packageId` (negativo)**
- Item div interno com `data-content-type`, `data-position-x="1"`, `data-position-y="1"`, `data-measurement-x/y` (tamanho em células do bag), `data-tooltip`, `data-price-gold`, `data-level`, `data-quality?`.

Paginação: ~10 por página (`?page=N`). `parsePackages(html)` em `src/state.js` extrai a página atual. **Não-paginação automática** — se o usuário quiser drenar tudo, precisa iterar `?page=1..N` (não implementado: o orchestrator só processa página 1 por tick, suficiente pro fluxo de cura).

### Abrir (mover pacote pra um bag do inventário)

```
POST /game/ajax.php?mod=inventory&submod=move
  &from=-<packageId>      # NEGATIVO — diferencia container "package" de bag normal
  &fromX=1&fromY=1        # constantes (cada package só tem o item em (1,1))
  &to=<bag>               # 512=Ⅰ, 513=Ⅱ, 514=Ⅲ, 515=Ⅳ
  &toX=<col>&toY=<row>    # célula livre (1..8 × 1..5); precisa caber w×h do item

Body: a=<ts_ms>&sh=<sh>
Content-Type: application/x-www-form-urlencoded
```

Mesmo endpoint de cura/swap — só muda `from` (negativo) e `to` (bag em vez de doll=8). Resposta é JSON com `header.*` atualizado.

`actions/packages.openPackages(client, currentGrid, opts)` itera packages, acha slot livre via `findFreeBagSlot(occupied, w, h)` (varre 8×5 procurando retângulo sem overlap) e dispara um POST por package. Mutação local do `gridSnapshot` impede colisão entre iterações do mesmo tick.

`openHealPackages` filtra só items com `healNominal > 0` (parseado de `Usar: Cura X` no tooltip), usado pelo orchestrator antes do AFK fallback.

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

## Status de trabalho ativo (read-only)

```
GET /game/index.php?mod=work&sh=<sh>
```

HTML completo. Quando o personagem **está trabalhando**, contém:

- `<body id="workPage">`
- `<h1>Trabalhar no estábulo</h1>` (ou outro nome do job ativo)
- Texto âncora: `Ainda não terminou seu trabalho. Quando tiver feito, receberá seu pagamento.`
- **Ticker de countdown** com tempo restante em **milissegundos**:
  ```html
  <span data-ticker-time-left="4207000" data-ticker-type="countdown" data-ticker-ref="1" class="ticker"></span>
  ```

Quando **não está trabalhando**, a mesma URL renderiza a tela de seleção de jobs (sem o `data-ticker-time-left` em `countdown`).

`parseWork(html)` em `src/state.js` faz a detecção. Orchestrator chama `fetchWorkStatus(client)` (HTTP raw via `client.fetchRawHtml`, sem navegar a aba) no início de cada tick e pula heal/exp/dung quando ativo, dormindo até `secondsLeft + 10s slack`.

**Importante:** `mod=overview` **não tem** indicador de trabalho — pontos continuam regenerando, cooldowns ficam zerados. A consulta ao `mod=work` é a única fonte confiável.

## Treinamento (página + ação)

```
GET /game/index.php?mod=training&sh=<sh>
```

HTML completo com 6 blocos (um por atributo: Força, Destreza, Agilidade, Constituição, Carisma, Inteligência). Cada bloco contém:

- `<div id="char_fN_tt" data-tooltip="...">` — JSON com base/items/máximo/total (mesma estrutura do overview)
- `<div class="training_costs">CUSTO <img...></div>` — custo em ouro pra subir 1 ponto
- `<a class="training_button" href="...skillToTrain=ID...">` quando ouro suficiente, ou
- `<img ... button_disabled.jpg" title="Você não tem ouro suficiente!">` quando insuficiente

Mapping de IDs (`skillToTrain`):

| Stat | DOM id | skillToTrain |
|---|---|---|
| Força | `char_f0` | 1 |
| Destreza | `char_f1` | 2 |
| Agilidade | `char_f2` | 3 |
| Constituição | `char_f3` | **4** ✓ |
| Carisma | `char_f4` | 5 |
| Inteligência | `char_f5` | **6** ✓ |

Pontos confirmados em produção; demais inferidos do padrão sequencial.

`parseTraining(html)` em `src/state.js` extrai `{ skills: [{key, label, trainId, cost, canTrain}], skillPoints, stats }`.

### Treinar atributo

```
GET /game/index.php?mod=training&submod=train&skillToTrain=<id>&sh=<sh>
```

Link puro (não AJAX). Servidor aplica o treino + redireciona pra `mod=training`. Bot usa `client.fetchRawHtml` (HTTP, não navega a aba) e re-parseia a resposta pra retornar custos atualizados sem precisar de outro round-trip. Gated por `isActionsEnabled()` no `actions/training.js`.

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

## Leilão (auction-house)

> Mapeamento parcial — Fase 1 do Painel 2 (read-only). Análise DOM completa em `docs/wip/auction/leilao1-analysis.md`.

### Listagem (read)

```
GET /game/index.php?mod=auction&sh=<sh>           # aba "Necessidades do gladiador" (default)
GET /game/index.php?mod=auction&ttype=3&sh=<sh>   # aba "Necessidades de mercenário"
```

HTML completo. Listagem é grid de até 5 anúncios por filtro/aba; **sem paginação** (até prova em contrário). Cada anúncio é um `<form id="auctionForm<auctionid>">` independente.

**Particularidades do leilão Gladiatus (vs PvP típico):**

- É **vs NPC** (jogo gera os itens), não player-to-player. Sem campo `seller`.
- **Sem countdown per-item** — só indicador global `<span class="description_span_right"><b>Médio</b></span>` (texto categórico: "Curto"/"Médio"/"Longo").
- O `data-tooltip` do item já contém **comparação com o item atualmente equipado** no doll (array[0]=leiloado, array[1]=equipado), sem precisar de fetch extra.

### Filtros (POST → mesma URL)

`<form action="" method="post" name="filterForm">`. Body params:

| name | tipo | valores | obs |
|---|---|---|---|
| `doll` | hidden | `1` (gladiador) / `6+` (mercenário) | comparação |
| `qry` | text | string | busca por nome |
| `itemLevel` | select | `36, 42, 48, 54, 60` | "nível mínimo", escalas de 6 |
| `itemType` | select | `0..15` | categoria — ver mapping |
| `itemQuality` | select | `-1=padrão, 0=verde, 1=azul, 2=roxo` | rarity mínima |
| `statFilter[]` | hidden array | `1..6` | stat preferido (Força..Inteligência) |

**`itemType` map**: `0`=Todo, `1`=Armas, `2`=Escudos, `3`=Armadura, `4`=Capacetes, `5`=Luvas, `6`=Anéis, `7`=Cura, `8`=Sapatos, `9`=Amuletos, `11`=Alças, `12`=Melhorias, `15`=Mercenário.

### Lance / compra imediata (POST)

```
POST /game/index.php?mod=auction&submod=placeBid&ttype=<n>&rubyAmount=60&sh=<sh>
Content-Type: application/x-www-form-urlencoded
x-csrf-token: <csrf>

auctionid=<id>
buyouthd=<0|1>           # 1 = comprar imediato; 0 = lance normal
bid_amount=<valor>       # apenas quando buyouthd=0
bid=Proposta             # quando lance
buyout=Comprar           # quando compra imediata
qry=<echo>&itemType=<echo>&itemLevel=<echo>&itemQuality=<echo>   # ecoam o filtro atual
```

`rubyAmount=60` aparece fixo no action — provavelmente preço de boost do server. Cada `<form>` da listagem já vem com hidden inputs montados; basta clonar e setar `bid_amount`/`buyouthd`.

**Plugado via UI (2026-04-29):** `actions/auction.placeBid(client, {auctionId, ttype, buyout, bidAmount, rubyAmount, filterEcho})` reusa `client.postForm`. Gated por `isActionsEnabled()`. Endpoint UI: `POST /api/auction/bid` aceita JSON com mesmos campos. Após sucesso, marca `auctionId` em `botState.myBidAuctionIds` (Set in-memory) — usado pelo parser pra reforçar `listing.myBid` na próxima listagem. Ver DEC-21.

**Gate de bucket pra LANCE (não-buyout, 2026-05-01):** `placeBid` recusa lance quando `globalTimeBucket !== "Curto"` (TTL 60s do cache em `botState.lastAuctionBucket`, atualizado por todo `fetchAuctionList`). Buyout não tem essa restrição (instantâneo, sem outbid possível). Regra do usuário: dar lance cedo (Longo/Médio) tem alto risco de outbid antes do fim — só lança quando o bucket fecha. Ver DEC-27.

**`ttype` por listing (`formTtype`):** parser captura `?ttype=N` do `<form action>` de cada listing. Frontend usa esse valor (e não o da aba) ao montar o POST. Aba mercenário usa URL `?ttype=3`, mas os forms internos vêm com `ttype=2` — divergência confirmada no sample (linha 826 de leilao1.html).

### Schema de cada listing (parsing de DOM)

Por anúncio (1 form):

- **auctionId**: `input[name="auctionid"]` ou regex `/auctionForm(\d+)/` no `form[id]`
- **item icon**: `div.auction_item_div div.item-i-<itemType>-<subId>`
- **tooltip JSON**: `[data-tooltip]` — array aninhado `[item, comparacao]`
- **level**: `[data-level]`
- **rarity**: `[data-quality]` (1=azul, 2=roxo). **Ausente = verde ou comum** — distinguir pela cor inline `lime` vs branco no nome dentro do tooltip.
- **price gold (base)**: `[data-price-gold]`
- **price multiplier**: `[data-price-multiplier]` (provavelmente 3 = buyout = base × 3 em ouro?)
- **measurement**: `data-measurement-x/y` (slots ocupados)
- **basis / hash**: `data-basis`, `data-hash` (identificadores opacos)
- **lance atual / "Não existem licitações"**: 1ª `<div>` em `div.auction_bid_div`
- **preço inicial**: 2ª `<div>` em `auction_bid_div` (`Preço baixo: X.XXX`)
- **buyout em ouro / rubis**: números soltos antes de `<img title="Ouro">` e `<img title="Rubis">` na parte de buyout

### Marcação de lance ativo (validado 2026-04-29)

Sample real em `docs/wip/auction/leilao-after-bid.html` (item `auctionForm6816306` após bid de 208g):

```html
<div class="auction_bid_div">
  <div>
    <a href="index.php?mod=player&p=17883&sh=...">
      <span style="color:blue;font-weight:bold;">AidsEgipicia</span>
    </a>
  </div>
  <div>Preço baixo : 219 <img title="Ouro"></div>
  <input name="bid_amount" value="219"/>
  ...
</div>
```

Parser captura `bidderName` via regex sobre `<a mod=player>...<span>NOME</span></a>`. `myBid` é setado em `actions/auction.enrichResult` comparando `bidderName` (case-insensitive) com `snapshot.charName`. **Valor exato do lance corrente NÃO é exposto** — o "Preço baixo" pós-bid é o `nextMinBid` (~5% acima do lance atual).

### Pendências de captura — leilão

- [ ] Confirmar `ttype` semantics (1 vs 2 vs 3) — parser já usa `formTtype` por listing, mitiga
- [ ] Estrutura/paginação real da aba "Tudo" sem filtro
- [ ] Validar se filtro `itemType=0` retorna mais que 5 entries

---

## Pendências de captura

- [x] Iniciar nova masmorra (botão Normal) — 2026-04-28
- [x] Iniciar trabalho (botão Ir!) — 2026-04-28
- [x] Cancelar masmorra — 2026-04-28
- [x] Status de trabalho (read) — 2026-04-28
- [x] Treinamento (read + train por atributo) — 2026-04-28
- [x] Leilão — listagem + filtros + lance/buyout (parcial, ver §Leilão) — 2026-04-28
- [ ] Refresh "manual" do CSRF (se descobrirmos endpoint)
