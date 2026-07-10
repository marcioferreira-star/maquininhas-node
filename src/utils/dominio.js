// src/utils/dominio.js
// Lógica de NEGÓCIO pura (sem Sheets, sem I/O) — para ser testável isoladamente.
// db.js busca os dados e delega o cálculo para cá.

import { parseBRDate, serialSheetParaBR, situacaoPrazo } from "./datas.js";

/**
 * Resumo do dashboard a partir de uma lista de máquinas.
 * `hoje` (Date à meia-noite BRT) entra por parâmetro para ficar testável.
 * Regras: "Estoque XX" = disponível na praça XX; "Em Uso"/"Fixo" = em uso;
 * atrasada = em uso (não fixo) com data de retorno JÁ vencida (vence hoje = no prazo).
 */
export function resumoDeMaquinas(maquinas, hoje) {
  const lista = Array.isArray(maquinas) ? maquinas : [];

  let disponiveisSP = 0;
  let disponiveisRJ = 0;
  let disponiveisURA = 0;

  const total = lista.length;

  const disponiveis = lista.filter((m) => {
    const st = (m.status || "").toUpperCase();
    if (st.includes("ESTOQUE")) {
      if (st.includes("SP")) disponiveisSP++;
      else if (st.includes("RJ")) disponiveisRJ++;
      else if (st.includes("URA")) disponiveisURA++;
      return true;
    }
    return false;
  }).length;

  const emUso = lista.filter((m) => {
    const st = (m.status || "").toLowerCase().trim();
    return st.includes("em uso") || st === "fixo";
  }).length;

  const fixas = lista.filter(
    (m) => (m.status || "").toLowerCase().trim() === "fixo"
  ).length;

  const atrasadas = lista.filter((m) => {
    const st = (m.status || "").toLowerCase().trim();
    if (st === "fixo") return false;
    if (!st.includes("em uso")) return false;
    const dataRet = parseBRDate(m.dataRetorno);
    if (!dataRet) return false;
    return dataRet < hoje; // vence hoje = ainda no prazo
  }).length;

  return {
    total,
    disponiveis,
    disponiveisSP,
    disponiveisRJ,
    disponiveisURA,
    emUso,
    fixas,
    atrasadas
  };
}

/**
 * Monta o histórico a partir das linhas cruas (A..K) do HISTORICO.
 * - Converte número-de-série do Sheets de volta para dd/mm/aaaa.
 * - Deriva a situação de prazo AO VIVO (ignora o texto congelado da col F).
 * - Linha de movimento que NÃO é mais o último do serial = "Devolvida"
 *   (inclui Envio Fixo já devolvido — antes ficava travado em "Fixo").
 */
export function montarHistorico(dados) {
  if (!Array.isArray(dados) || dados.length === 0) return [];

  // último movimento de cada serial = maior índice (planilha em ordem de append)
  const ultimoIdxPorSerial = new Map();
  dados.forEach((l, i) => {
    const s = String(l[0] || "").trim();
    if (s) ultimoIdxPorSerial.set(s, i);
  });

  return dados.map((l, i) => {
    const serial = String(l[0] || "-").trim();
    const acao = l[2] || "-";
    const saida = serialSheetParaBR(l[3]) || "-";
    const retorno = serialSheetParaBR(l[4]) || "-";

    let situacao = situacaoPrazo(acao, retorno);
    // se esta linha de envio já não é o último movimento do serial, a máquina
    // voltou → "Devolvida" (vale também para Envio Fixo já devolvido).
    if (situacao && ultimoIdxPorSerial.get(serial) !== i) {
      situacao = "Devolvida";
    }

    return {
      serial,
      evento: String(l[1] || "-").trim(),
      acao,
      saida,
      retorno,
      status: l[5] || "-",
      situacao,
      usuario: l[6] || "-",
      nome_evento: l[7] || "-",
      produtora: l[8] || "-",
      comercial: l[9] || "-",
      obs: l[10] || "-"
    };
  });
}
