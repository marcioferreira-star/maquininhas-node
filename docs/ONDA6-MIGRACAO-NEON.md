# Onda 6 — Migração Sheets → Neon/Postgres

**Data:** 10/07/2026 · Base do plano: `docs/AUDITORIA-2026-07-10.md` (Plano B).
**Estado:** BASE PREPARADA (sem tocar produção). Falta: projeto Neon + `DATABASE_URL`, decisões humanas, e a execução das fases 3-6.

Princípio: **o custo real é a curadoria dos dados e a transição operacional, não a infra.** ~552 máquinas cabem em qualquer plano free do Neon.

---

## O que já está pronto neste branch
- **`db/schema.sql`** — schema final Postgres/Neon (enums, 6 tabelas `maquina/evento/movimento/perda/troca/localizacao`, view `vw_maquina_prazo`, schema `staging`). Ainda **não aplicado** (falta `DATABASE_URL`).
- **`tools/etl/diagnostico-dados.js`** — script READ-ONLY que lê as 6 abas e gera os TSVs "Revisar" da curadoria. Rodar: `node tools/etl/diagnostico-dados.js [dir_saida]`.

Nada aqui é importado pelo app (`app.js`) — é inerte, não afeta produção.

---

## Diagnóstico de dados (rodado em 10/07 contra a planilha real)

Linhas por aba: CONTROLE **552** · HISTORICO **1394** · DADOS EVENTOS **3231** · PERDIDAS **47** · TROCAS **26** · LOCALIZAR **15**.

Curadoria — o que precisa de DECISÃO HUMANA (TSVs gerados):

| Categoria | Qtd | O que é | Tratamento |
|---|---|---|---|
| Datas suspeitas | **10** | não-datas em coluna de data (ex.: "GRÊMIO" em Data Retorno, "0/12", "JURÍDICO") | Revisar 1 a 1 → NULL ou correção |
| Sentinelas (auto) | 33 | `01/01/2040` / `15/07/1905` | Automático → NULL (não é Revisar) |
| id_evento inválido | **101** | id = "N/A" com nome (ex.: "GRUPPO"/"NORDESTE") | Revisar: achar o id real ou deixar sem vínculo |
| Eventos divergentes | **302 linhas / 139 ids** | mesmo id, dados diferentes (produtora/comercial/nome) | ETL faz `DISTINCT ON` pegando o mais completo; só o conflito real (produtora≠) vai a Revisar |
| Serial duplicado (CONTROLE) | **0** | — | ✅ nada a fazer |
| Serial em >1 aba | **5** | "Em Uso SP" na CONTROLE **e** na PERDIDAS (conflito em uso × perdida) | Revisar: qual estado é o verdadeiro |
| Status fora do mapa | **0** | — | ✅ todos batem Estoque/Em Uso/Fixo × SP/RJ/URA |
| PERDIDAS: texto em data | **4** | "JURÍDICO"/"MENSAL" na coluna de data | → mover p/ `status_perda`, data NULL |
| LOCALIZAR resolvidas | 0 | "*ela voltou" etc. | — |

> Os TSVs completos ficam fora do repo (contêm serial/nome de evento). Regenerar com o script quando precisar.

---

## Fases (com critério de PRONTO)

| Fase | Entrega | Pronto quando | Depende de |
|---|---|---|---|
| **0 — Decisões** | Clonar GAS bound (`pintarProximosEnvios`); conferir locale da planilha; decidir espelho×aposentar; criar projeto Neon + `DATABASE_URL` | Decisões registradas; conexão validada | **Marcio** (acesso clasp + conta Neon) |
| **1 — Schema** | Aplicar `db/schema.sql` num branch Neon | `npm run migrate` idempotente do zero | `DATABASE_URL` |
| **2 — ETL + curadoria** | `diagnostico-dados.js` (feito) → decisões do Marcio nos TSVs → script de promoção staging→public | Todo "Revisar" decidido; zero violação de FK/UNIQUE/CHECK | **Marcio** decide os TSVs |
| **3 — Repositório + shadow** | `src/repo/*` (pg) atrás de flag `DATA_BACKEND`; hook shadow (Sheets primário, PG cópia); `parity.js` | 7 dias com paridade diff=0 | Fase 1-2 |
| **4 — Cutover** | `DATA_BACKEND=pg`; espelho best-effort pós-commit; precondições server-side | 14 dias PG-primário sem rollback | Fase 3 |
| **5 — Telas de exceção** | (já existem — Onda 5; ligar `EXCECOES_ATIVAS`) | — | — |
| **6 — Aposentar Sheets** | Espelho read-only ou desligar + reimplementar realce | 30 dias sem escrita manual | Fase 4 |

---

## O que depende de DECISÃO/ACESSO do Marcio (para destravar a fase 0)
1. **Autorizar clonar o Apps Script bound** (`pintarProximosEnvios`) via clasp — pra saber o que ele faz antes de mexer na planilha (hoje é caixa-preta, fora da conta clasp).
2. **Criar projeto Neon** e me passar a `DATABASE_URL` (pooled) — ou me autorizar a criar.
3. **Decidir**: Sheets vira espelho read-only alimentado pelo app, ou é aposentado?
4. **Curadoria**: decidir os TSVs "Revisar" (datas, ids N/A, serial em 2 abas). Eu sinalizo, você decide.

Ganho da migração (cada um mata um achado da auditoria): atomicidade real (transação), concorrência resolvida (`FOR UPDATE`), integridade (enum/UNIQUE/FK/CHECK), bug de fuso morto por design, fim do `USER_ENTERED`, erro≠vazio, identidade única do parque (perdida deixa de contar como disponível).
