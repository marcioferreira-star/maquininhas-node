# Auditoria de código, datas e planilhas — 2026-07-10

Auditoria multi-agente (3 levantadores em paralelo — código/datas, qualidade de dados e integridade do pipeline — + verificação adversária de cada achado). **27 achados, 0 refutados**, 8 confirmados e 19 "parcial" (reais, porém menores que o descrito na primeira passada). Severidade após verificação: **1 alta · 4 média · 13 baixa · 9 info**.

## Veredito de uma linha
**O app ao vivo (Sheets) está são — nenhum bug crítico ativo.** O cálculo de datas server-side é correto (BRT via `Intl`, blindado do fuso do processo); os caminhos de escrita são atômicos com rollback. Os achados de *código* são **hardening/defense-in-depth** (fixados nesta leva). **O peso real está no espelho Neon (migração Onda 6, que ainda NÃO é a fonte de produção):** a promoção descarta em silêncio a maioria das linhas de perda/troca/localizar/movimento cujo serial não está mais na CONTROLE.

---

## 🔴 CAUSA-RAIZ (1 problema, vários sintomas) — Pipeline planilha→Neon descarta linhas órfãs em silêncio
A promoção do sync (`sync-neon.js` / `tools/etl/promover.js`) materializa `perda/troca/localizacao/movimento` com **JOIN em `maquina` por serial** e **FK `NOT NULL`**. Toda linha cujo serial **não está na aba CONTROLE atual** (máquina que já saiu do parque — exatamente a que foi perdida/trocada/sumiu) é **eliminada**, e a curadoria (`motivo_revisao`) **não marca** esse tipo de órfão. O JOIN ainda é case-sensitive.

| Sintoma (verificado ao vivo no Neon) | Staging | Final | Perdido | Sev. |
|---|---|---|---|---|
| **Perdas** descartadas | 47 | **5** | 42 (24 sem flag algum) | **Alta** |
| **Localizar** — aba inteira some | 15 | **0** | 15 | Média |
| **Trocas** descartadas | 26 | **1** | 25 (8 sem flag) | Média |
| **Movimentos** (histórico) órfãos | 1396 | 1356 | 40 (17 seriais, sem flag) | Baixa |
| Refs de evento NULLadas (evento ausente da aba Eventos) | 59 | — | vínculo perdido (recuperável no raw) | Baixa |

**Por que importa (e por que não é incêndio hoje):** o app lê da **planilha**, não do Neon — então **nenhuma tela de operador está quebrada**. Mas o Neon é consultado ad-hoc (ex.: "quantas máquinas perdidas?") e **responde 5 em vez de ~47**; e no **cutover da Onda 6** (Neon como fonte) esse passivo sumiria de vez. As linhas cruas ficam preservadas em `staging.*` (nada é destruído).
**Recomendação (decisão sua, pré-cutover):** (a) normalizar serial no JOIN (`upper(btrim())`); (b) marcar `motivo_revisao='serial_orfao'` nesses casos (fim do descarte silencioso); (c) repensar a FK `NOT NULL` para perda/troca/localizar — a máquina defeituosa/perdida **sai do parque por natureza**, então exigir que ela exista em `maquina` é incompatível com a semântica. **Nenhuma ação automática — só reportando.**

---

## 🟡 Curadoria de dados vivos (decisão sua — NENHUMA limpeza automática)
Achados reais na planilha, que pedem decisão humana (não são bug de código):
- **5 seriais em CONTROLE (Em Uso) *e* PERDIDAS ao mesmo tempo** (contradição perdida×em-uso). Ex.: `PBA1245G74140`, `PBA1245G74251`, `PBA1246T74847` (Mossoró Trap), `PBA123B373001`, `PBA1233870901`. ~0,9% da frota; já marcados `serial_multi_aba`. → decidir qual fonte vale.
- **10 máquinas "Em Uso SP" sem id_evento** (`N/A`) — em campo sem saber em qual evento; 6 com retorno já vencido (a mais antiga desde 2023). → vincular evento ou reclassificar.
- **64 de 77 máquinas em ESTOQUE ainda carregam data de saída/retorno** (59 ainda com id_evento) do ciclo anterior — a planilha/GAS não limpa N/O na baixa manual. A UI já mascara (mostra "-"), mas vaza pro Neon. → decidir: limpar N/O na baixa ou preservar como "última movimentação".
- **6 movimentos com data de retorno ANTES da saída** (typo na planilha; benigno — a view de prazo só olha EM_USO). → corrigir na planilha se quiser.
- **28 eventos com comercial divergente** (mesmo id, comerciais diferentes; a dedup escolhe a última linha). Latente hoje (nenhum consumidor usa `evento.comercial`), relevante se virar base de comissão. → definir valor canônico.
- **~23 de 47 perdidas sem id_evento** (parte com o id embutido no texto, recuperável por regex). → curadoria.

---

## 🟢 Hardening de código — CORRIGIDO nesta leva (branch `fix/auditoria-datas-cliente`)
Reais porém baixos (a verificação adversária confirmou que o uso normal **não** dispara nenhum deles — só POST forjado por usuário já autenticado, ou fluxo ainda gated). Corrigidos por serem baratos e corretos:
1. **Filtro "Este Mês" ignorava o ano** + filtros de retorno e recálculo pós-Salvar usavam relógio do navegador → agora usam **"hoje BRT" injetado pelo servidor** (`maquinas.ejs`); default de data do Envio idem (`envio.ejs`). *(Este era o único com impacto no uso normal: "Este Mês" listava retornos de julho de qualquer ano.)*
2. **Allow-list de `status`** + limpeza case-insensitive em `POST /api/atualizar-status` (antes qualquer string ia pra planilha).
3. **Validação estrita de data no envio** (data fora de faixa/ inválida → 400, em vez de normalizar em silêncio).
4. **`registrarTroca`/`enviarParaLocalizar`** passam a checar o retorno da escrita de status + rollback (simetria com `marcarPerdida`) — fecha a falha silenciosa **antes** de o flag `EXCECOES_ATIVAS` ser ligado.

## Reportado (não corrigido — decisão/observação)
- **`/atualizar-status` seta "Em Uso" sem exigir evento nem gravar HISTÓRICO** (contorna a atomicidade do fluxo de Envio). → decidir se o dropdown deve permitir "Em Uso" ou forçar pela tela de Envio.
- **Cache de "evento não existe" (5min, por instância)** pode dar 404 falso pós-cadastro — só em cenário multi-instância concorrente (raro em app de ~7 usuários; auto-cura em ≤5min). → mitigável, mas de baixo retorno.
- **CSRF passa sem Origin/Referer** — irrelevante na prática (sameSite=lax + requireLogin cobrem). → hardening opcional.
- **Escritas retornam boolean** (engolem o erro) — é **intencional** (alimenta o rollback quase-atômico); erro real fica no log da Vercel. Não mexer.
- **Sentinelas (01/01/2040, 15/07/1905) viram NULL sem flag** no sync — **deliberado** (marcadores de "vazio/aberto" das abas não gerenciadas); o raw é preservado.

## Contrato da planilha — OK
Todos os índices de coluna e ranges LIDOS/ESCRITOS (CONTROLE `A2:P`, HISTORICO `A2:K`, DADOS EVENTOS `A2:D`, PERDIDAS `A2:P`, TROCAS `A2:D`, LOCALIZAR `A2:K`) batem 1:1 com o documentado. Tabelas finais do Neon **100% íntegras** (0 serial vazio/duplicado, 0 FK órfã) — a perda está toda na *promoção* (acima), não nas finais.

---
*Nenhum dado da planilha ou do Neon foi alterado nesta auditoria (só leituras/SELECT).*
