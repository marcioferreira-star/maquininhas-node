# Cutover Neon — Checklist de decisões (Marcio bate o martelo)

Estas 8 decisões **destravam o cutover de ESCRITA (Fase 4)**. As **Fases 0–1 (leitura) já estão feitas e em prod**, dormentes (`READ_BACKEND` não setado). A Fase 2 (servir leitura do Neon) **não** depende destas decisões — só a escrita depende. Para cada item: **pergunta → opções → recomendação → o que destrava**.

Atalho: se você concordar com todas as recomendações, é só responder **"aceito as recomendações"** e eu sigo por elas.

---

## ✅ DECIDIDO (11/07) — Marcio aceitou as recomendações

| # | Decisão | Ação decorrente / bloqueio |
|---|---|---|
| 1 | Clonar o GAS bound (read-only) | **PENDENTE** — preciso do `scriptId` do Apps Script bound (ou você adicioná-lo à conta clasp). Sem ele não clono. |
| 2 | Planilha = **espelho vivo permanente** | Fase 5 (aposentar) **não será feita**. Nada a executar. |
| 3 | 5 seriais | **PBA1233870901, PBA1245G74251, PBA1246T74847, PBA1245G74140 → "Perdida"**; **PBA123B373001 → mantém "Em Uso"**. AÇÃO: mudar a col G (status) desses 4 na CONTROLE (⚠️ ver nota abaixo). |
| 4 | Curadoria | Agendar **antes da Fase 4**. Sob demanda — eu regenero os TSVs quando você sentar nisso. |
| 5 | App = canal oficial de exceção | Já ligado (`EXCECOES_ATIVAS=1`). Proteger a CONTROLE só na Fase 4. |
| 6 | Defasagem de 15 min | **Aceita** (libera a Fase 2). |
| 7 | Janela ≤1h na Fase 4 | **Aceita** — agendar em horário sem evento. |
| 8 | Neon: branch de segurança antes da Fase 4 + autosuspend | **Aceito**. Crio o branch na véspera da Fase 4. |

**⚠️ Nota sobre o item 3 (correção dos 4 seriais):** os 4 já estão em PERDIDAS, então a correção é só mudar o **status na CONTROLE p/ "Perdida"** (não usar o fluxo do app, que duplicaria em PERDIDAS). O `sheets-mcp` usa a SA `meep-coletor-sa`, que provavelmente **não tem escrita** nessa planilha (a app usa `maquinas-dashboard@`). Então: **você edita a col G dos 4 na planilha** (30s), ou me confirma que quer que eu tente pela SA da app. Correção **na planilha** (o sync propaga; corrigir no Neon é desfeito).

---

## 1. Clonar o GAS bound (`pintarProximosEnvios`) via `clasp` — só leitura
- **Por quê:** o script bound da planilha é caixa-preta; escrita via API **não dispara `onEdit`**. Antes de mexer na escrita precisamos saber COMO ele é disparado (senão o realce da planilha morre no cutover).
- **Opções:** (a) clonar read-only (sem versionar, sem deploy) só p/ ler o gatilho · (b) não clonar (arriscar no escuro).
- **✅ Recomendação:** **(a)** clonar read-only. É reversível, não toca a planilha, e é pré-requisito duro da Fase 4. Você revisitaria a recusa de 09/07 (mas agora sem versionar).
- **Destrava:** Fase 4 (cutover de escrita).

## 2. Destino da planilha
- **Pergunta:** a planilha continua como **espelho vivo permanente** (todos leem/editam) ou vai ser **aposentada** um dia?
- **✅ Recomendação:** **espelho vivo permanente** (a Fase 5 "aposentar" fica indefinidamente adiada). O GAS + o hábito dos operadores não pagam o custo/risco de aposentar agora.
- **Destrava:** define se a Fase 5 existe.

## 3. Os 5 seriais "Em Uso × Perdida" — qual estado vale?
Máquinas que estão **"Em Uso" na CONTROLE** mas também aparecem em **PERDIDAS**. Retorno vencido há muito + notas de perda:

| Serial | CONTROLE (status / evento / retorno) | Nota em PERDIDAS | Sugestão |
|---|---|---|---|
| **PBA1233870901** | Em Uso SP · Criativa (id N/A) · **11/06/2023** | "não encontrada na pág, provavelmente cadastraram incorretamente" | → **Perdida** (vencida há ~3 anos + nota) |
| **PBA1245G74251** | Em Uso SP · Mossoró Trap Festival · **26/04/2025** | "Produtor sumiu" | → **Perdida** |
| **PBA1246T74847** | Em Uso SP · Mossoró Trap Festival · **26/04/2025** | "Produtor sumiu" | → **Perdida** |
| **PBA1245G74140** | Em Uso SP · São João Campina Grande 2025 · **07/07/2025** | envio 15/04/2025, sem nota | → **Perdida** (vencida ~1 ano) |
| **PBA123B373001** | Em Uso RJ · ITAGUAÍ FESTIVAL 2026 · **06/04/2026** | "sem historico" | → **manter Em Uso** (evento recente, perda parece entrada solta) |
- **Como corrigir:** **na PLANILHA** (o sync propaga; corrigir no Neon é desfeito no próximo ciclo). Mudar o status na CONTROLE p/ "Perdida" tira das contagens.
- **✅ Recomendação:** 4 viram **Perdida**, PBA123B373001 fica **Em Uso**. (Você confirma caso a caso.)
- **Destrava:** Fase 4 (identidade única exige 1 estado por máquina).

## 4. Retomar a curadoria (hoje pausada)
- **Pergunta:** quando revisar os TSVs de dados-lixo (10 datas suspeitas, ~101 ids "N/A", 28 comerciais divergentes, 64 Estoque com resíduo)?
- **✅ Recomendação:** **não bloqueia a Fase 2** (leitura). Agendar a revisão **antes da Fase 4** (escrita). Eu regenero os TSVs quando você quiser sentar nisso.
- **Destrava:** Fase 4.

## 5. Fluxo dos operadores nas exceções
- **Pergunta:** o app vira o **canal oficial** de perda/troca/localizar (já está ligado, `EXCECOES_ATIVAS=1`)? E, na Fase 4, aceitar **proteger a CONTROLE** contra edição manual?
- **✅ Recomendação:** **sim** ao app como canal oficial (validar a 1ª escrita real — gotcha do intervalo protegido). Proteção da CONTROLE **só na Fase 4** (com aviso aos operadores).
- **Destrava:** consistência na Fase 4.

## 6. Tolerância a defasagem do espelho
- **Pergunta:** aceitar até **15 min** de atraso do Neon quando alguém edita a planilha à mão (durante as Fases 2–3)?
- **✅ Recomendação:** **sim** (encurtar o cron custa quota da API Sheets; já existe o botão "Sincronizar agora" p/ forçar).
- **Destrava:** Fase 2.

## 7. Janela de congelamento da Fase 4
- **Pergunta:** aceitar uma janela curta (**≤1h, em horário sem evento**) p/ o sync final + flip da escrita?
- **✅ Recomendação:** **sim**, agendada com você, fora de operação.
- **Destrava:** Fase 4.

## 8. Neon — backup e autosuspend
- **Pergunta:** confirmar **PITR / branch de segurança** antes da Fase 4 e a política de **autosuspend** (cold start de leitura)?
- **✅ Recomendação:** criar um **branch Neon de segurança** antes da Fase 4; autosuspend ok p/ leitura (cold start raro, cache de 15s absorve).
- **Destrava:** Fase 4 (rede de segurança).

---

### Resumo do caminho
- **Fases 0–1 ✅ feitas** (leitura fundação, dormant).
- **Fase 2** (servir leitura do Neon, `/historico` primeiro) → só precisa de shadow do `parity.js` estável (sob demanda) + seu OK. **Decisões 6 é a única relevante aqui.**
- **Fase 4** (cutover de escrita) → precisa de **1, 3, 4, 5, 7, 8** decididas.
- **Fase 5** (aposentar) → decisão **2** (recomendação: não fazer).
