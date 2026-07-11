// src/repo/sheets.js — adapter de LEITURA sobre a planilha (fonte viva).
// Fetch + shape PUROS (sem cache — o cache mora em db.js). Extraído de db.js na
// Fase 1 do cutover. Comportamento idêntico ao db.js original quando READ_BACKEND
// é "sheets" (default), então o corte de leitura é reversível por env var.
import { getSheetData } from "../sheet.js";
import { serialSheetParaBR } from "../utils/datas.js";
import { montarHistorico } from "../utils/dominio.js";

const SHEET_NAME = "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE";
const HISTORICO_SHEET = "HISTORICO MAQUINAS";
const EVENTOS_SHEET = "DADOS EVENTOS";

/** Lista de máquinas no shape que as rotas/views esperam (status/data cruas, "-" p/ vazio). */
export async function fetchMaquinas() {
  const dados = await getSheetData(`'${SHEET_NAME}'!A2:P`);
  if (!dados || dados.length === 0) return [];
  return dados.map((linha, i) => ({
    linha: i + 2,
    modelo: linha[1] || "-",
    serial: linha[2] || "-",
    operadora: linha[3] || "-",
    infoChip: linha[4] || "-",
    status: linha[6] || "-",
    processando: linha[7] || "-",
    empresa: linha[8] || "-",
    idEvento: linha[9] || "-",
    nomeEvento: linha[10] || "-",
    produtora: linha[11] || "-",
    comercial: linha[12] || "-",
    dataSaida: serialSheetParaBR(linha[13]) || "-",
    dataRetorno: serialSheetParaBR(linha[14]) || "-",
    observacao: linha[15] || "-"
  }));
}

/** Histórico já derivado (situação/Devolvida ao vivo) via montarHistorico. */
export async function fetchHistorico() {
  const dados = await getSheetData(`'${HISTORICO_SHEET}'!A2:K`);
  return montarHistorico(dados);
}

/** Info de um evento (id já trimado por db.js). Null se não existe. */
export async function fetchEventoInfo(alvo) {
  const linhas = await getSheetData(`'${EVENTOS_SHEET}'!A2:D`);
  const row = linhas.find((r) => String(r[0]).trim() === alvo);
  if (!row) return null;
  return {
    id_evento: row[0],
    nome_evento: row[1] || "-",
    produtora: row[2] || "-",
    comercial: row[3] || "-"
  };
}
