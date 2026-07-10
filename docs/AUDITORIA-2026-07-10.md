# Auditoria minuciosa — maquininhas-node

**Data:** 10/07/2026
**Método:** revisão multi-agente (workflow) — **Opus** analisando e verificando adversarialmente, **Fable** planejando.
**Escopo:** projeto inteiro (código, dados, segurança, design/UX, migração Sheets→Neon), com leitura direta do código e amostragem real das 6 abas da planilha (`18tagiB…`).

> Placar da verificação: **17 agentes, 0 erros.** 7 frentes → **82 achados**, **79 confirmados**, **0 refutados**, 3 de decisão humana (opinião). **0 críticos · 16 altos.** Quality gates hoje: `npm test` 6/6 verdes, `npm run lint` limpo.

---

## 0. Veredito por frente

| Frente | Saúde | Achados | Leitura de uma linha |
|---|---|---|---|
| Camada de dados / Sheets | `fair` | 11 | Funciona na escala atual, mas 1 bug de data ativo + erros de I/O que viram "vazio" silencioso |
| Rotas e lógica de negócio | `fair` | 10 | Caminho feliz sólido; **toda validação de estado vive só no front** |
| Segurança | `fair` | 8 | Aceitável p/ ferramenta interna; problemas são de identidade/config, não injeção |
| Layout e Design | **`poor`** | 16 | Aderência à identidade Ingresse quase nula (zero Blood Orange, Inter não carrega, emoji, sem dark mode) |
| Experiência do Operador | `fair` | 13 | Caminho feliz ok; tudo que foge do padrão empurra o operador de volta pro Sheets |
| Modelo de dados / Neon | `fair` | 14 | "Banco" é planilha sem tipos/chaves; migração viável, bloqueada por 3 decisões humanas |
| Qualidade / Build / Tooling | `fair` | 8 | Estável, mas rede de segurança rasa: zero CI, teste só em `datas.js` |

**Diagnóstico executivo (Fable):**
- **1 bug de correção ATIVO corrompe dados todo dia:** os helpers de data "LOCAL (BRT)" rodam em **UTC** na Vercel — entre 21h e meia-noite BRT, todo retorno grava a data de **amanhã** e máquinas que vencem hoje aparecem "Atrasado" 1 dia cedo. É exatamente o bug que `datas.js` existe para prevenir, reintroduzido pela premissa falsa de que TZ do processo = BRT.
- **Toda a integridade depende do front:** o backend aceita reenviar máquina "Em Uso" (apaga a locação anterior sem log), "retornar" máquina de estoque (histórico inventado) e resolve serial duplicado para a última linha silenciosamente. Multi-operador sem lock = corrupção esperando acontecer.
- **Falha de infra vira mentira operacional:** qualquer erro do Sheets vira "0 máquinas" no dashboard ou "evento não existe" bloqueando envio — sem banner, sem alerta, e o `null` de erro ainda fica 5 min em cache.
- **O app cobre só o caminho feliz e não parece Ingresse:** cadastrar evento e todas as exceções (PERDIDAS/TROCAS/LOCALIZAR) obrigam edição crua da planilha — origem provável das datas-lixo (`01/01/2040`, `15/07/1905`). UI toda azul, sem marca.
- **Rede de segurança de engenharia quase inexistente:** sem CI (o repo usa PRs!), teste só em `datas.js`, camada de dados intestável (auth no top-level de `sheet.js`) e um fail-open de `SESSION_SECRET` com a chave literal no GitHub.

---

## 1. Os 16 achados ALTOS

### Correção / dados
| # | Achado | Local | Recomendação |
|---|---|---|---|
| A1 | **Helpers de data "LOCAL" rodam em UTC na Vercel** — retorno gravado 1 dia à frente e atraso calculado 1 dia cedo entre 21h–24h BRT | `utils/datas.js:24,69` · `api.js:19` · `db.js:169` | Calcular "hoje" e formatar em `America/Sao_Paulo` (`Intl.DateTimeFormat`/offset fixo), nunca via TZ do processo |
| A2 | **Datas gravadas como `USER_ENTERED`** — risco de troca dia↔mês pelo locale do Sheets (viola regra §5 do manual) | `sheet.js:73,101` · `api.js:262-337` | Gravar datas como `RAW` (texto) ou formatar coluna como `@`; confirmar locale da planilha |
| A3 | **Envio não valida status atual no backend** → sobrescreve máquina já em uso, some a locação anterior sem log | `api.js:303-338` | Rejeitar/marcar "Revisar" seriais cujo status contenha "em uso"/"fixo"; espelhar `validarStatus()` no servidor |

### Segurança
| # | Achado | Local | Recomendação |
|---|---|---|---|
| A4 | **`SESSION_SECRET` com fallback fixo público (fail-open)** — se a env faltar, assina cookie com literal do GitHub → sessão forjável, bypass total de auth | `app.js:44-60` | Fail-closed: `throw` no boot em produção sem env; rotacionar a chave (o literal deve ser tido como comprometido) |

### Design (identidade)
| # | Achado | Local | Recomendação |
|---|---|---|---|
| A5 | **Blood Orange `#FF271A` nunca é usado** — UI inteira azul (9+ hexes) e login laranja errado `#ff9800` | `style.css:28,68,157,166` · views | Tokens CSS (`--brand:#FF271A`, `--ink:#1A1A1A`) e trocar todo azul/laranja primário |
| A6 | **Inter declarada em toda parte mas nunca carregada** (cai em Arial/system-ui) | `style.css:8` · `header.ejs:22` · `login.ejs:17` | `@font-face` self-hosted (woff2) em `src/public/fonts` — sem CDN |
| A7 | **Emoji como ícone na UI final** (📦✅🚚⏰📌👤) — proibido pela identidade; zero ícone Tabler | `index.ejs:93-140` · `sidebar.ejs:43` | Substituir por Tabler outline (SVG inline, `currentColor`) |

### Experiência do operador
| # | Achado | Local | Recomendação |
|---|---|---|---|
| A8 | **Cadastrar evento é impossível no app** — operador vai pro Sheets cru no meio do envio e ainda espera cache de 5 min | `app.js:104` · `api.js:121` · `db.js:204` | Modal "Novo evento" quando o ID não existe → `appendToSheet` em DADOS EVENTOS + invalida cache do ID |
| A9 | **As 3 abas de exceção (PERDIDAS/TROCAS/LOCALIZAR) não existem no app** — toda anomalia vira edição manual (origem provável das datas-lixo) | `db.js:8-10` · `sidebar.ejs:10-34` | Ações "Marcar perdida"/"Registrar troca"/"Enviar p/ localizar"; começar por PERDIDAS (risco financeiro) |

### Modelo de dados / migração Neon
| # | Achado | Local | Recomendação |
|---|---|---|---|
| A10 | **Status/local decompostos em enum** (col G mistura "Em Uso SP"/"Estoque RJ"/"Fixo" numa string livre parseada por substring) | `sheet:CONTROLE!G` · `db.js:143` | `ENUM maquina_status` + `ENUM praca`; mapear no import |
| A11 | **`movimento` precisa PK surrogate + `created_at`** — hoje "último movimento" depende da ordem física da linha | `db.js:282` · `sheet:HISTORICO` | Tabela `movimento(id, …, created_at)`; ordenar por timestamp, não índice |
| A12 | **Datas-lixo e formato inconsistente** (sentinelas `01/01/2040`, `15/07/1905`; zero-padding misto) | `sheet:CONTROLE N/O`, `HISTORICO D/E`, `PERDIDAS L` | ETL: sentinelas→NULL; datas fora de faixa → "Revisar"; coluna `DATE` |
| A13 | **Sem identidade de máquina entre abas** — mesma física em CONTROLE/PERDIDAS/TROCAS/LOCALIZAR sem vínculo (perdida conta como disponível) | `sheet:TROCAS/CONTROLE/PERDIDAS` | Tabela `maquina` = fonte única; abas viram estados/eventos com FK |
| A14 | **Repositório Postgres troca o rollback "best-effort" por transação real** (2 chamadas HTTP ao Sheets sem atomicidade) | `api.js:358-381` · `sheet.js:89` | `BEGIN…COMMIT` (UPDATE + INSERT); elimina `snapshotRollback` |
| A15 | **RISCO: Apps Script bound repinta a planilha** (`pintarProximosEnvios`, caixa-preta fora do repo) | CLAUDE.md / fora do repo | **Decisão humana:** clonar o GAS antes de qualquer corte; Sheets vira espelho read-only ou migração faseada |
| A16 | **RISCO: dupla-escrita na transição** — operadores editam 3 abas à mão, fora do app | `sheet:PERDIDAS/TROCAS/LOCALIZAR` | **Decisão humana:** telas de exceção no app **antes** do cutover; janela de congelamento |

---

## 2. Achados por frente (completo)

Legenda: severidade `● alto · ◐ médio · ○ baixo`; esforço `S/M/L/XL`; veredito `✓ confirmado · ◇ decisão humana · ~ não checado`.

### 2.1 Camada de dados e integração com Sheets — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | Helpers de data "LOCAL" em UTC na Vercel (ver A1) | `datas.js:24,69` | Fuso explícito `America/Sao_Paulo` | M | ✓ |
| ● | Datas gravadas como `USER_ENTERED` (ver A2) | `sheet.js:73,101` | Gravar `RAW` | M | ✓ |
| ◐ | `getEventoInfo` devolve `null` em erro de leitura → "ID não existe" falso (e **cacheia o null 5 min**) | `db.js:216,233` · `api.js:121` | Propagar erro; diferenciar "não achou" de "falhou" | M | ✓ |
| ◐ | Erro de leitura vira `[]` e é **cacheado como "estoque vazio" 15s** | `sheet.js:57` · `db.js:60` | Nunca cachear resultado de erro | M | ✓ |
| ◐ | Sem pré-condição de status no envio/retorno → reenvio silencioso sobrescreve a locação | `api.js:168-338` | Validar precondição por ação | M | ✓ |
| ◐ | Serial duplicado resolve p/ a **última** linha (`map.set` sobrescreve) → grava na máquina errada | `db.js:111-117` | Detectar colisão e recusar serial ambíguo | S | ✓ |
| ○ | Ranges hardcoded `A2:O2000` / `A2:K20000` truncam quando a planilha crescer | `db.js:57,279` | Ler ranges abertos `A2:O` / `A2:K` | S | ✓ |
| ○ | Cache não invalidado após escrita; dashboard serve snapshot pré-escrita 15s | `api.js:140,411` · `db.js:84` | Invalidar cache pós-`batchUpdate`/`append` | S | ✓ |
| ○ | "Último movimento" por ordem de append; edição manual quebra a coluna Situação | `db.js:282-301` | Unificar critério (data > índice) | M | ✓ |
| ○ | `serialSheetParaBR`: guard `<30000` deixa datas-lixo 1900–1982 vazarem como número cru | `datas.js:52-54` | Ampliar guard / sanear na planilha | S | ✓ |
| ○ | Colunas D/E/F/H/P nunca lidas — app cego p/ OBSERVAÇÃO e flag "Processando?" | `db.js:57,69-82` | Ler H/P; bloquear/alertar se "Processando?" | M | ✓ |

### 2.2 Rotas e lógica de negócio — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | Envio não valida status no backend → sobrescreve máquina em uso (ver A3) | `api.js:303-338` | Rejeitar seriais já em uso | S | ✓ |
| ◐ | Retorno não valida que a máquina está em uso → histórico falso de estoque | `api.js:199-232` | Rejeitar retorno de máquina fora de uso | S | ✓ |
| ◐ | Colunas de evento (J..M) ficam em **3 estados diferentes** após um retorno | `api.js:291-298` | Política única (limpar J..M) nos 3 caminhos | S | ✓ |
| ◐ | `pintarProximosEnvios` nunca roda em escrita via API (API não dispara `onEdit`) | `api.js:358-366` | Expor a função como executável e chamar, ou remover a regra | M | ✓ |
| ◐ | Datas `USER_ENTERED` podem trocar dia↔mês (dup A2, na ótica das rotas) | `api.js:306-337` | Gravar `RAW` | S | ✓ |
| ○ | `POST /login` sem try/catch e sem checar senha → 500 e requisição pendurada | `login.js:69-104` | Validar body + try/catch | S | ✓ |
| ○ | Envio Fixo depois devolvido continua "Fixo" no histórico, nunca "Devolvida" | `db.js:299-301` | Marcar "Devolvida" mesmo quando `Fixo` | S | ✓ |
| ○ | Máquina "Em Uso" sem data de retorno **nunca** é contada como atrasada | `db.js:164-174` | Sinalizar "Revisar/atraso indeterminado" | S | ✓ |
| ○ | Validação de fluxo duplicada front×back; a de status existe só no front; `parseBRDate` reimplementado | `api.js:36-129` | Mover validação de status p/ backend; reusar helper | M | ✓ |
| ○ | Toda resposta de erro sai HTTP **200** (`ok:false` no corpo) — monitoração cega | `api.js:92-98` | 400/404/500 conforme o caso | S | ✓ |

### 2.3 Segurança — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | `SESSION_SECRET` fail-open c/ chave pública no git (ver A4) | `app.js:44-60` | Fail-closed + rotacionar | S | ✓ |
| ◐ | **Senha única compartilhada** pelos 7 usuários → coluna "autor" do HISTORICO irrastreável/repudiável | `users.json` · `api.js:143` | Senha por usuário (`createUser.js` já suporta) | S | ✓ |
| ◐ | Hashes bcrypt versionados no git e enviados ao GitHub | `users.json` | `.gitignore` + `git rm --cached` / provisionar via env | M | ✓ |
| ◐ | Rate-limit de login em memória é **inócuo em serverless** | `login.js:36-57` | Store compartilhado (KV) ou aceitar risco formalmente | M | ✓ |
| ○ | Sem headers de segurança (helmet/CSP/HSTS/X-Frame) | `app.js` | `app.use(helmet())` + CSP mínima | S | ✓ |
| ○ | `x-powered-by: Express` não desabilitado | `app.js:25` | `app.disable('x-powered-by')` | S | ✓ |
| ○ | Enumeração de usuário por timing no login | `login.js:84` | `bcrypt.compare` dummy quando user não existe | S | ✓ |
| ○ | CSRF por Origin/Referer bypassável quando ambos ausentes (coberto por `sameSite=lax`) | `app.js:75-88` | Negar POST mutante sem Origin/Referer | S | ✓ |
| ○ | cookie-session é assinado, não cifrado (nome/email legíveis) — sem ação obrigatória | `app.js:51-60` | Nunca pôr segredo na sessão | S | ✓ |

### 2.4 Layout e Design — `poor`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | Blood Orange nunca usado; UI toda azul (ver A5) | `style.css` · views | Tokens de marca | M | ✓ |
| ● | Inter declarada mas nunca carregada (ver A6) | `style.css:8` etc. | `@font-face` self-hosted | S | ✓ |
| ● | Emoji como ícone na UI final (ver A7) | `index.ejs:93-140` | Tabler outline | M | ✓ |
| ◐ | Não existe sistema `.btn/.btn-primary` — cada botão tem classe ad-hoc (7+) | `style.css:164-180` · views | Sistema `.btn*`; matar `button{}` global | M | ✓ |
| ◐ | Dark mode inexistente (padrão da identidade via localStorage) | `style.css:17` · `header.ejs:20` | Tokens + toggle + `data-theme` | L | ✓ |
| ◐ | ~40% do `style.css` é CSS morto (cards/envio legado) | `style.css:95-346` | Remover blocos sem consumidor | S | ✓ |
| ◐ | Todo feedback é `alert()`/`prompt()`/`reload` — fora da marca e ruim no mobile | `maquinas.ejs:391` · `envio.ejs:437+` | Toast/inline + modal próprio | M | ✓ |
| ◐ | Inputs/filtros sem `<label>` (só placeholder); logo do login sem `alt` | `login.ejs:130` · `maquinas.ejs:106` | `<label>`/`aria-label`; `alt="Ingresse"` | M | ✓ |
| ◐ | Estilo inline `<style>` por view + `style=` nos partials, sem tokens | todas as views | Centralizar em `style.css` com custom properties | L | ✓ |
| ○ | `#listaMaquinas` (style.css) vaza p/ Envio e p/ o `<tbody>` de Máquinas | `style.css:245` · `envio.ejs:169` | Remover seletor por id compartilhado | S | ✓ |
| ○ | Badge "Vence hoje" `#e0a800` c/ texto branco reprova contraste AA (~2:1) | `historico.ejs:251-255` | Texto `#1A1A1A` sobre o amarelo | S | ✓ |
| ○ | Card de login `width:420px` sem `max-width` — estoura em telas estreitas | `login.ejs:21-28` | `width:min(420px,92vw)` | S | ✓ |
| ○ | Cabeçalho de tabela com azul diferente em cada tela | `style.css:157` · `maquinas.ejs:57` · `historico.ejs:46` | `.table` única | S | ✓ |
| ○ | Tela Máquinas sem estado vazio; dashboard sem estado de erro/carregando | `maquinas.ejs:147` · `index.ejs:144` | Empty/erro/skeleton | S | ✓ |
| ○ | Breakpoints inconsistentes (drawer 1200px, filtros 900px); rodapé "© 2025" fixo | `header.ejs:120` · `footer.ejs:28` | Breakpoint único; `getFullYear()` | S | ✓ |

### 2.5 Experiência do Operador — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | Cadastrar evento impossível no app (ver A8) | `app.js:104` · `api.js:121` | Modal "Novo evento" | M | ✓ |
| ● | 3 abas de exceção ausentes no app (ver A9) | `db.js:8-10` · `sidebar.ejs` | Ações perda/troca/localizar | L | ✓ |
| ◐ | Nenhum scanner de código de barras (o ecossistema já tem) | `envio.ejs:168` · `maquinas.ejs:106` | Portar híbrido BarcodeDetector+zxing-wasm | M | ✓ |
| ◐ | KPIs do dashboard não são clicáveis — ver "atrasadas" exige trocar de tela e refiltrar | `index.ejs:127` | KPI vira link `/maquinas?retorno=atrasada` | S | ✓ |
| ◐ | Feedback `alert()+reload` na tela Máquinas **zera os filtros** aplicados | `maquinas.ejs:390` | Toast + preservar filtros (URL/localStorage) | M | ✓ |
| ◐ | Sem confirmação antes de mover N máquinas em massa nem antes de limpar dados | `envio.ejs:455` · `api.js:427` | Modal-resumo com contagem/seriais | S | ✓ |
| ◐ | Data de retorno é sempre "hoje" no servidor — impossível registrar baixa de outro dia | `api.js:142,263,297` | Campo "data do retorno" opcional (default hoje) | S | ✓ |
| ◐ | ID do evento só validado no submit — sem eco ao vivo do nome (dígito trocado = evento errado) | `envio.ejs:445` · `api.js:121` | `GET /api/evento/:id` no blur → eco do nome | M | ✓ |
| ◐ | Operadora/Info Chip/OBSERVAÇÃO ignoradas na leitura — invisíveis no app | `db.js:69-82` | Ler e exibir P (e D/E) | S | ✓ |
| ○ | Picker de Envio não filtra por status nem pré-filtra por ação; selecionadas sem status | `envio.ejs:168,338` | Filtro por status + pré-filtro por ação | M | ✓ |
| ○ | Data de envio não vem preenchida com hoje — date-picker extra todo envio | `envio.ejs:219` | Default hoje (parse local) | S | ✓ |
| ○ | Retorno órfão pede 1 observação de origem via `prompt()` para o lote inteiro | `envio.ejs:473` · `api.js:245` | Mini-form origem por serial | M | ✓ |
| ○ | Sem validação de que `dt_retorno >= dt_saida` | `envio.ejs:445` · `api.js:306` | Validar nas duas pontas | S | ✓ |

> Nota: apareceu também "sem atalhos/seleção em massa" (Enter não seleciona, sem "selecionar todas filtradas") — mesma família do picker acima.

### 2.6 Modelo de dados e migração Sheets→Neon — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ● | `maquina`: status/local decompostos em enum (ver A10) | `sheet:CONTROLE!G` | `ENUM` status+praca | M | ✓ |
| ● | `movimento`: PK surrogate + `created_at` (ver A11) | `db.js:282` | Tabela com timestamp | M | ✓ |
| ● | Datas-lixo/sentinelas (ver A12) | `CONTROLE N/O` etc. | ETL normaliza→NULL/Revisar | M | ✓ |
| ● | Sem identidade de máquina entre abas (ver A13) | `TROCAS/CONTROLE` | `maquina` fonte única + FK | L | ✓ |
| ● | Repositório Postgres → transação real (ver A14) | `api.js:358` | `BEGIN…COMMIT` | L | ✓ |
| ● | RISCO: Apps Script bound repinta a planilha (ver A15) | CLAUDE.md | Clonar GAS; decidir espelho×aposentar | L | ◇ |
| ● | RISCO: dupla-escrita na transição (ver A16) | `PERDIDAS/TROCAS/LOCALIZAR` | Telas antes do cutover; congelamento | L | ✓ |
| ◐ | `id_evento` não é chave: DADOS EVENTOS tem duplicatas (77837 3×) e `.find()` pega a 1ª | `sheet:DADOS EVENTOS` · `db.js:217` | PK + dedup no import; separar prefixo `572 \|` | M | ✓ |
| ◐ | PERDIDAS: schema drift (col "Responsável" ≠ "Produtora") e TEXTO em coluna de data ("JURÍDICO") | `sheet:PERDIDAS` | Tabela `perda` própria; texto→observação | M | ✓ |
| ◐ | Serial deve ser VARCHAR (URA numérico, 16 dígitos risco de coerção) | `CONTROLE C`/`TROCAS D` | `VARCHAR(32) UNIQUE`; validar comprimento no ETL | S | ✓ |
| ◐ | Concorrência: célula do Sheets é last-writer-wins; Postgres dá lock de linha | `db.js:16-36` | `SELECT … FOR UPDATE` na transação | M | ✓ |
| ◐ | HISTORICO: status congelado (col F) e `#N/A` que poluem a migração | `sheet:HISTORICO F/H/I/J` | Não migrar col F (derivada); `#N/A`→NULL; JOIN por evento | S | ✓ |
| ◐ | Tabelas `troca`/`localizacao`: modelar ciclo de vida (data/status), não copiar as abas | `sheet:TROCAS/LOCALIZAR` | Tabelas com `criado_em`/`resolvido_em` | M | ✓ |
| ○ | OBSERVAÇÃO poluída ("FIXO NORDESTE" em Em Uso) e coluna `Count` vestigial | `sheet:CONTROLE P/R` | Não migrar `Count`/`Q`; curar observação | S | ✓ |
| ◇ | RISCO: limpeza de dados-lixo é decisão humana — não apagar sentinelas nem "consertar" sozinho | `CONTROLE/HISTORICO/PERDIDAS` | ETL em staging + relatório "Revisar" (TSV) | M | ◇ |

### 2.7 Qualidade, Build, Deploy e Tooling — `fair`
| Sev | Achado | Local | Recomendação | Esf | V |
|---|---|---|---|---|---|
| ◐ | **Nenhum CI:** test+lint existem mas nunca rodam num PR (repo usa PRs!) | `.github/` ausente | `.github/workflows/ci.yml` (ci+lint+test, Node 20) | S | ✓ |
| ◐ | `sheet.js` autentica no **top-level** → camada de dados intestável e cold-start frágil | `sheet.js:35` | Auth lazy memoizada | M | ✓ |
| ◐ | Cobertura só cobre `utils/datas.js`; negócio crítico (envio/rollback, "Devolvida", resumo) sem teste | `test/` | Extrair funções puras + ~4-6 testes | M | ✓ |
| ◐ | Erros do Sheets engolidos por `console.error` → tela vazia sem alerta nem observabilidade | `sheet.js:57` · `db.js:92,186` | Distinguir erro de vazio; ping Slack no catch | M | ✓ |
| ○ | `googleapis 133.0.0` (meta-pacote pesado, desatualizado) — só usa Sheets v4 | `package.json:19` | Trocar por `@googleapis/sheets` + `npm audit` | M | ✓ |
| ○ | Versão do Node não fixada (sem `engines`/`.nvmrc`) | `package.json` | `engines` + `.nvmrc` (Node 20) | S | ✓ |
| ○ | Rate-limit de login inócuo em serverless (dup da frente de segurança) | `login.js:36-57` | Aceitar risco formalmente ou KV | M | ✓ |
| ○ | Doc desatualizada: CLAUDE.md diz 3 abas / cols A–O; são 6 abas e CONTROLE vai até R; comentário "ESLint 9" (é 10) | `CLAUDE.md:25-30` | Atualizar doc (6 abas, colunas ignoradas) | S | ~ |

---

## 3. Plano A — Roadmap executável (priorização e sequência)

### Quick wins (esforço S, alto valor) — em ordem de execução
1. **`SESSION_SECRET` fail-closed + rotacionar chave** (`app.js:54`) — bypass total de auth se a env faltar; chave literal está no GitHub.
2. **CI mínimo** (`.github/workflows/ci.yml`: `npm ci` + lint + test, Node 20) — maior retorno/esforço; **antes** de tudo (auto-deploy na Vercel).
3. **Validação de status no backend** — Envio exige `Estoque*`; Retorno exige `Em Uso*/Fixo`; devolver bloqueados em `erros`.
4. **Detectar serial duplicado no índice** (`db.js:111-117`) — recusar operação sobre serial ambíguo.
5. **Ranges abertos** `A2:O` / `A2:K` (`db.js:57,279`).
6. **Invalidar cache após escrita** (zerar `ts` de `CACHE.maquinas`/`maquinasIndex`).
7. **Política única para J..M no retorno** — limpar (`'-'`) nos 3 caminhos.
8. **HTTP status reais** (400/404/500).
9. **KPIs clicáveis** → `/maquinas?retorno=atrasada` + ler querystring no `aplicarFiltros()`.
10. **Pacote prevenção de erro no Envio** (1 PR): confirmação de massa, validar `dt_retorno >= dt_saida`, `#dtSaida` default hoje (parse local), campo "data real do retorno".
11. **Higiene em lote** (1 PR): `helmet()` + `disable('x-powered-by')`, try/catch + validação de body no `/login`, `bcrypt.compare` dummy p/ timing, `engines`+`.nvmrc`, footer `getFullYear()`, contraste do badge "Vence hoje", `alt` no logo do login, guard do `serialSheetParaBR`.
12. **Atualizar CLAUDE.md** (6 abas, colunas ignoradas D/E/F/H/P/R, rate-limit decorativo, ESLint 10).

> Não fazer agora (aceitar risco): rate-limit distribuído (KV) — p/ 7 usuários, senhas individuais rendem mais; senha única compartilhada é decisão registrada do dono ("manter por ora") — apenas reafirmar que a coluna "autor" do HISTORICO não é confiável enquanto durar.

### Big rocks (M/L/XL)
- **BR1 — Correção de datas fuso-explícito (M) — prioridade máxima.** `hojeBR()`/`startOfDayLocal()` via `America/Sao_Paulo`; datas gravadas `RAW`; testes simulando processo em UTC.
- **BR2 — Erro ≠ vazio (M).** `getSheetData` para de engolir erro; `getEventoInfo` diferencia "não achou" de "falhou" e **nunca** cacheia null de erro; banner nas views; ping Slack.
- **BR3 — Testabilidade da camada de dados (M).** Auth lazy em `sheet.js`; extrair classificação de status p/ função pura + 4-6 testes; unificar critério de "último movimento". **Pré-requisito das ondas seguintes.**
- **BR4 — Fluxo do operador (M).** Cadastro de evento no app; lookup ao vivo do ID; ler/exibir D/E/P; toast no lugar de `alert+reload`; scanner de código de barras.
- **BR5 — Design System Ingresse (L).** Tokens + Inter self-hosted + `.btn*` + Tabler + dark mode; matar CSS morto; migrar `<style>` inline. **Depois do BR4.**
- **BR6 — Telas de exceção (L) — pré-requisito do cutover Neon.** PERDIDAS → TROCAS → LOCALIZAR, atrás de interface de repositório.
- **BR7 — Migração Neon/Postgres (XL) — 5 fases** (ver Plano B).

### Sequência recomendada (ondas)
- **Onda 0 — Blindar antes de mexer:** quick wins 1-8 + 11-12 (CI primeiro).
- **Onda 1 — O bug de datas (BR1).** Único defeito que corrompe dados todo dia.
- **Onda 2 — Robustez e testabilidade (BR2 + BR3).**
- **Onda 3 — Experiência do operador (BR4 + quick wins 9-10).**
- **Onda 4 — Design system Ingresse (BR5).**
- **Onda 5 — Telas de exceção (BR6) + clonar o GAS.**
- **Onda 6 — Migração Neon (BR7).**

**Dependências:** CI → tudo · BR3 → BR4/BR6/BR7 · BR6 + decisões Fase 0 → cutover Neon · BR4 → BR5 · Clonagem do GAS → `pintarProximosEnvios` e Fase 0.

**Racional:** primeiro parar de corromper (0-1), depois parar de mentir (2), acelerar o operador (3), parecer Ingresse (4), e só então trocar o motor (5-6) — com o Sheets preservado como backup durante toda a transição.

---

## 4. Plano B — Migração Sheets → Neon/Postgres

**Princípio:** o custo real é a **curadoria dos dados e a transição operacional**, não a infra (~948 máquinas cabem em qualquer plano free do Neon).

### Schema final (resumo)
Enums: `maquina_status ('ESTOQUE','EM_USO','FIXO','PERDIDA','DEFEITO','LOCALIZAR')`, `praca ('SP','RJ','URA')`, `movimento_tipo ('ENVIO','ENVIO_FIXO','RETORNO','AJUSTE')`.

Tabelas núcleo:
- **`evento`** (`id_evento` PK, nome, `produtora_codigo`, `produtora_nome`, comercial) — separa o prefixo `572 | …`.
- **`maquina`** (`id` PK, `serial VARCHAR(32) UNIQUE`, modelo, operadora, info_chip, empresa, `adquirente` derivado do prefixo, `status`, `local`, `id_evento_atual` FK, `data_saida DATE`, `data_retorno DATE`, `processando BOOL`, `observacao`, `CHECK (status<>'FIXO' OR data_retorno IS NULL)`).
- **`movimento`** (`id` PK, `maquina_id` FK, `id_evento` FK, `tipo`, local, datas, usuario, `origem`, `origem_linha`, `created_at`). **Nome/produtora/comercial não são copiados** — vêm por JOIN em `evento`. Ordenação por `created_at`, não índice físico.

Tabelas de exceção (ciclo de vida, não cópia das abas): **`perda`**, **`troca`** (defeito→nova, com `resolvido_em`), **`localizacao`** (com `encontrado_em`). Regra: **cada serial existe UMA vez em `maquina`**; exceções referenciam `maquina_id` e atualizam o status na mesma transação.

Derivado (view `vw_maquina_prazo`): calcula `atrasada` com "hoje" em `America/Sao_Paulo` **dentro do SQL** → o bug de TZ morre estruturalmente; expõe `prazo_indeterminado` (Em Uso sem data de retorno).

### ETL e limpeza (2 passos: staging → curadoria → promoção)
- **Nunca importar direto.** `tools/etl/import-staging.js` reusa `sheet.js` p/ ler as 6 abas → `staging.*` com raw + parseado + `motivo_revisao TEXT[]`. A planilha **não é alterada** (é o backup).
- **Automatizado (determinístico):** sentinelas `01/01/2040`/`15/07/1905`→NULL; zero-padding; nº-de-série→data; `-`/`''`/`0`→NULL; `#N/A`→NULL; prefixo produtora via regex; adquirente por prefixo; dedup de eventos idênticos (`DISTINCT ON`); `created_at` sintético; **não migrar** col F/Q/R.
- **Decisão humana (relatório TSV, linha a linha):** datas fora de `[2018, hoje+2a]`; `id_evento` inválido/embutido no nome; duplicatas divergentes; serial duplicado na CONTROLE; serial em >1 aba com estados conflitantes; status fora do mapa; textos em coluna de data (PERDIDAS); `*ela voltou` (LOCALIZAR); OBSERVAÇÃO genérica. **Só promove o validado.** Nenhuma linha some sem estar contabilizada.

### db.js/sheet.js → repositório Postgres
- Driver **`@neondatabase/serverless`** (mesmo ecossistema da Torre V2), pool **lazy memoizado** (corrige o anti-padrão de auth no top-level), connection string **pooled** em `DATABASE_URL`.
- `src/repo/*` (maquinasRepo, eventosRepo, movimentosRepo, fluxoRepo); `db.js` vira fachada com flag `DATA_BACKEND=sheets|pg` — **as rotas não mudam de contrato** na 1ª fase.
- **Transação real** (`BEGIN…COMMIT` com `SELECT … FOR UPDATE`) substitui o rollback best-effort → atomicidade verdadeira, concorrência serializada, precondição de status no backend de graça, erro≠vazio, cache removido, fim do `USER_ENTERED`/`serialSheetParaBR`/teto `A2:O2000`.

### Cutover — 5 fases
| Fase | Entrega | Pronto quando |
|---|---|---|
| **0 — Decisões/reconhecimento** | Clonar GAS bound (ler `pintarProximosEnvios`); conferir locale; decidir espelho×aposentar e congelamento; criar Neon + `DATABASE_URL` | GAS documentado; decisões no CLAUDE.md; conexão validada |
| **1 — Schema** | Migrations (enums, 6 tabelas, views, índices) + `staging.*` | Aplicam do zero num branch Neon; `npm run migrate` idempotente |
| **2 — ETL + curadoria** | `import-staging` + TSVs de revisão + decisões aplicadas + `promover` | `origem = importado + revisão`; tudo "Revisar" decidido; zero violação de FK/UNIQUE/CHECK |
| **3 — Repositório + shadow** | `src/repo/*`, flag, hook shadow (Sheets primário, PG cópia), `parity.js`, testes | Lint+test verdes; **7 dias com paridade diff=0**; alerta Slack ok |
| **4 — Cutover** | `DATA_BACKEND=pg`; espelho best-effort pós-commit + reconciliador; HTTP status; precondições server-side | **14 dias PG-primário sem rollback**; paridade diff=0; GAS pintando sobre o espelho |
| **5 — Telas de exceção** | CRUD de perda/troca/localização (grava + atualiza status na transação); congelar as abas | Operadores registram exceções só pelo app por 2 semanas |
| **6 — Aposentar o Sheets** | Espelho read-only (recomendado) ou desligar + reimplementar realce no app | 30 dias sem escrita manual; doc reescrita |

**Ganhos** (cada um mata um achado): atomicidade real · concorrência resolvida · integridade estrutural (enum/UNIQUE/FK/CHECK) · bug de TZ morto por design · fim do `USER_ENTERED` · erro≠vazio · identidade única do parque · fundação p/ o resto do backlog.
**Riscos/mitigação:** GAS caixa-preta (ler antes) · edição manual na transição (espelho + congelamento + paridade + telas antes do corte) · curadoria trava cronograma (staging importa 100%; só a promoção espera) · rollback pós-fase-6 deixa de ser trivial (só desligar com 30 dias limpos).

---

## 5. Plano C — Design & Experiência do operador

**Estado:** `poor` — funcional, mas identidade Ingresse quase nula e atrito repetido nos fluxos de lote.

### Princípios
- **P1 — Uma marca, um arquivo de tokens** (`--brand:#FF271A`, `--ink:#1A1A1A`, estados; azul vira `--info`; sidebar preta com ativo em Blood Orange).
- **P2 — Inter de verdade** (self-hosted woff2, sem CDN).
- **P3 — Zero emoji → Tabler outline** (partial `icons.ejs`, SVG `currentColor`).
- **P4 — Um sistema de botão, uma ação primária por tela** (`.btn/.btn-primary/.btn-secondary/.btn-danger`; matar `button{}` global).
- **P5 — Feedback nunca bloqueia, contexto nunca se perde** (toast + modal próprio; atualizar linha in-place, sem `location.reload()`).
- **P6 — Prevenção de erro antes de escrever na planilha** (resumo confirmável em lote; avisar o que será apagado).
- **P7 — Mobile-first de armazém** (alvos ≥44px, scanner em todo campo de serial, dark mode, breakpoint único).
- **P8 — Acessibilidade mínima** (`<label>`/`aria`, `alt` no login, contraste AA).

### Fluxos redesenhados (destaques)
- **Enviar:** ação primeiro (pré-filtra o picker por status), scanner + "selecionar todas filtradas (N)" + Enter seleciona resultado único, painel Selecionadas com status, **eco ao vivo do evento** no blur do ID (+ "cadastrar este evento"), `#dtSaida` default hoje, validação `retorno≥saída`, **confirmação de lote**, toast (sem reload).
- **Retornar:** pré-filtro por ação, **campo "data do retorno" editável** (default hoje), retorno órfão vira **mini-form por serial** (não `prompt()` único).
- **Localizar/buscar:** scanner na busca, **ficha rápida da máquina** (status/evento/datas + Operadora/Info Chip/OBSERVAÇÃO + últimos 5 movimentos), OBSERVAÇÃO como tooltip.
- **Ver atrasadas:** **todo KPI é link** com filtro pré-aplicado (querystring); card Atrasadas com preview das 3 mais vencidas; ordenação por mais atrasada.
- **Scanner (transversal):** módulo único `scanner.js` (BarcodeDetector + zxing-wasm, já validado no bipar-meep/Torre), acoplável a qualquer input de serial.

### As 3 abas ausentes
O app não replica as abas como telas — **oferece as AÇÕES**, e as abas viram o registro que o app escreve. Prioridade **PERDIDAS** (maior risco financeiro: "Marcar perdida"/"Encontrada", sincroniza status na CONTROLE) → **TROCAS** (defeituosa→nova, com data/conclusão) → **LOCALIZAR** (lista de pendências). Sidebar ganha grupo "Exceções"; as ações também aparecem na ficha da máquina.

### Tabelas e dashboard
`.table` única (fim dos 3 azuis de cabeçalho); estados vazio/erro/carregando em todas as telas; filtros persistentes/linkáveis (querystring); rodapé com ano dinâmico; breakpoint único (1024px); higiene do CSS morto + fim do `#listaMaquinas` global.

### Backlog priorizado (ondas)
- **Onda 1 — Fundação de marca** (sem mudar comportamento): tokens, Inter, `.btn*`, emoji→Tabler, limpeza CSS, tabela única, acessibilidade base.
- **Onda 2 — Fluxo do operador:** KPIs clicáveis, toast+in-place, datas espertas, eco do evento, cadastro de evento, confirmação de lote, picker pré-filtrado, scanner, data real do retorno, órfão por serial, exibir D/E/P, estados vazio/erro.
- **Onda 3 — Exceções + dark mode:** PERDIDAS, TROCAS, LOCALIZAR, ficha rápida, dark mode (localStorage).

---

## 6. Decisões que dependem de você (Marcio)

1. **Acesso de editor à planilha?** Para a **análise** não precisei (leitura pela SA do sheets-mcp bastou). Só será necessário para a **fase de migração/escrita** (ETL, telas de exceção). Você ofereceu — segure até chegarmos lá.
2. **Rotacionar `SESSION_SECRET`** na Vercel (a chave literal `super-secret-ingresse` deve ser considerada comprometida — está no GitHub).
3. **Senha única compartilhada:** manter (decisão sua "por ora") ou migrar para senha por usuário? Enquanto durar, a coluna "autor" do HISTORICO **não é prova** de quem fez o quê.
4. **Apps Script bound (`pintarProximosEnvios`):** autorizar clonar via `clasp` (hoje é caixa-preta fora da sua conta clasp) — pré-requisito da migração.
5. **Curadoria dos dados-lixo:** o ETL vai gerar um TSV "Revisar" (datas 1905/2040, ids inválidos, seriais duplicados) para você decidir linha a linha — eu sinalizo, você decide.
6. **Por onde começar?** Recomendação: **Onda 0 (blindagem) + Onda 1 (bug de datas)** primeiro — é o que para de corromper dado e não muda nada visível. Aguardo seu OK para começar a implementar.

---

*Auditoria gerada por revisão multi-agente (Opus análise+verificação adversarial, Fable planejamento). Nenhum dos 82 achados foi refutado na verificação; 3 são decisões humanas explícitas. Detalhe completo de evidência/verificação por achado no journal do workflow.*
