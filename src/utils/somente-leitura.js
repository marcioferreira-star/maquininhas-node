// MODO SOMENTE LEITURA (25/11/2026) — o dia da virada da logística para a Central de Operações.
//
// Depois do cutover a FONTE do parque é a Central (Logística → Maquininhas) e a planilha CONTROLE vira ESPELHO
// automático. Este app continua no ar SÓ PARA CONSULTA: com `SOMENTE_LEITURA=1` toda escrita por `/api/*` é
// recusada com 403 e a mensagem diz onde registrar agora. Sem a env (o padrão), nada muda.
//
// ⛔ Liga com o valor EXATO "1" (como o `EXCECOES_ATIVAS`): "true", "sim" ou vazio NÃO ligam — escrita bloqueada
//    por engano no meio de um evento é pior que o inverso, e é o lado que o dono escolhe conscientemente.
// ✅ Continua liberado: GET/HEAD/OPTIONS (as telas) e o sync planilha → espelho Neon (`/api/sync-manual`, botão
//    "Sincronizar", e o cron `/api/sync-neon`): eles só LEEM a planilha, que segue sendo atualizada pela Central.

export const MENSAGEM_SOMENTE_LEITURA =
  "Este app agora é só consulta. Registre envio, retorno, exceções e cadastro na Central de Operações (Logística → Maquininhas).";

const METODOS_DE_LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);
// caminhos RELATIVOS ao mount `/api` (o Express tira o prefixo em `req.path`)
const ESCRITAS_PERMITIDAS = new Set(["/sync-manual", "/sync-neon"]);

/** A flag lida do ambiente — só o valor exato "1" liga. */
export function somenteLeituraLigado(env = process.env) {
  return String(env.SOMENTE_LEITURA ?? "").trim() === "1";
}

/** A régua pura: esta requisição deve ser recusada? (`caminho` relativo ao mount `/api`) */
export function deveRecusar(ligado, metodo, caminho) {
  if (!ligado) return false;
  if (METODOS_DE_LEITURA.has(String(metodo).toUpperCase())) return false;
  return !ESCRITAS_PERMITIDAS.has(String(caminho || "").replace(/\/+$/, "") || "/");
}

/** Middleware para montar em `/api`, ANTES das rotas. Responde no formato que o front já lê (`data.msg`). */
export function bloquearEscritaSeSomenteLeitura(req, res, next) {
  if (deveRecusar(somenteLeituraLigado(), req.method, req.path)) {
    return res.status(403).json({ ok: false, msg: MENSAGEM_SOMENTE_LEITURA });
  }
  next();
}
