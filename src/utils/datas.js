// src/utils/datas.js
// Helpers de data em horário LOCAL (BRT).
// ⚠️ Nunca usar new Date("YYYY-MM-DD") nem new Date("dd/mm/aaaa"):
//    o 1º vira UTC (regride 1 dia em BRT) e o 2º é inválido/ambíguo.

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
 * Retorna a data de hoje à meia-noite local (sem hora),
 * para comparar dia-a-dia sem o ruído do horário atual.
 */
export function startOfDayLocal(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
