// src/utils/datas.js
// Helpers de data no fuso de Brasília (America/Sao_Paulo).
// ⚠️ Nunca usar new Date("YYYY-MM-DD") nem new Date("dd/mm/aaaa"):
//    o 1º vira UTC (regride 1 dia em BRT) e o 2º é inválido/ambíguo.
// ⚠️ "hoje" é SEMPRE derivado de America/Sao_Paulo via Intl — nunca do TZ do
//    processo. Na Vercel (serverless) o processo roda em UTC; usar o TZ do
//    processo faria "hoje" virar o dia seguinte entre 21h e 24h BRT (grava a
//    data de retorno errada e conta atraso 1 dia cedo).

/**
 * Componentes de calendário de "agora" no fuso America/Sao_Paulo,
 * independentes do TZ do processo (en-CA formata como aaaa-mm-dd).
 */
function partesHojeBRT() {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const [ano, mes, dia] = s.split("-").map(Number);
  return { ano, mes, dia };
}

/**
 * Data de hoje em "dd/mm/aaaa", no fuso de Brasília.
 * Fonte única para carimbar datas (envio/retorno) — não usar new Date() cru.
 */
export function hojeBR() {
  const { ano, mes, dia } = partesHojeBRT();
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

/**
 * Converte "dd/mm/aaaa" em um Date à meia-noite LOCAL.
 * Retorna null se a string for vazia, "-" ou inválida.
 */
export function parseBRDate(br) {
  if (!br || typeof br !== "string") return null;
  const [d, m, y] = br.trim().split("/");
  const dd = Number(d);
  const mm = Number(m);
  const yy = Number(y);
  if (!dd || !mm || !yy) return null;
  return new Date(yy, mm - 1, dd); // meia-noite no fuso local
}

/**
 * Data à meia-noite para comparação dia-a-dia (sem o ruído do horário).
 * - Sem argumento: HOJE no fuso de Brasília (não depende do TZ do processo).
 * - Com um Date: meia-noite daquele Date (compat; usado só em testes).
 * O Date é construído com new Date(ano, mes-1, dia), igual ao parseBRDate,
 * então a comparação retornoBR < hoje é puramente de calendário.
 */
export function startOfDayLocal(date) {
  if (date instanceof Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  const { ano, mes, dia } = partesHojeBRT();
  return new Date(ano, mes - 1, dia);
}

/**
 * Diferença em dias inteiros entre uma data BR e hoje (data - hoje).
 * Negativo = no passado (vencida), 0 = hoje, positivo = no futuro.
 * Retorna null se a data for inválida.
 */
export function diffDiasDeHoje(br) {
  const alvo = parseBRDate(br);
  if (!alvo) return null;
  const hoje = startOfDayLocal();
  return Math.round((alvo - hoje) / 86_400_000);
}

/**
 * O Google Sheets, ao receber uma data como USER_ENTERED, guarda um NÚMERO DE SÉRIE
 * (dias desde 1899-12-30). Se a célula não estiver formatada como data, a leitura
 * volta esse número cru (ex.: "46175"). Aqui convertemos de volta para "dd/mm/aaaa".
 * Valores que já são texto/data (têm "/") ou vazios são devolvidos sem mudança.
 */
export function serialSheetParaBR(v) {
  if (v == null) return v;
  const s = String(v).trim();
  if (!s || s === "-") return s;
  if (!/^\d+$/.test(s)) return s; // já é texto (ex.: "01/12/2025")

  const serial = Number(s);
  // só trata como data se o serial for plausível (~1982 a ~2119)
  if (serial < 30000 || serial > 80000) return s;

  // constrói em UTC para não sofrer deslocamento de fuso
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Situação de prazo de uma linha do histórico, calculada AO VIVO.
 * Só faz sentido para linhas de Envio (Retorno não tem prazo).
 * Retorna "" quando não se aplica (ex.: linha de Retorno) — aí o front
 * mostra o status factual.
 */
export function situacaoPrazo(acao, retornoBR) {
  const a = String(acao || "").toLowerCase();
  if (!a.includes("envio")) return "";       // retorno/outros: sem prazo
  if (a.includes("fixo")) return "Fixo";     // envio fixo não tem retorno
  const ret = parseBRDate(retornoBR);
  if (!ret) return "Fixo";
  const hoje = startOfDayLocal();
  if (ret < hoje) return "Atrasado";
  if (ret.getTime() === hoje.getTime()) return "Vence hoje";
  return "Dentro do prazo";
}

/**
 * Valida se a string é uma data de calendário REAL em "aaaa-mm-dd" (o formato
 * do <input type=date>). Rejeita não-data e datas fora de faixa (ex.: "2026-13-45"),
 * que o parseBRDate normalizaria em silêncio. Blindagem de backend.
 */
export function dataISOValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Situação de prazo de uma MÁQUINA, derivada do STATUS ATUAL (não de uma ação).
 * Usada na aba "Máquinas Cadastradas" (a coluna que saiu do Histórico).
 *  - Em Uso  → compara a data de retorno com hoje (Atrasado / Vence hoje / Dentro do prazo);
 *              sem data de retorno = "Sem data".
 *  - Fixo    → "Fixo" (instalada, não retorna).
 *  - Estoque → "Disponível" (voltou / pronta pra enviar).
 *  - Outros (Perdida/Defeito/Localizar/…) → "" (o front mostra o status factual).
 */
export function situacaoDeMaquina(status, retornoBR) {
  const s = String(status || "").toLowerCase();
  if (s.startsWith("em uso")) {
    const ret = parseBRDate(retornoBR);
    if (!ret) return "Sem data";
    const hoje = startOfDayLocal();
    if (ret < hoje) return "Atrasado";
    if (ret.getTime() === hoje.getTime()) return "Vence hoje";
    return "Dentro do prazo";
  }
  if (s === "fixo") return "Fixo";
  if (s.startsWith("estoque")) return "Disponível";
  return "";
}
