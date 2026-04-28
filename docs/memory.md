# Contexto do projeto

> Espelho técnico para humanos do que está em `~/.claude/projects/-home-desktop-projetos-gladibot/memory/`. Toda decisão não-óbvia ou fato fora-do-código deve viver aqui.

## Objetivo

Automatizar tarefas repetitivas de Gladiatus para o personagem **AidsEgipicia** no servidor **BR62 Speed x5**. Foco inicial: drenar pontos de expedição e masmorra, curar quando necessário, mandar pra trabalho quando esgotar.

## Personagem (snapshot 2026-04-28)

- Nome: AidsEgipicia (player id `17883`)
- Servidor: `s62-br.gladiatus.gameforge.com`
- Level 49, **HP máx 2.711**, regen 3.264/h
- Atributos: Força 116, Destreza 167, Agilidade 189, Constituição 58, Carisma 107, Inteligência 50
- Armadura 3.130, Dano 104-121

Esses valores são re-deriváveis pelo response JSON de qualquer ação (heal, fight) que retorne `header.health`, `skills`, etc. Não cachear.

## Conceitos importantes do jogo

- **Pontos de expedição e de masmorra são independentes** (dois contadores `X/Y`, máx 24 cada).
- **Cooldowns também são independentes por slot.** O slot de expedição tem seu próprio timer; o de masmorra idem. Atacar um não bloqueia o outro.
- **Trabalho** trava todos os outros slots (não dá pra atacar enquanto trabalha).
- **Session hash (`sh`)** e **CSRF token** rotacionam por sessão. Cookies + CSRF são todos derivados de login Google manual — bot não trata login.

## Estratégia padrão

| Trigger | Ação |
|---|---|
| HP < 20% | Cura com **menor item que não extrapola** (greedy) |
| Cooldown expedição livre + pontos > 0 | Ataca **Escaravelho Gigante** na Caverna de Sangue (`loc=2`, `stage=2`) |
| Cooldown masmorra livre + pontos > 0 | Ataca próximo monstro disponível na masmorra Porto Perdido (`loc=3`) |
| Pontos masmorra acabaram E masmorra finalizada (boss morto) | Inicia nova masmorra Normal |
| Ambos pontos = 0 | **Rapaz do Estábulo** por 8h (1.000 ouro/h, melhor entre os jobs sem custo de rubis) |

## Decisões deliberadas

- **Playwright (persistent context) só pra sessão; ações via AJAX direto.**
  Login Google é manual (uma vez), o perfil fica em `./browser-data/`. As ações do
  jogo continuam sendo chamadas via `page.request.get/post`, que herda os cookies
  do browser. Sem simulação de cliques — mantém a velocidade do approach HTTP-puro
  com a robustez de uma sessão real.
- **Sem `.env` com cookies.** O Playwright lê os cookies do perfil persistente.
  `sh` e `csrf` são extraídos do DOM em runtime; em 401/403, o bot re-navega
  pra overview, re-extrai e retenta uma vez.
- **Channel `msedge` por padrão.** Edge instalado tolera melhor o flow de login Google
  do que chromium puro (que costuma ser bloqueado como "automated browser").
- **Sem Anthropic SDK no runtime.** "Integração Claude" = fluxo de desenvolvimento
  (chat + MCP + Tampermonkey bridge), não API call em produção.
- **Heal greedy "não extrapolar":** preferir desperdiçar **menos HP** (overflow)
  do que sub-curar. Critério: maior item onde `heal_nominal ≤ HP_max - HP_atual`.
  Quando todos os itens extrapolam, usar o de menor cura.

## Arquitetura (resumo)

```
.env (BASE_URL, USER_DATA_DIR, headless?)
   │
   ▼
src/config.js
   │
   ▼
src/browser.js ──▶ Playwright (Edge persistent context)
       │             │
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

## Histórico de descobertas (ordem cronológica)

1. **Snapshot da árvore de acessibilidade do browsermcp não inclui `<img onclick=...>`.** Daí o bridge userscript: ele cria `<a aria-label>` correspondentes que entram na árvore.
2. **CSRF é obrigatório** em todos os endpoints AJAX. Sem ele → 403. Token não está em meta tag pública — bridge extrai por regex no HTML.
3. **Heal aplicado ≠ heal nominal** do tooltip. Ex: tooltip diz "Cura 831" mas servidor aplicou 711. Provável modificador de Inteligência ou cap em missing HP. Use sempre `header.health` do response.
4. **Iniciar masmorra (botão Normal) NÃO consome ponto.** Só lutas dentro consomem. O `did` é o id da instância da masmorra (compartilhado entre todos os monstros dela); `posi` é a posição do monstro.
5. **Stage da expedição é 1-based** (provavelmente). Capturado: clicando Escaravelho (2º na lista) → `stage=2`. A confirmar com testes adicionais.
6. **HP máx confirmado por aritmética inversa:** uma cura nominal de 1.320 levou HP de 2% pra 63% → +61pp = max ≈ 1.320/0.61 ≈ 2.164 (estimativa) → revelado depois pelo JSON: max real é 2.711. Lição: parsing tooltip > aritmética inversa.

## Glossário rápido

- **`sh`**: session hash, query param em toda URL autenticada. Rotaciona em login/logout.
- **`did`**: dungeon instance id. Compartilhado entre todos os monstros da masmorra atual.
- **`posi`**: posição do monstro dentro da masmorra (1..N). Boss tipicamente nas posições mais altas (vimos posi=9 num boss).
- **`stage`**: índice do inimigo na expedição (visível na ordem da página).
- **`a`**: timestamp epoch em ms, cache-buster sem efeito funcional.
- **`from=512`** no inventory/move: número da mochila ativa (Ⅰ). Outras: 513..515.
- **`to=8&toX=1&toY=1&doll=1`** no inventory/move: drop target = doll do char (= consumir item).
