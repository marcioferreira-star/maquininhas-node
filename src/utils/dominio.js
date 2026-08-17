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

/* ============================================================
   AJUSTE MANUAL DE STATUS (tela Máquinas → Salvar)
   Antes o /atualizar-status mudava a CONTROLE sem gravar no HISTORICO:
   divergência silenciosa e origem (evento/produtora/…) destruída sem rastro.
============================================================ */
// ⚠️ NUNCA renomear para algo contendo "envio"/"retorno"/"fixo": sync-neon.js:tipoMov,
// datas.js:situacaoPrazo, api.js:getUltimoEnvio e o filtro Ação do /historico
// classificam por SUBSTRING dessas palavras. "Ajuste manual" cai em AJUSTE no enum.
export const ACAO_AJUSTE = "Ajuste manual";

const _val = (v) => {
  const s = String(v ?? "").trim();
  return s && s !== "-" ? s : "-";
};

/**
 * Planeja um ajuste manual de status: quais células da CONTROLE mudar (DIFF — só
 * o que realmente muda) e a linha A..K a gravar no HISTORICO, preservando a origem
 * (evento/produtora/comercial/saída) que a CONTROLE vai perder ao virar Estoque.
 * Puro: recebe a máquina (shape de repo/sheets.js), hoje ("dd/mm/aaaa") e o autor.
 * Retorna { nadaAMudar, celulas: [{col, value}], historicoRow }.
 */
export function montarAjusteStatus(maquina, statusNovo, hojeBRStr, autor) {
  const statusAnterior = _val(maquina.status);
  const celulas = [];

  if (statusAnterior !== statusNovo) celulas.push({ col: "G", value: statusNovo });

  const limpar = (col, atual) => {
    if (_val(atual) !== "-") celulas.push({ col, value: "-" });
  };
  if (statusNovo === "Fixo") {
    limpar("O", maquina.dataRetorno);
  } else if (statusNovo.startsWith("Estoque")) {
    limpar("J", maquina.idEvento);
    limpar("K", maquina.nomeEvento);
    limpar("L", maquina.produtora);
    limpar("M", maquina.comercial);
    limpar("O", maquina.dataRetorno);
  }

  if (celulas.length === 0) return { nadaAMudar: true, celulas: [], historicoRow: null };

  // col E do HISTORICO: Estoque = voltou HOJE (igual ao retorno normal);
  // Fixo = sem retorno; qualquer outro = mantém a data atual da CONTROLE.
  let dataRetornoHist = _val(maquina.dataRetorno);
  if (statusNovo.startsWith("Estoque")) dataRetornoHist = hojeBRStr;
  else if (statusNovo === "Fixo") dataRetornoHist = "-";

  const obs = statusAnterior === statusNovo
    ? `${ACAO_AJUSTE}: limpeza de vínculo de evento (status mantido: ${statusNovo})`
    : `${ACAO_AJUSTE}: ${statusAnterior} → ${statusNovo}`;

  return {
    nadaAMudar: false,
    celulas,
    historicoRow: [
      _val(maquina.serial),       // A serial
      _val(maquina.idEvento),     // B id_evento (ANTES da limpeza — origem preservada)
      ACAO_AJUSTE,                // C ação
      _val(maquina.dataSaida),    // D data saída (antes da limpeza)
      dataRetornoHist,            // E data retorno
      statusNovo,                 // F status (texto congelado; o app recalcula ao vivo)
      autor || "Sistema",         // G usuário
      _val(maquina.nomeEvento),   // H nome evento (antes da limpeza)
      _val(maquina.produtora),    // I produtora
      _val(maquina.comercial),    // J comercial
      obs                         // K observação (audit: de-onde → para-onde)
    ]
  };
}

/* ============================================================
   CONTRATO DE RESPOSTA DO /registrar-envio (total / parcial / nada)
   Antes um sucesso PARCIAL (N gravados, M recusados) voltava 422 ok:false —
   o operador achava que nada foi feito e reenviava.
============================================================ */
/** Traduz o `step` interno de recusa para português de operador. */
export function motivoRecusaEnvio(erro) {
  const st = erro?.statusAtual ? ` (status atual: ${erro.statusAtual})` : "";
  switch (erro?.step) {
    case "nao-esta-em-uso":    return `não está Em Uso/Fixo${st} — retorno recusado`;
    case "ja-fora-do-estoque": return `já está fora do estoque${st} — envio recusado`;
    case "serial-duplicado":   return "serial aparece mais de uma vez na planilha — resolva a duplicidade antes";
    case "not-found":          return "serial não encontrado na planilha CONTROLE";
    case "no-line":            return "não foi possível localizar a linha na planilha";
    case "invalid-serial":     return "serial vazio ou inválido";
    default:                   return `recusada (${erro?.step || "motivo desconhecido"})`;
  }
}

/**
 * Monta o corpo + status HTTP do resultado do envio.
 * - tudo gravado  → 200 { ok:true, gravados }
 * - PARCIAL       → 200 { ok:true, parcial:true, gravados, erros[+motivo], msg }
 *   (ok:true porque a planilha MUDOU: um front antigo cai no caminho de sucesso e
 *   recarrega — degradação graciosa, nunca "erro" com dado já gravado)
 * - nada gravado  → 422 { ok:false, gravados:0, erros[+motivo], msg }
 */
export function montarRespostaEnvio(gravados, recusados) {
  if (!recusados || recusados.length === 0) {
    return { http: 200, body: { ok: true, gravados } };
  }
  const erros = recusados.map((e) => ({ ...e, motivo: motivoRecusaEnvio(e) }));
  if (gravados === 0) {
    return {
      http: 422,
      body: { ok: false, gravados: 0, erros, msg: `Nenhuma máquina foi registrada (${erros.length} recusada(s)).` }
    };
  }
  return {
    http: 200,
    body: { ok: true, parcial: true, gravados, erros, msg: `${gravados} máquina(s) registrada(s); ${erros.length} recusada(s).` }
  };
}

/**
 * Acha um evento nas DUAS fontes de cadastro (lógica pura, testável).
 *
 * Por que duas fontes: a aba "DADOS EVENTOS" é 100% derivada — uma única fórmula
 * QUERY/IMPORTRANGE em A1 que expande milhares de linhas. Escrever uma linha
 * literal ali faz a expansão colidir e a fórmula inteira vira #REF! (a aba zera e
 * NENHUM evento é encontrado). Por isso o app grava os cadastros manuais numa aba
 * própria e junta as duas na LEITURA.
 *
 * Precedência: a oficial vence (é a fonte curada); a manual só complementa.
 * Cada `linhas` é o array cru do Sheets: [id, nome, produtora, comercial, ...].
 */
export function acharEvento(linhasOficiais, linhasManuais, alvo) {
  const id = String(alvo || "").trim();
  if (!id) return null;

  const casa = (lista) =>
    (Array.isArray(lista) ? lista : []).find(
      (r) => Array.isArray(r) && String(r[0] ?? "").trim() === id
    );

  const row = casa(linhasOficiais) || casa(linhasManuais);
  if (!row) return null;

  return {
    id_evento: row[0],
    nome_evento: row[1] || "-",
    produtora: row[2] || "-",
    comercial: row[3] || "-"
  };
}
