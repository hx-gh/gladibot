---
description: Sincroniza docs do repo + memórias Claude com o estado atual do código. Roda ANTES do commit para garantir que tudo que vai pro git está coerente.
---

# /checkpoint

Comando standalone para invocar o `doc-keeper` quando você precisar sincronizar **docs do repo + memórias Claude** com mudanças recentes do código.

**Quando usar**:
- Você fez mudanças no código (ações novas, parser ajustado, novo endpoint mapeado) e quer registrar antes do commit.
- Sessão longa de exploração/refactor — quer consolidar antes de fechar.
- Gate explícito antes de qualquer push.

**Quando NÃO usar**:
- Se você está só lendo código sem mudança real.
- Se a sessão foi puramente de captura de cURL via DevTools (sem editar repo).

## Sem argumentos

Comando autônomo. O `doc-keeper` lê:

- `docs/wip/.session-changes.log` (alimentado pelo hook PostToolUse)
- `git status --short` (working tree)
- `git diff` (mudanças não-commitadas)
- Estado atual de `docs/{PROJECT_STATE,DECISIONS,TECHNICAL_DEBT,endpoints,flows,memory}.md`
- Memórias Claude em `~/.claude/projects/<hash>/memory/`

E decide o que precisa atualizar.

## Execução

1. **Invocar `doc-keeper`** via Task tool com instrução: "Modo checkpoint — sincronizar docs do repo + memórias Claude. Sem ciclo específico — varrer mudanças desde último checkpoint."

2. O `doc-keeper` produz relatório do que mudou. Apresentar ao usuário.

3. **PAUSAR** para o usuário revisar o diff. Não commitar automaticamente.

## Output esperado

```markdown
🗂️ Checkpoint — <descrição da sessão>

[output do doc-keeper conforme template em .claude/agents/doc-keeper.md]

⏸️  Revise o diff antes do commit:
    git status --short
    git diff
```

## Notas

- Memórias Claude vivem em `~/.claude/projects/<hash>/memory/` — **fora do repo**. Sincronização antes do commit garante que sessões futuras encontrem memória alinhada com o código.
- Se houver descobertas/decisões da sessão que valham memória nova, o `doc-keeper` cria seguindo as regras do auto-memory.
- Em conflito entre memória e `docs/PROJECT_STATE.md`: **repo vence**. Memória é atualizada para refletir.
