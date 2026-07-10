// src/excecoes.js
// Repositório das abas de EXCEÇÃO (PERDIDAS / TROCAS / LOCALIZAR) que o app
// antes ignorava. Isolado como módulo p/ a migração Sheets→Neon ser só um adapter.
//
// ⚠️ As ESCRITAS aqui são chamadas pelas rotas SÓ quando o flag EXCECOES_ATIVAS=1
//    (ver src/routes/api.js). Este módulo não checa o flag — quem gateia é a rota.

import { getSheetData, appendToSheet, batchUpdateValues } from "./sheet.js";
import { getMaquinasIndex, invalidarCacheMaquinas } from "./db.js";

const CONTROLE = "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE";
const PERDIDAS = "PERDIDAS PAGSEGURO - INGRESSE";
const TROCAS = "TROCAS";
const LOCALIZAR = "LOCALIZAR";

// erro de negócio (rota devolve 400) vs erro inesperado (500)
export class ErroExcecao extends Error {}

/* ============================================================
   🔵 LEITURAS (para a tela /excecoes)
============================================================ */
export async function getPerdidas() {
  const dados = await getSheetData(`'${PERDIDAS}'!A2:P`);
  return (dados || [])
    .filter((r) => String(r[0] || "").trim())
    .map((r) => ({
      serial: r[0] || "-",
      status: r[3] || "-",
      local: r[4] || "-",
      empresa: r[6] || "-",
      idEvento: r[7] || "-",
      nomeEvento: r[8] || "-",
      responsavel: r[9] || "-",
      comercial: r[10] || "-",
      dataEnvio: r[11] || "-",
      observacao: r[13] || "-"
    }));
}

export async function getTrocas() {
  const dados = await getSheetData(`'${TROCAS}'!A2:D`);
  return (dados || [])
    .filter((r) => String(r[0] || "").trim())
    .map((r) => ({
      defeito: r[0] || "-",
      problema: r[1] || "-",
      local: r[2] || "-",
      nova: r[3] || "-"
    }));
}

export async function getLocalizar() {
  const dados = await getSheetData(`'${LOCALIZAR}'!A2:K`);
  return (dados || [])
    .filter((r) => String(r[2] || "").trim())
    .map((r) => ({
      modelo: r[1] || "-",
      serial: r[2] || "-",
      referencia: r[10] || "-"
    }));
}

/* ============================================================
   🔵 ESCRITAS (gated pelo flag na rota)
============================================================ */

// Marca uma máquina como PERDIDA: grava linha em PERDIDAS e tira das contagens
// (status "Perdida" na CONTROLE — antes a máquina perdida contava como disponível).
export async function marcarPerdida({ serial, responsavel, observacao }) {
  const s = String(serial || "").trim();
  if (!s) throw new ErroExcecao("Informe o serial.");

  const idx = await getMaquinasIndex({ force: true });
  if (idx.duplicados && idx.duplicados.has(s)) {
    throw new ErroExcecao("Serial duplicado na CONTROLE — resolver a duplicidade antes.");
  }
  const m = idx.get(s);
  if (!m) throw new ErroExcecao(`Serial ${s} não encontrado na CONTROLE.`);

  const row = [
    s,                          // A Nº Serial
    m.operadora || "-",         // B Operadora
    m.infoChip || "-",          // C Info Chip
    "Perdida",                  // D Status
    "-",                        // E Local
    "-",                        // F Processando?
    "Perdida",                  // G Empresa
    m.idEvento || "-",          // H Id Evento
    m.nomeEvento || "-",        // I Nome Evento
    String(responsavel || "-"), // J Responsável
    m.comercial || "-",         // K Comercial
    m.dataSaida || "-",         // L Data de envio
    "-",                        // M Data Retorno
    String(observacao || "-"),  // N OBSERVAÇÃO
    "",                         // O
    "1"                         // P Count
  ];

  // 1) status na CONTROLE (com snapshot p/ rollback) → 2) append na PERDIDAS
  const okStatus = await batchUpdateValues([
    { range: `'${CONTROLE}'!G${m.linha}`, value: "Perdida" }
  ]);
  if (!okStatus) throw new ErroExcecao("Falha ao atualizar o status na CONTROLE.");
  invalidarCacheMaquinas();

  const okAppend = await appendToSheet(`'${PERDIDAS}'!A:P`, row);
  if (!okAppend) {
    // rollback do status
    await batchUpdateValues([{ range: `'${CONTROLE}'!G${m.linha}`, value: m.status || "-" }]);
    invalidarCacheMaquinas();
    throw new ErroExcecao("Falha ao gravar em PERDIDAS — o status foi revertido.");
  }
  return true;
}

// Registra uma TROCA (máquina defeituosa → nova) e tira a defeituosa das contagens.
export async function registrarTroca({ serialDefeito, problema, local, serialNova }) {
  const d = String(serialDefeito || "").trim();
  if (!d) throw new ErroExcecao("Informe o serial da máquina com defeito.");

  const ok = await appendToSheet(`'${TROCAS}'!A:D`, [
    d,
    String(problema || "-"),
    String(local || "-"),
    String(serialNova || "-")
  ]);
  if (!ok) throw new ErroExcecao("Falha ao gravar em TROCAS.");

  // marca a defeituosa como "Defeito" na CONTROLE (sai das contagens), se existir
  const idx = await getMaquinasIndex({ force: true });
  const m = idx.get(d);
  if (m && !(idx.duplicados && idx.duplicados.has(d))) {
    await batchUpdateValues([{ range: `'${CONTROLE}'!G${m.linha}`, value: "Defeito" }]);
    invalidarCacheMaquinas();
  }
  return true;
}

// Envia uma máquina para LOCALIZAR (append) e marca status "Localizar".
export async function enviarParaLocalizar({ serial, referencia }) {
  const s = String(serial || "").trim();
  if (!s) throw new ErroExcecao("Informe o serial.");

  const idx = await getMaquinasIndex({ force: true });
  const m = idx.get(s);
  const modelo = m ? (m.modelo || "-") : "-";

  // LOCALIZAR tem o mesmo layout da CONTROLE; a referência vai na col Nome Evento (K)
  const row = ["", modelo, s, "", "", "", "", "", "", "", String(referencia || "-")];
  const ok = await appendToSheet(`'${LOCALIZAR}'!A:K`, row);
  if (!ok) throw new ErroExcecao("Falha ao gravar em LOCALIZAR.");

  if (m && !(idx.duplicados && idx.duplicados.has(s))) {
    await batchUpdateValues([{ range: `'${CONTROLE}'!G${m.linha}`, value: "Localizar" }]);
    invalidarCacheMaquinas();
  }
  return true;
}
