# Fluxos de execução

## Loop principal

```
        ┌──────────────────────┐
        │  GET overview        │
        │  → parse state       │
        └──────────┬───────────┘
                   │
        ┌──────────▼───────────┐
        │  HP < 20%?           │
        │  (PRÉ-LUTA)          │
        └──────┬────────────┬──┘
            sim│            │não
               ▼            │
        ┌──────────────┐    │
        │ heal greedy  │    │
        │ (POST move)  │    │
        └──────┬───────┘    │
               │            │
               └─────┬──────┘
                     ▼
        ┌────────────────────────┐
        │ HP ainda < 20% AND     │
        │ inventário sem food?   │
        │ (AFK FALLBACK)         │
        └──────┬─────────────┬───┘
            sim│             │não
               ▼             │
        ┌──────────────────┐ │
        │ work force=true  │ │
        │ Rapaz Estábulo 8h│ │
        │ → return próx.   │ │
        │   tick (dorme    │ │
        │   no gate work)  │ │
        └──────────────────┘ │
                             ▼
        ┌────────────────────────┐
        │ exp_cooldown livre AND │
        │ exp_pontos > 0?        │
        └──────┬─────────────┬───┘
            sim│             │não
               ▼             │
        ┌──────────────┐     │
        │ ataque exp   │     │
        │ (POST attack)│     │
        └──────┬───────┘     │
               └────┬────────┘
                    ▼
        ┌────────────────────────┐
        │ dung_cooldown livre AND│
        │ dung_pontos > 0?       │
        └──────┬─────────────┬───┘
            sim│             │não
               ▼             │
        ┌──────────────┐     │
        │ ataque masm  │     │
        │ (POST fight) │     │
        └──────┬───────┘     │
               │             │
        ┌──────▼──────────┐  │
        │  HP < 20%?      │  │
        │ (PÓS-LUTA)      │  │
        └──────┬────────┬─┘  │
            sim│        │não │
               ▼        │    │
        ┌──────────────┐│    │
        │ heal greedy  ││    │
        │ (POST move)  ││    │
        └──────┬───────┘│    │
               │        │    │
               └────┬───┘    │
                    ▼
        ┌────────────────────────┐
        │ exp_pontos = 0 AND     │
        │ dung_pontos = 0?       │
        └──────┬─────────────┬───┘
            sim│             │não
               ▼             │
        ┌──────────────┐     │
        │ trabalho 8h  │     │
        │ (POST work)  │     │
        └──────────────┘     │
                             │
                    ┌────────▼────────┐
                    │ sleep até menor │
                    │ cooldown ativo  │
                    └────────┬────────┘
                             │
                             └──▶ (loop)
```

## Cura (heal greedy "não extrapolar")

```
  HP_atual / HP_max  →  missing = max - atual

  candidatos = items[content_type=64] ordenados por heal_nominal asc

  escolha = MAIOR item onde heal_nominal ≤ missing
            (se nenhum couber, usa o MENOR — overflow mínimo)

  POST inventory/move com (container, x, y) do item escolhido
```

Heuristica do "heal_nominal" porque `heal_aplicado` (real) costuma ser **menor** que o nominal (modificador de Inteligência). Então usar o nominal como cap é seguro: se nominal cabe em missing, o aplicado também cabe.

## Masmorra: detectar fim e reiniciar

Após cada `dungeon/fight`, parse o estado:

- Se a masmorra ainda tem monstros não-derrotados → continuar
- Se boss foi derrotado → próxima requisição na overview da masmorra mostra a tela "Entre na masmorra" com botão Normal
  - POST equivalente ao botão Normal (capturar endpoint quando isso acontecer pela primeira vez)
  - Iniciar nova masmorra
  - **Lembrar:** iniciar masmorra NÃO consome ponto

## Trabalho: quando enviar e por quanto tempo

Dois caminhos no orchestrator disparam `startWork`:

**1. Fallback de pontos zerados (passo 4 do tick).** Ativa quando ambos `exp_pontos = 0` AND `dung_pontos = 0`. Usa `config.work.job` + `config.work.hours` (defaults: Rapaz do Estábulo `jobType=2`, 8h).

**2. Fallback AFK lowHp+noFood (passo 1b do tick, DEC-16).** Ativa quando `hpPercent < HEAL_THRESHOLD_PCT` **e** `inventoryFood.length === 0`, **mesmo com pontos sobrando**. Chama `startWork(client, state, { force: true, jobType: 2, hours: 8 })`:
- `force: true` → bypass do gate "ainda tem pontos".
- `jobType: 2 / hours: 8` → hardcoded (Rapaz do Estábulo, max do range), independente de `config.work`.
- Justificativa: pontos de exp/masm **não regeneram com o tempo**, só HP regenera. "Dormir o tick" travaria o bot pra sempre. Ir trabalhar queima tempo até HP voltar; quando shift acabar, ataques retomam.

Em Speed x5, 8h "in-game" ≈ 96 minutos reais. Durante esse período, o bot deve dormir até o fim do shift e só então retomar o loop (gating em `mod=work` cobre isso — DEC-09).

## Refresh de sessão (a fazer)

Não implementado no MVP. Quando o bot recebe 401/403 (CSRF/cookie inválido):

```
log.error("session expired — renew .env and restart")
process.exit(1)
```

Evolução futura: detectar a expiração e abrir um helper que use Playwright pra fazer login Google, salvar cookies, continuar.

## Leitura de Personagens (principal + espelho + 4 mercs)

Lazy fetch — só dispara via `GET /api/characters[/attributes|/items]` (UI tab Mercenários ou curl no terminal).

```
curl /api/characters
        │
        ▼
   loadCharacters(req)
        │
   from=db? ──sim──▶ readAllCharacters() ──▶ JSON
        │
        não
        ▼
   fetchAllCharacters(client)
        │  (paralelo doll=1..6)
        ▼
   client.fetchRawHtml(
     '/game/index.php',
     { mod:'overview', doll: N },
     { noXhr: true }     ◀── CRÍTICO (DEC-17): sem isso o servidor
   )                          ignora o param e devolve sempre doll=1
        │
        ▼
   parseCharSnapshot(html)
   ├─ playername (#playername)
   ├─ #char_level, #char_leben (HP%)
   ├─ #char_leben_tt[data-tooltip] → HP absoluto
   ├─ #char_f0..f5 → 6 atributos
   ├─ #char_panzer (armadura), #char_schaden (dano)
   ├─ parseEquipped(html) → 9 slots paperdoll
   └─ parseDollTabs(html) → role + active doll
        │
        ▼
   persistCharacters(all) → SQLite (upsert por doll/slot)
        │
        ▼
   res.json({ characters: [...] })
```

Filtros:
- `/api/characters` — full payload (stats + equipped)
- `/api/characters/attributes` — só `{ doll, role, name, level, hp, stats, armor, damage }`
- `/api/characters/items` — só `{ doll, role, name, level, equipped[] }`
- `?from=db` em qualquer um — lê do SQLite sem refetch (use pra consumo via curl quando não quiser onerar o servidor)

Sem auto-refresh — bot não consulta esses endpoints no tick. A tab Mercenários da UI carrega o placeholder e só dispara o fetch quando o user clica no ⟳.

## Mapeamento de novos fluxos (processo humano + Claude)

Quando descobrir uma feature nova do jogo que queremos automatizar:

1. **Mapear via chat:** abrir Claude Code, conectar browsermcp na aba do Gladiatus, navegar até a feature, snapshotar estado.
2. **Capturar request HTTP:** clicar a ação manualmente com DevTools Network aberto, copiar como cURL.
3. **Adicionar bridge** (se o controle for `<img onclick>` invisível pra acessibilidade): estender `gladibot-bridge.user.js` pra expor como `<a>`.
4. **Documentar** o endpoint em `docs/endpoints.md` e o fluxo aqui.
5. **Implementar** action correspondente em `src/actions/`.
6. **Plugar no orchestrator** se for parte do loop.
