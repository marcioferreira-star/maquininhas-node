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

### 2026-07-10 (tarde) — Teste real de envio/retorno + ajustes (branch `feat/ajustes-envio`)
Depois de um **teste real de envio→retorno em prod** (round-trip reversível; atomicidade,
política única e cadastro de evento validados ao vivo — ver memória `maquininhas-teste-envio-retorno-2026-07-10`):
- **Envio (`envio.ejs`):** os `alert()` de validação/erro viraram **`showToast`** (não-bloqueante,
  consistente com o sucesso; não trava mais mobile nem navegador embutido em diálogo nativo).
  Botão "Cadastrar este evento" `#0a58ca`→`var(--brand)`; caixa `#formNovoEvento` `#fafafa`/`#ddd`
  →`var(--surface-2)`/`var(--border)` (fim do fundo branco no dark). *(Regra "Envio Fixo dispensa
  data de retorno" e o toast de sucesso do envio JÁ existiam.)*
- **Histórico (`historico.ejs`):** removida a coluna **"Status"** (a aba registra só a AÇÃO; a
  situação derivada não pertence ao log). Filtros intactos (usam `cells[0..2]`, antes da coluna).
  A situação ainda é computada em `dominio.js` (não removida — é testada), só não é mais renderizada.
- **Máquinas (`maquinas.ejs` + rota + `datas.js`):** nova coluna **"Situação"** ao lado de Status
  (pill Atrasado/Vence hoje/Dentro do prazo/Disponível/Fixo/Sem data), derivada do **status atual**
  via novo **`situacaoDeMaquina(status, retorno)`** em `datas.js` (calc. **server-side na rota** =
  fuso BRT correto; +teste). Nova coluna **"Nome Evento"** ao lado de "ID Evento". Removido o pill
  **"proc."**. Filtros: novo select **Situação** (inteligente) + Evento agora casa por **ID exato OU
  nome** (substring). **Exportar Excel** refatorado p/ usar `dataset` (não índice de coluna → à prova
  de reordenação) + colunas Situação/Nome Evento. Update in-place do Salvar: índices corrigidos +
  recalcula a Situação (helper `situacaoClient` espelha o server).
- **Ajustes pós-review do Marcio (mesma branch):** (a) **BUG** — máquina Estoque/Disponível
  aparecia no filtro de retorno ("Esta Semana" etc.) porque `data-retorno` guardava a data crua
  (a política única limpa J–M, mas **não** as datas N/O). Fix: `data-retorno` reflete o status
  (Estoque→"-") **e** o filtro de retorno só vale p/ "Em Uso". (b) linhas **alternadas (zebra)** +
  hover, igual ao Histórico. (c) **Nome Evento** trunca com reticências (max-width 220px) + `title`
  com nome completo no hover (mesma lógica da Obs) → larguras mais ajustadas.
  (d) **Cabeçalho fixo (sticky)** na tabela Máquinas: o `thead th` tinha `position:sticky`
  mas não grudava — causa era o **`overflow:hidden` global na `<table>`** (style.css, p/ clip do
  border-radius) + `border-collapse:collapse`. Fix: na tela, `border-collapse:separate`+`border-spacing:0`,
  `overflow:visible` na table e `border-bottom` no th. (Lição: **`position:sticky` quebra se um ancestral
  entre o elemento e o container de scroll tiver `overflow≠visible` ou `border-collapse:collapse`.**)
- Testes **14/14**, lint limpo. ⚠️ **Verificação visual da tela logada pendente — o Marcio confere no preview.**

### 2026-07-10 — Auditoria minuciosa + Ondas 0/1/2/3/4/5 + Ajustes (branches `feat/onda0-blindagem-e-fuso`, `feat/onda2-robustez`, `feat/onda3-operador`, `feat/onda4-design`, `feat/ajustes-ux`, `feat/onda5-excecoes`)
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
- **Onda 4 — design system Ingresse (branch `feat/onda4-design`, stacked sobre a onda3):**
  - **Tokens CSS** em `style.css` (`--brand:#FF271A`, `--ink:#1A1A1A`, superfícies/bordas/texto) + **dark mode** (`prefers-color-scheme` + `:root[data-theme]`). Sidebar preta com item ativo Blood Orange; cabeçalhos de tabela pretos.
  - **Dark mode via localStorage** — toggle (lua/sol) no top-header + script **pré-paint** no `header.ejs` e `login.ejs` (evita flash). Persiste.
  - **Sistema `.btn/.btn-primary/.btn-secondary/.btn-danger`**; botões azuis/laranja → Blood Orange; "Sair"/remover → danger.
  - **Emoji → ícones Tabler** (SVG inline, `currentColor`): KPIs (📦✅🚚⏰📌), nav da sidebar, ☰ e 👤.
  - **Login reskin** (preto + Blood Orange), `width:min(420px,92vw)`.
  - Tokenizados os `<style>` inline de todas as telas (dashboard/máquinas/histórico/envio) p/ funcionar em dark; removido CSS morto do `style.css`.
  - ✅ **VERIFICADO NO NAVEGADOR** (preview + usuário de teste local, revertido): login/dashboard/máquinas/envio em **light e dark**, toggle persistindo, filtro dos KPIs funcionando (`?f=estoque` → 80). Fonte: stack de sistema com "Inter" (self-host do woff2 fica p/ quando tivermos os arquivos da fonte).
- **Ajustes de UX/design (branch `feat/ajustes-ux`, stacked sobre a onda4):**
  - `db.js` lê col P (OBSERVAÇÃO) + D (Operadora) + E (Info Chip) + H (Processando) — range `A2:P`. Tela **Máquinas** ganha coluna **Obs** (com Operadora/Chip no tooltip) + badge **"proc."** quando Processando=Sim, e o Salvar **avisa** antes de alterar máquina em processamento.
  - **Toast** não-bloqueante (`showToast` no footer + `.toast` no CSS) substitui `alert()`: Salvar status agora atualiza a linha **in-place** (preserva filtros, sem `location.reload`); Envio mostra toast.
  - **Empty-state** na tabela Máquinas (sem dados / filtro sem resultado) + contador correto no load.
  - ✅ Verificado no navegador (DOM): 552 células Obs, 5 badges "proc" (= 5 Processando no banco), empty-state ao filtrar 0, toast ok(verde)/err(vermelho). (Screenshots do preview travaram — problema do renderer, não do código.)
- **Onda 5 — telas de exceção (branch `feat/onda5-excecoes`, stacked sobre ajustes):**
  - `src/excecoes.js` — repositório das 3 abas antes ignoradas (PERDIDAS/TROCAS/LOCALIZAR): leituras (`getPerdidas/getTrocas/getLocalizar`) + escritas (`marcarPerdida` → append PERDIDAS + status "Perdida" na CONTROLE, com rollback; `registrarTroca` → append TROCAS + status "Defeito"; `enviarParaLocalizar` → append LOCALIZAR + status "Localizar"). Módulo isolado p/ virar adapter Neon depois.
  - Rota + tela `/excecoes` (menu "Exceções"): 3 seções com lista + formulário de ação, tokenizada no design system.
  - **Endpoints gated pelo flag `EXCECOES_ATIVAS`** (`POST /api/perdida|troca|localizar`): default OFF → **403** (não grava nada); UI mostra "somente leitura" e botões desabilitados. **O Marcio liga o flag na Vercel quando quiser validar com dados reais.** Escrever "Perdida"/"Defeito"/"Localizar" no status tira a máquina das contagens (corrige "perdida contava como disponível").
  - ✅ Verificado no navegador: leituras 47/26/15 (dados reais), tela renderiza, gate 403 nos 3 endpoints com flag off. Escritas verificadas por code-review (gated, sem tocar dados reais). ⚠️ **Possível gotcha:** se as abas tiverem "intervalo protegido" no Sheets, a SA `maquinas-dashboard@…` precisa entrar nos editores da proteção — descobrir ao ligar o flag.
- **DEFERIDO (ondas seguintes / decisão):** ação "marcar perdida/localizar" contextual na tela Máquinas (hoje só na /excecoes); scanner de código de barras; self-host da fonte Inter (woff2); gravar datas como `RAW` (A2 — precisa smoke test do GAS bound); ping Slack no erro de leitura (precisa webhook). **Onda 6 (migração Neon):** precisa das decisões (clonar GAS bound, curadoria dos dados-lixo).
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
