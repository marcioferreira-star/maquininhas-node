# maquininhas-node

Sistema web de controle de maquininhas de pagamento PagSeguro/Ingresse: envio, retorno
e status de hardware de checkout para eventos. Estoque em **SP, RJ e URA**.

## Stack
- Node.js + Express + EJS (ESM — `"type": "module"`, use `import`, **nunca `require`**)
- Google Sheets como banco (service account)
- Sessão via `express-session`; usuários em `src/auth/users.json` (bcrypt)
- Deploy: **render.com** (auto-deploy ao dar push na branch `main`)

## Estrutura
- `src/server.js` — entrypoint Express, sessão, rotas
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

## Variáveis de ambiente (.env / render)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON da service account (obrigatório)
- `SPREADSHEET_ID` — id da planilha (tem default no código)
- `SESSION_SECRET` — **definir em produção** (senão usa valor inseguro com aviso no log)
- `NODE_ENV=production` — ativa cookie `secure` (HTTPS). Definir no render.
- `PORT` — opcional (default 3000)

## Rodar local
1. Criar `.env` com `GOOGLE_SERVICE_ACCOUNT_JSON` e `SPREADSHEET_ID` (já no `.gitignore`).
2. `npm install` → `npm run dev` (nodemon) ou `npm start`.
3. Criar usuário: `node src/auth/createUser.js`.

---

## Histórico de mudanças por agentes

### 2026-06-03 — fix de datas/timezone + hardening (branch `fix/datas-timezone-e-seguranca`)
- **Bug do "Dentro do prazo" vs vencida**: cálculo de `atrasadas` (`db.js`) e filtros de
  retorno (`maquinas.ejs`) usavam `new Date()` com string ISO/BR → erro de 1 dia (UTC×BRT).
  Corrigido com `src/utils/datas.js`. Vencimento **hoje** agora conta como no prazo.
- Removido `src/controllers/dashboardController.js` (código morto, usava `require` em ESM
  e parse de data inválido — nunca foi importado).
- `server.js`: `trust proxy`, aviso se faltar `SESSION_SECRET`, cookie `httpOnly`/`secure`
  (prod)/`sameSite=lax`/`maxAge=8h`.

## ❓ Aberto / a confirmar
- **Divergência produção × repositório**: o print do Marcio (tela /historico) mostra uma
  coluna *Status* com "Dentro do prazo"/"Atrasado" que **não existe em nenhuma branch**.
  Hipótese: o site no render roda um build antigo que gravava esse status como texto FIXO
  na planilha (calculado no envio, nunca recalculado). **Confirmar se o site no ar bate com
  este código.** Se a ideia é ter esse selo, ele deve ser calculado AO VIVO (no render),
  nunca congelado.

## 🔧 Recomendações pendentes (não feitas ainda)
- **Atomicidade**: `api.js /registrar-envio` grava histórico e atualiza o CONTROLE em 2
  chamadas sem rollback → risco de inconsistência se a 2ª falhar.
- **Linha errada sob concorrência**: `/registrar-envio` usa `getMaquinasIndex()` sem `force`
  (cache até 15s) → pode escrever na linha errada se a planilha mudou. Considerar resolver a
  linha pelo serial no momento da escrita.
- **MemoryStore de sessão**: a cada deploy/restart do render todos são deslogados. Migrar
  para store persistente se incomodar.
- **`users.json`**: os 7 usuários têm o MESMO hash (mesma senha). Gerar senhas individuais.
- **Sem rate-limit no /login**, sem CSRF, sem testes, sem ESLint.
- **Código morto** em `db.js`/`sheet.js` (várias funções `atualizar*`, `getTopEventos`,
  `getStatusCount`, `updateSheetCell*`, etc. não usadas).
