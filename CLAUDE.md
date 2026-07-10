# maquininhas-node

Sistema web de controle de maquininhas de pagamento PagSeguro/Ingresse: envio, retorno
e status de hardware de checkout para eventos. Estoque em **SP, RJ e URA**.

## Stack
- Node.js + Express + EJS (ESM — `"type": "module"`, use `import`, **nunca `require`**)
- Google Sheets como banco (service account)
- Sessão via `cookie-session` (cookie assinado, sem store em memória); usuários em `src/auth/users.json` (bcrypt)
- Deploy: **Vercel** (serverless, auto-deploy no push à `main`) — `https://maquininhas-node.vercel.app`.
  Render foi descontinuado (migração 14/06/2026). Roda LOCAL via `npm start` (server.js → app.js).

## Estrutura
- `src/app.js` — configuração do Express (middlewares, sessão, rotas) — **exporta o `app`**
- `src/server.js` — entrypoint LOCAL (importa `app.js` e dá `listen`)
- `api/index.js` — handler serverless da Vercel (reusa o `app`)
- `vercel.json` — roteia tudo para a função + `includeFiles: src/**` (views EJS / estáticos)
- `src/db.js` — camada de dados + cache (máquinas 15s, eventos 5min)
- `src/sheet.js` — wrapper Google Sheets v4 (batch updates)
- `src/utils/datas.js` — helpers de data em horário LOCAL (ver abaixo)
- `src/routes/` — login, index (dashboard), maquinas, envio, historico, api
- `src/views/` — EJS + partials
- `src/auth/` — middleware de sessão, `createUser.js`, `users.json`

## Planilha (6 abas — o app só conhece 3)
O app lê/escreve APENAS estas 3:
- `CONTROLE MAQUININHAS PAGSEGURO - INGRESSE` — cadastro. Colunas USADAS:
  B=modelo, C=serial, G=status, I=empresa, J=idEvento, K=nomeEvento, L=produtora,
  M=comercial, N=dataSaída, O=dataRetorno. ⚠️ A leitura para em O de propósito;
  **D=Operadora, E=Info Chip, F=verificação, H=Processando?, P=OBSERVAÇÃO, R=Count são IGNORADAS**.
- `HISTORICO MAQUINAS` — log de movimentos (cols A–K; col F "Status" é texto congelado, o app recalcula ao vivo e ignora).
- `DADOS EVENTOS` — cadastro de eventos (cols A–D).

⚠️ **Existem +3 abas que o app NÃO conhece** e os operadores editam à mão (origem provável das datas-lixo `01/01/2040`, `15/07/1905`):
- `PERDIDAS PAGSEGURO - INGRESSE` (máquinas perdidas; schema próprio, col J="Responsável" ≠ Produtora)
- `TROCAS` (defeituosa→nova: Maq com Defeito, Problema, Local, NOVA)
- `LOCALIZAR` (mesmo layout da CONTROLE; máquinas a localizar)

Fluxo: Envio → "Em Uso"/"Fixo" → Retorno → "Estoque". Status "Fixo" não tem retorno.

## ⚠️ Datas (regra crítica)
Regra transversal (nunca `new Date('YYYY-MM-DD')` — ver manual raiz `~/.claude/CLAUDE.md` §5).
Específico daqui: datas na planilha são **BR `dd/mm/aaaa`** (`new Date("dd/mm/aaaa")` é inválido);
sempre usar os helpers de `src/utils/datas.js` (`parseBRDate`, `startOfDayLocal`, `diffDiasDeHoje`)
e comparar **só a data** (sem hora) — vencimento HOJE conta como no prazo. No cliente (EJS),
parsear com `new Date(ano, mes-1, dia)`.

## Automação GAS da planilha (script bound)
A planilha `CONTROLE MAQUININHAS PAGSEGURO - INGRESSE` tem um Apps Script **bound** (fora deste
repo) com as automações de aba. Regra fixa: **toda automação de envio termina chamando
`pintarProximosEnvios`** (repinta a faixa de próximos envios) — sem isso a planilha fica com
destaque defasado. (Clonar o script via `clasp clone` para `apps-script/` fica como opcional —
o Marcio decidiu não versionar por ora, 09/07/2026; o script não está na conta clasp dele.)

## Régua de qualidade (entregável correto =)
- `npm test` (datas) e `npm run lint` verdes.
- Envio grava CONTROLE + HISTORICO ou nada (rollback) — nunca meia-operação.
- Linha resolvida SEMPRE pelo serial (nunca pelo índice vindo do front).
- Datas comparadas sem hora; vencimento hoje = no prazo.
- Após automação de envio na planilha, `pintarProximosEnvios` executado.

## Variáveis de ambiente (.env / Vercel)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON da service account (obrigatório)
- `SPREADSHEET_ID` — id da planilha (tem default no código)
- `SESSION_SECRET` — **definir em produção** (senão usa valor inseguro com aviso no log)
- `NODE_ENV` — **não setar na Vercel** (ela já põe `production` sozinha; setar `development` desliga o cookie `secure`). Local usa `.env`.
- `PORT` — opcional, só local (default 3000). Ignorado em serverless.

Na Vercel as 3 primeiras estão em **Production + Preview**. Deployment Protection (Vercel
Authentication) está **desligada** — o acesso é controlado pelo login do próprio app.

## Rodar local
1. Criar `.env` com `GOOGLE_SERVICE_ACCOUNT_JSON` e `SPREADSHEET_ID` (já no `.gitignore`).
2. `npm install` → `npm run dev` (nodemon) ou `npm start`.
3. Criar usuário: `node src/auth/createUser.js`.

---

## Histórico de mudanças por agentes

### 2026-07-10 — Auditoria minuciosa + Ondas 0/1/2/3 (branches `feat/onda0-blindagem-e-fuso`, `feat/onda2-robustez`, `feat/onda3-operador`)
- **Auditoria multi-agente** (Opus análise+verificação, Fable planejamento): 82 achados, 79 confirmados, 0 refutados, 16 altos. Doc completo: `docs/AUDITORIA-2026-07-10.md`.
- **Onda 1 — bug de fuso (CRÍTICO p/ dados):** `utils/datas.js` agora deriva "hoje" de `America/Sao_Paulo` via Intl (`hojeBR()` novo + `startOfDayLocal()` corrigido) — **não depende mais do TZ do processo**. Na Vercel (UTC) o código antigo gravava retorno com data de amanhã e contava atraso 1 dia cedo entre 21h-24h BRT. `api.js` usa o `hojeBR()`/`parseBRDate` canônicos (removida a duplicação). Teste de regressão em `datas.test.js` (roda em fusos que diferem 25h).
- **Onda 0 — blindagem:**
  - CI: `.github/workflows/ci.yml` roda lint+test em todo push/PR (antes nada rodava; auto-deploy na main).
  - `SESSION_SECRET` **fail-closed** (`app.js` dá `throw` em produção sem a env). ⚠️ **Rotacionar a chave** — o literal antigo `super-secret-ingresse` estava no git.
  - Headers de segurança (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS em prod) + `disable('x-powered-by')`.
  - **Validação de status no BACKEND** (`api.js`): Envio exige Estoque, Retorno exige Em Uso/Fixo; recusa **serial duplicado** na CONTROLE; valida `retorno >= saida`.
  - `login.js`: try/catch + validação de body (fim do 500/pendura) + `bcrypt.compare` dummy contra timing.
  - `db.js`: ranges ABERTOS `A2:O` / `A2:K` (fim do truncamento); `invalidarCacheMaquinas()` chamado após escrita; índice detecta seriais duplicados.
  - HTTP status reais (400/404/409/422/500) nas rotas de API; política ÚNICA no retorno (limpa J..M no CONTROLE, mantém vínculo no HISTÓRICO).
  - Higiene: `engines`+`.nvmrc` (Node 20), footer com ano dinâmico, contraste do badge "Vence hoje", `alt` no logo do login, comentário ESLint 10.
- **Onda 2 — robustez & testabilidade (branch `feat/onda2-robustez`, stacked sobre a onda0):**
  - **Auth lazy** em `sheet.js` (`getSheetsClient()` memoizado) — importar a camada de dados não explode mais no load; destrava testes e evita crash de cold start por env faltando.
  - **Erro ≠ vazio:** `getSheetData` PROPAGA erro (não vira `[]`); `getMaquinas`/`getMaquinasIndex`/`getResumo`/`getHistorico` propagam; as rotas passam `erro:true` → **banner** nas views (fim do "0 máquinas" silencioso). `getEventoInfo` **não cacheia null em erro de leitura** (fim do falso "ID não existe" grudado 5 min); `api.js` devolve **503** (planilha indisponível) ≠ **404** (ID não existe).
  - **Lógica pura extraída** p/ `src/utils/dominio.js` (`resumoDeMaquinas`, `montarHistorico`) + `test/dominio.test.js` — cobre baldes de status, atrasadas (vence hoje = no prazo), e o **fix do "Envio Fixo devolvido"** (antes travava em "Fixo", agora "Devolvida").
- **Onda 3 — experiência do operador (branch `feat/onda3-operador`, stacked sobre a onda2):**
  - **KPIs do dashboard clicáveis** (`index.ejs`): cada card abre `/maquinas` já filtrado por querystring (`?f=estoque|em uso|fixo`, `?retorno=atrasada`). `maquinas.ejs` lê a querystring no load (filtro por substring de status). Resolve a pergunta nº1 "o que está atrasado?".
  - **Lookup ao vivo + cadastro de evento no app** (A8): `GET /api/evento/:id` (eco do nome no blur do ID no Envio — verde "Evento: Nome — Produtora", ou vermelho "não encontrado" + botão) e `POST /api/evento` (`db.js:cadastrarEvento` → append em DADOS EVENTOS + invalida cache). Mata a ida ao Sheets no meio do envio e o envio para evento errado por dígito trocado.
  - **Data de envio default = hoje** (horário local do cliente, nunca ISO/UTC) no Envio.
- **DEFERIDO (ondas seguintes / decisão):** scanner de código de barras e toast/atualização in-place (entram no design system, onda 4); exibir OBSERVAÇÃO/Operadora/Chip (col D/E/P) na tela Máquinas; gravar datas como `RAW` (A2 — precisa smoke test do GAS bound); ping Slack no erro de leitura (precisa webhook). Migração Neon, telas de exceção: ondas 5-6.
- Testes **13/13** verdes, lint limpo. Smoke: boot OK (login 200, rota protegida 302, body vazio 400, CSRF 403) + leitura end-to-end na planilha real (553 máq, 1394 mov, resumo coerente). Onda 3: `GET /api/evento/:id` validado read-only (evento real encontrado, inexistente→null) + boot com rotas novas registradas/protegidas. ⚠️ **Verificação VISUAL das telas logadas (KPIs clicáveis, eco/cadastro no Envio, data default) pendente — o Marcio confere no preview/prod.**

### 2026-06-14 — migração para Vercel (serverless) — PR #1, branch `feat/deploy-vercel`
- **Motivo**: cortar custo do Render (pago por serviço); a Vercel Pro já estava paga.
- **Refactor**: `src/server.js` dividido em `src/app.js` (config do Express, exporta `app`)
  + `src/server.js` (só o `listen` local). Novo `api/index.js` (handler serverless) e
  `vercel.json` (rewrite de tudo p/ a função + `includeFiles: src/**` p/ empacotar views/estáticos).
- **Por que funciona em serverless sem dor**: já usava `cookie-session` (sessão no cookie,
  não em memória) e Sheets via HTTP (sem conexão persistente); sem jobs de fundo.
  Ressalva: o cache em memória de `db.js` (15s/5min) e o rate-limit de login perdem efeito
  entre invocações — aceitável no volume atual; dá p/ compensar depois com cache de CDN.
- **Deploy**: projeto importado na Vercel (preset `Other`, root `./`), env vars coladas
  (Production+Preview), `main` é a branch de produção. Deployment Protection desligada.
- **Validado**: `/login` 200 em produção (`x-powered-by: Express`, EJS + estáticos OK).
- **Render**: a ser desligado pelo Marcio após validar o login em produção.
- ✅ **Pendência de segurança RESOLVIDA (09/07/2026)**: a private key que apareceu num print foi
  **rotacionada** (chave nova no `.env` + Vercel Production/Preview, produção validada ao vivo,
  chave antiga excluída no GCP). O vazamento paralelo via histórico git foi **purgado** no mesmo dia
  (o commit sujo nunca chegou ao GitHub). Mapa de credenciais: `_shared/ROTACAO-CREDENCIAIS.md`.

### 2026-06-03 — fix de datas/timezone + hardening (branch `fix/datas-timezone-e-seguranca`)
- **Bug do "Dentro do prazo" vs vencida**: cálculo de `atrasadas` (`db.js`) e filtros de
  retorno (`maquinas.ejs`) usavam `new Date()` com string ISO/BR → erro de 1 dia (UTC×BRT).
  Corrigido com `src/utils/datas.js`. Vencimento **hoje** agora conta como no prazo.
- Removido `src/controllers/dashboardController.js` (código morto, usava `require` em ESM
  e parse de data inválido — nunca foi importado).
- `server.js`: `trust proxy`, aviso se faltar `SESSION_SECRET`, cookie `httpOnly`/`secure`
  (prod)/`sameSite=lax`/`maxAge=8h`.

### 2026-06-03 — robustez + limpeza (branch `chore/robustez-e-limpeza`)
- **Atomicidade do envio** (`api.js`): grava CONTROLE primeiro, depois HISTÓRICO; se o
  log falhar, faz **rollback** do CONTROLE (snapshot dos valores anteriores). Não fica
  mais "máquina movida sem registro" nem o contrário.
- **Linha correta sob concorrência**: `/registrar-envio` e `/atualizar-status` agora usam
  `getMaquinasIndex({ force: true })` e resolvem a linha **sempre pelo serial** (ignoram a
  linha enviada pelo front, que podia estar velha).
- **Rate-limit no login** (em memória, 5 tentativas / 10 min) + mensagem genérica
  ("E-mail ou senha inválidos") para não revelar se o e-mail existe.
- **Limpeza de código morto**: removidas funções não usadas de `db.js`
  (`getStatusCount`, `getEmpresaCount`, `getLocalCount`, `getEnviosRetornos30Dias`,
  `getTopEventos`, `atualizar*`) e de `sheet.js` (`updateSheetCell*`, `updateSheetAppend`,
  `getSheetId`/cache).
- **Testes**: `npm test` (runner nativo do Node) cobrindo `utils/datas.js`.

### 2026-06-03 — sessão em cookie (branch `feat/cookie-session`)
- Troca `express-session` (MemoryStore) por **`cookie-session`**: a sessão (nome + e-mail)
  vai assinada no próprio cookie. Sobrevive a restart/deploy do render (não desloga mais
  todo mundo) e não vaza memória. Logout = `req.session = null`.
- Testado de ponta a ponta (boot + login/acesso/senha errada/logout via curl). ✅

### 2026-06-03 — data-serial + layout do dashboard (branch `fix/data-serial-e-dashboard`)
- **Data virando número** (ex.: "46175" em vez de "02/06/2026"): o Sheets guarda datas
  `USER_ENTERED` como número de série; células sem formato de data mostram o número cru.
  Novo `serialSheetParaBR()` converte de volta na leitura (`getMaquinas` e `getHistorico`),
  corrigindo linhas antigas e novas sem mexer na planilha.
- **Dashboard**: o ícone ✅ da card "Disponíveis" cobria o sub-valor URA — movido pro topo
  e reduzido (`.kpi-disp .kpi-icon`).

### 2026-06-03 — CSRF + ESLint + untrack node_modules
- **CSRF**: middleware de checagem de **Origin/Referer** nos POST/PUT/DELETE (bloqueia
  requisições de outro site com 403). Complementa o cookie `sameSite=lax`. Sem token no
  front. Testado (mesma origem passa, origem externa → 403).
- **ESLint** 9 (flat config) + `npm run lint`. Lint limpo.
- **node_modules** removido do versionamento (`git rm -r --cached`); render roda
  `npm install` no deploy.

## ❓ Aberto / a confirmar
- **Decisões pendentes do Marcio (pós-auditoria 10/07):** rotacionar `SESSION_SECRET`; senha única compartilhada (manter × por-usuário); autorizar clonar o Apps Script bound (`pintarProximosEnvios`) via clasp — pré-requisito da migração Neon; acesso editor à planilha (só na fase de escrita).
- **A2 (gravar datas como RAW) deferido:** precisa do smoke test do GAS bound antes (muda tipo de célula em planilha viva).
- ~~Coluna "Status" congelada no /historico~~ **RESOLVIDO:** é a col F do HISTORICO (texto "Atrasado"/"Dentro do prazo" gravado no envio, nunca recalculado). O app JÁ recalcula a situação AO VIVO (`db.js:getHistorico` + `situacaoPrazo`) e IGNORA a col F. Não migrar essa coluna (é derivada).

## 🔧 Recomendações pendentes (não feitas ainda)
- **`users.json`**: os 7 usuários têm o MESMO hash (mesma senha). **Decisão do Marcio
  (03/06): manter assim por enquanto.**
- **MemoryStore de sessão**: resolvido (cookie-session). | **CSRF/ESLint/node_modules**: feitos.
- **Atomicidade**: o rollback é "best-effort" (se o processo cair entre o update do CONTROLE
  e o append do histórico, não há compensação). Aceitável para o volume atual.
