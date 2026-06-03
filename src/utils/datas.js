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
