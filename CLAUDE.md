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

## Planilha (3 abas)
- `CONTROLE MAQUININHAS PAGSEGURO - INGRESSE` — cadastro (cols A–O). Colunas usadas:
  B=modelo, C=serial, G=status, I=empresa, J=idEvento, K=nomeEvento, L=produtora,
  M=comercial, N=dataSaída, O=dataRetorno.
- `HISTORICO MAQUINAS` — log de movimentos (cols A–K)
- `DADOS EVENTOS` — cadastro de eventos (cols A–D)

Fluxo: Envio → "Em Uso"/"Fixo" → Retorno → "Estoque". Status "Fixo" não tem retorno.

## ⚠️ Datas (regra crítica)
Datas na planilha são **BR `dd/mm/aaaa`**. **NUNCA** usar `new Date("aaaa-mm-dd")`
(vira UTC e regride 1 dia em BRT) nem `new Date("dd/mm/aaaa")` (inválido).
Sempre usar os helpers de `src/utils/datas.js` (`parseBRDate`, `startOfDayLocal`,
`diffDiasDeHoje`) e comparar **só a data** (sem hora). No cliente (EJS), parsear com
`new Date(ano, mes-1, dia)`.

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
- ⚠️ **Pendência de segurança**: a private key da service account apareceu num print durante
  a migração → **rotacionar a chave** no Google Cloud (nova chave → atualizar `.env` + Vercel → apagar antiga).

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
- (nada pendente no momento)
- **Divergência produção × repositório**: o print do Marcio (tela /historico) mostra uma
  coluna *Status* com "Dentro do prazo"/"Atrasado" que **não existe em nenhuma branch**.
  Hipótese: o site no render roda um build antigo que gravava esse status como texto FIXO
  na planilha (calculado no envio, nunca recalculado). **Confirmar se o site no ar bate com
  este código.** Se a ideia é ter esse selo, ele deve ser calculado AO VIVO (no render),
  nunca congelado.

## 🔧 Recomendações pendentes (não feitas ainda)
- **`users.json`**: os 7 usuários têm o MESMO hash (mesma senha). **Decisão do Marcio
  (03/06): manter assim por enquanto.**
- **MemoryStore de sessão**: resolvido (cookie-session). | **CSRF/ESLint/node_modules**: feitos.
- **Atomicidade**: o rollback é "best-effort" (se o processo cair entre o update do CONTROLE
  e o append do histórico, não há compensação). Aceitável para o volume atual.
