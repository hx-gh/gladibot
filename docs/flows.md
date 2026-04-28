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

Ativar APENAS quando ambos `exp_pontos = 0` AND `dung_pontos = 0`. Default: **Rapaz do Estábulo, 8h** (1.000 ouro/h sem custos).

Em Speed x5, 8h "in-game" ≈ 96 minutos reais. Durante esse período, o bot deve dormir até o fim do shift e só então retomar o loop.

## Refresh de sessão (a fazer)

Não implementado no MVP. Quando o bot recebe 401/403 (CSRF/cookie inválido):

```
log.error("session expired — renew .env and restart")
process.exit(1)
```

Evolução futura: detectar a expiração e abrir um helper que use Playwright pra fazer login Google, salvar cookies, continuar.

## Mapeamento de novos fluxos (processo humano + Claude)

Quando descobrir uma feature nova do jogo que queremos automatizar:

1. **Mapear via chat:** abrir Claude Code, conectar browsermcp na aba do Gladiatus, navegar até a feature, snapshotar estado.
2. **Capturar request HTTP:** clicar a ação manualmente com DevTools Network aberto, copiar como cURL.
3. **Adicionar bridge** (se o controle for `<img onclick>` invisível pra acessibilidade): estender `gladibot-bridge.user.js` pra expor como `<a>`.
4. **Documentar** o endpoint em `docs/endpoints.md` e o fluxo aqui.
5. **Implementar** action correspondente em `src/actions/`.
6. **Plugar no orchestrator** se for parte do loop.
