# Proposta de Design — maquininhas-node (2026-07)

Análise pesada de design/layout pedida pelo Marcio: deixar o app com **ar profissional** e boa **usabilidade em desktop e mobile**. Entregue como **proposta primeiro** (diagnóstico + 3 direções visuais navegáveis + recomendação) — a implementação do redesenho é etapa **separada**, planejada só depois da sua escolha.

Método: painel multi-agente — **3 designers** geraram cada um uma direção completa (mockup HTML self-contained) + **1 crítico** avaliou as três contra um checklist objetivo.

## Como ver as 3 direções
Abra os arquivos no navegador (duplo-clique — são HTML self-contained, funcionam offline, com **toggle claro/escuro** e seletor **Desktop / Mobile 375px**):
- `docs/design/direcao-a-operacional-limpa.html`
- `docs/design/direcao-b-cockpit-denso.html`
- `docs/design/direcao-c-moderna-cartoes.html`

---

## Diagnóstico (o que a proposta corrige)
- **P0:** login sem `<meta viewport>` (mobile quebra); banner de erro hard-coded 4× (rosa no dark); KPI cards sem foco de teclado; **fonte Inter nunca carregada** (cai em system-ui); tabelas ilegíveis no mobile.
- **P1:** 4 sistemas de tabela / 3 de filtro / 4 empty-states; 8 botões bespoke (sistema `.btn` só decorativo); sem tokens de espaçamento nem escala tipográfica; dark mode duplicado; 5 breakpoints soltos.
- **P2:** contraste de pills reprova AA; foco ausente; `prompt()`/`confirm()` nativos; CSS morto/conflitos.

Todas as 3 direções resolvem isso (um só sistema de tabela/filtro/botão/empty-state, tokens de espaçamento + escala tipográfica, dark mode em bloco único, breakpoints coordenados, AA, foco visível, Inter no stack, ícones Tabler, zero emoji).

## As 3 direções
- **A — Operacional Limpa:** espaçosa, data-first, calma. Blood Orange só na ação/ativo/foco. Mobile = tabela vira **cards ricos**. A mais sóbria e fiel à marca.
- **B — Cockpit Denso:** pro-tool de alta densidade (mais máquinas por tela). Mobile = coluna serial **congelada** + scroll horizontal. A mais fiel ao comportamento real do app.
- **C — Moderna Cartões:** visual mais contemporâneo, KPI cards fortes, micro-interações. Mobile = cards. A mais "bonita", mas a mais decorada.

## Avaliação do crítico
| Direção | Nota | Forte | Fraco |
|---|---|---|---|
| **A — Operacional Limpa** | **8,5** | Sistema único mais rigoroso; **contraste AA impecável** (light+dark); maior fidelidade de marca; mobile cards; menos "cara de IA" | Arejada demais (baixa densidade); demo pouco funcional; 1 alvo de 40px; sem pre-paint de tema (flash no dark) |
| **B — Cockpit Denso** | **8,0** | **Melhor densidade** + fidelidade funcional (recalcula Situação ao vivo, KPI→filtro, toasts); melhor tratamento de **foco** | Mobile serial-congelado+scroll = **pior ergonomia de polegar** pra editar uma máquina; adorno de apresentação; uso mais pesado da marca |
| **C — Moderna Cartões** | **7,0** | Apresentação mais polida; ótimos cards mobile; pill "Vence hoje" preto/amarelo de alto contraste | **Regressão de foco** (removeu outline dos inputs); mais decoração/slop; menor densidade |

## Recomendação
**Base = A** (sistema, identidade sóbria, contraste AA, mobile em cards) — **densificada rumo à B** (linhas/controles mais compactos, mais máquinas por tela) — herdando da **B** a lógica de interação (recalcular Situação ao vivo, KPI→filtro, filtro de retorno só em Em Uso), o **pre-paint de tema** (sem flash) e o **foco 2px + anel** em todos os controles. **Mobile SEMPRE em cards** (padrão de A/C), descartando o serial-congelado da B. De **C**, aproveitar só o **"Vence hoje" preto sobre amarelo** se a pill precisar de mais destaque; **evitar** a remoção do outline de foco.

*Racional:* o usuário é um operador que passa o dia consultando/atualizando máquinas em desktop e mobile — as prioridades são densidade/escaneabilidade, contraste, mobile realmente usável pra editar UMA máquina, identidade sóbria e zero adorno. A vence no estrutural; B complementa na densidade e no comportamento.

## Próximo passo (aguarda sua decisão)
Escolha a direção (A, B, C, ou **a mistura recomendada**). Só então planejo a **implementação** do redesenho (etapa separada) — em ondas, tela a tela, com preview e você conferindo. **Nada em `src/` foi tocado nesta fase.**
