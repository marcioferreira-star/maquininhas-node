# Plano de Cutover — maquininhas-node: Google Sheets → Neon Postgres

**Data:** 2026-07-11 · **Autor:** plano do Fable (arquiteto), revisado pelo Opus · **Status:** aguardando decisões do Marcio (§6) + aprovação da Fase 0–1

Base de leitura: `src/db.js`, `src/sheet.js`, `src/sync-neon.js`, `src/routes/api.js`, `src/excecoes.js`, `db/schema.sql`, `docs/ONDA6-MIGRACAO-NEON.md`, `docs/AUDITORIA-2026-07-10.md`, `docs/AUDITORIA-DADOS-2026-07-10.md`.

## TL;DR — recomendação honesta

**NÃO fazer full-retire da planilha agora.** O passo certo é um cutover **de LEITURA** (telas servidas pelo Neon, rápido) mantendo a **escrita no Sheets como fonte primária**, com espelhamento pontual pós-escrita no Neon ("dual-apply" best-effort) e o sync de 15 min como autocura. Motivos (verificados):

1. **A promoção do sync descarta órfãos** (42 perdas, 25 trocas, 15 localizar, 40 movimentos — `PROMOCAO_SQL` faz `JOIN maquina ON serial` com FK `NOT NULL`). Cutover em cima disso = perda silenciosa de dado → precisa de **schema/sync v2 antes**.
2. **O GAS bound é caixa-preta** (`pintarProximosEnvios`, fora do repo). Aposentar a planilha mata isso sem sabermos o que morre.
3. **Operadores editam 4 abas à mão** (PERDIDAS/TROCAS/LOCALIZAR e provavelmente CONTROLE). Neon-primary sem migrar esse fluxo cria divergência bidirecional.
4. **Curadoria PAUSADA** a pedido do Marcio (101 ids "N/A", 10 datas suspeitas, 5 seriais em conflito). Escrita Neon-primary com constraints rejeitaria/mascararia esse passivo.

O ganho grande (dashboard/histórico rápidos, fim da latência do Sheets nas leituras) vem já na Fase 2, sem queimar nenhuma ponte.

## 1. Leitura — `db.js` consultando o Neon sem quebrar o contrato

Contrato atual que NÃO pode mudar: `getMaquinas()` (status string "Em Uso SP", datas "dd/mm/aaaa", vazios "-"), `getMaquinasIndex()` (Map serial→maquina + `duplicados`), `getResumo()` (delega a `resumoDeMaquinas()` pura), `getHistorico()`, `getEventoInfo(id)`.

- **`src/repo/`** com 2 adapters de MESMA interface: `repo/sheets.js` (corpo atual do db.js) e `repo/neon.js` (novo, `pg.Pool` com a `DATABASE_URL` pooled). `db.js` vira seletor por flag.
- **Flags por função** (`READ_BACKEND=sheets|neon` + overrides finos) — rollback = flip de env + redeploy (~1 min).
- **Adapter neon recompõe o shape do Sheets** (status+local→string, DATE→"dd/mm/aaaa", NULL→"-", processando bool→"Sim"/"-") → `dominio.js`/`datas.js` intocados.
- ⚠️ **`getEventoInfo` e `getMaquinasIndex` do caminho de ESCRITA ficam no Sheets** enquanto o Sheets for primário (senão evento recém-cadastrado dá 404 por até 15 min, e o índice de linhas fica defasado).

**Lacunas de paridade bloqueantes (exigem schema/sync v2 ANTES do corte de leitura):**
1. **Órfãos**: `maquina_id` NULLABLE + coluna `serial TEXT` preservada + `LEFT JOIN` na promoção + `motivo_revisao='serial_orfao'`. Sem isso `/historico` perde 40 linhas, `/excecoes` perde 42/25/15.
2. **Denormalizados do HISTORICO**: promover `nome_evento_raw/produtora_raw/comercial_raw` (já estão no `raw JSONB` do staging) — senão ~101 linhas com id "N/A" mostram "-".
3. **`status_raw` em `maquina`**: guardar o texto cru (hoje `WHERE status IS NOT NULL` sumiria com status novo digitado à mão).
4. Diffs conhecidos e aceitos (whitelistar no parity): sentinelas 2040/1905→NULL, empresa COALESCE, retorno NULL em FIXO.

## 2. Escrita — opções e recomendação

Hoje: resolve linha por serial (índice fresco) → `batchUpdateValues` CONTROLE → append HISTORICO → rollback do CONTROLE se o log falhar. Quase-atômica.

- **(a) Dual-write — Sheets primário + espelho pontual no Neon** ("dual-apply"): após gravar no Sheets, aplica a mesma mutação no Neon (best-effort, sem rollback cruzado); o sync de 15 min (TRUNCATE+reload) autocura. ✅ Read-your-writes, planilha viva (GAS/operadores intactos), rollback trivial, consistência eventual garantida por construção. ❌ Duas escritas (+100–300ms), código duplicado (2 statements simples), janelas de 15 min iguais a hoje.
- **(b) Neon-primary + Sheets secundário**: app grava no Neon em transação (`FOR UPDATE`, atomicidade REAL) e replica pro Sheets best-effort. ✅ Mata os achados da auditoria (atomicidade, concorrência, enum/FK/CHECK, fim do USER_ENTERED). ❌ Só funciona se os operadores **pararem de editar a CONTROLE à mão**; e escrita via API **não dispara `onEdit`** → se `pintarProximosEnvios` depende disso, o realce morre. **Estado final natural, não o primeiro passo.**
- **(c) Neon-only, planilha aposentada**: ✅ arquitetura limpa. ❌ mata o GAS bound, mata a superfície dos operadores, exige curadoria 100%, **irreversível na prática**. Zero razão agora.

**✅ Recomendação:** **agora (a)**; **depois (b)** como cutover de escrita quando o Marcio decidir o §6; **(c) adiado indefinidamente**. Com curadoria pausada e GAS não clonado, **qualquer cutover de escrita agora seria imprudente**.

## 3. GAS bound + operadores
- `pintarProximosEnvios` é bound à planilha, invisível ao repo, e `onEdit` simples **não dispara** para escritas via API. **Clonar via `clasp clone` (só leitura, sem deploy) é pré-requisito de qualquer fase de escrita.** (Revisitar a recusa de 09/07 — dá pra clonar sem versionar.)
- Aposentar a planilha um dia: portar o realce pro app é trivial (a tela Máquinas já calcula `situacaoDeMaquina`); o custo real é **migrar o hábito dos operadores**, não o código.
- PERDIDAS/TROCAS/LOCALIZAR já têm fluxo no app (`/excecoes`, gated). Plano: ligar o flag, validar (gotcha: intervalo protegido exige a SA `maquinas-dashboard@…` como editora), depois propor exceções só pelo app.

## 4. Gate de curadoria
**Regra de ouro enquanto a planilha for primária: curadoria se aplica NA PLANILHA** (o sync propaga; corrigir no Neon é desfeito pelo próximo TRUNCATE+reload).
- **Bloqueia leitura via Neon:** só os órfãos + denormalizados ausentes (itens 1–2 do §1 — correção de CÓDIGO, não curadoria de dado).
- **Bloqueia escrita Neon-primary:** datas suspeitas, os 5 seriais em conflito, decisões de resíduo — curadoria humana dos TSVs (`tools/etl/diagnostico-dados.js`).
- **O cutover de LEITURA não espera a curadoria; o de ESCRITA espera.**

## 5. Rollout faseado (cada fase com rollback)

| Fase | Entrega | Pronto quando | Rollback |
|---|---|---|---|
| **0 — Fundação** | Schema/sync v2 (órfãos, denormalizados, `status_raw`); `tools/parity.js` | Sync v2 no cron; parity executável | Nada user-facing mudou |
| **1 — Adapter + shadow** | `src/repo/{sheets,neon}.js` atrás de `READ_BACKEND` (default sheets); parity 7 dias diff=0 | 7 dias limpos | Flag nunca ligada |
| **2 — Corte de LEITURA por rota** | `/historico` → dashboard+`/maquinas` → leituras de `/excecoes`. Escrita segue no Sheets | 7 dias/rota sem regressão | Flip da env por rota (~1 min) |
| **3 — Dual-apply** | Espelho pontual Neon pós-escrita; `/envio` também lê do Neon | 14 dias sem divergência não-autocurada | Desliga o espelho |
| **4 — Corte de ESCRITA (b)** ⚠️ *gated pelo §6* | Neon-primary transacional + espelho reverso; proteção de intervalo; janela de congelamento ≤1h | 14–30 dias estável | Flip de flag + 1 sync de reconciliação |
| **5 — (opcional, meses) Aposentar** | Sheets vira export; GAS portado | Decisão explícita + 30 dias sem escrita manual | **Sem rollback barato — por isso é último** |

**Aprovação pedida agora: Fases 0–1** (zero impacto em produção, tudo atrás de flag/ferramenta).

## 6. DECISÕES que só o Marcio pode tomar
1. **Clonar o GAS bound via `clasp` (read-only)** — pré-requisito das fases 3–4.
2. **Destino da planilha:** espelho vivo permanente (recomendado) × aposentadoria futura (define se a fase 5 existe).
3. **Os 5 seriais "Em Uso × Perdida"** (`PBA1245G74140`, `PBA1245G74251`, `PBA1246T74847`, `PBA123B373001`, `PBA1233870901`): qual estado vale?
4. **Retomar a curadoria** (hoje pausada): quando revisar os TSVs (10 datas, ~101 ids N/A, 28 comerciais divergentes, 64 Estoque com resíduo)?
5. **Fluxo dos operadores:** tornar o app o canal oficial de perda/troca/localizar? Aceitar proteger a CONTROLE contra edição manual na fase 4?
6. **Tolerância a defasagem:** aceitar até 15 min de atraso do Neon em edições manuais durante fases 2–3?
7. **Janela de congelamento da fase 4** (≤1h em horário sem evento) — aceitável?
8. **Neon:** confirmar plano/backup (PITR/branch antes da fase 4) e autosuspend.

## 7. Riscos principais
- Perda silenciosa de dado (órfãos) — **Alta** → Fase 0 obrigatória + parity por contagem.
- GAS para de repintar (escrita via API ≠ onEdit) — Alta na fase 4 → clonar/ler o script ANTES.
- Divergência Sheets×Neon — Média → dual-apply best-effort + autocura de 15 min + parity contínuo.
- Irreversibilidade da fase 5 — Alta → não fazer agora; fase 4 mantém espelho reverso (rollback barato).
- Neon indisponível pós-corte de leitura — Baixa → fallback automático do adapter pro Sheets.

## Arquivos-chave
`src/db.js` (seletor de backend) · `src/sync-neon.js` (schema/sync v2 + dual-apply) · `src/routes/api.js` (escrita) · `db/schema.sql` (migration v2) · `src/excecoes.js` (adapter já isolado).
