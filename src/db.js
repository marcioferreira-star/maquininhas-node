// db.js
import {
  getSheetData,
  appendToSheet
} from "./sheet.js";
import { parseBRDate, startOfDayLocal, situacaoPrazo, serialSheetParaBR } from "./utils/datas.js";

const SHEET_NAME = "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE";
const HISTORICO_SHEET = "HISTORICO MAQUINAS";
const EVENTOS_SHEET = "DADOS EVENTOS";

/* ============================================================
   🔵 CACHE (PERFORMANCE)
   - Evita reler a planilha em sequência (principal causa de lentidão)
============================================================ */
const CACHE = {
  // Máquinas (A2:O2000)
  maquinas: {
    ts: 0,
    ttlMs: 15_000, // 15s
    data: []
  },

  // Index serial -> máquina (derivado de maquinas)
  maquinasIndex: {
    ts: 0,
    ttlMs: 15_000, // 15s (mesmo do cache de maquinas)
    data: new Map()
  },

  // EventoInfo por id_evento
  eventoInfo: {
    ttlMs: 5 * 60_000, // 5min
    map: new Map() // id -> { ts, data }
  }
};

function now() {
  return Date.now();
}

function isFresh(ts, ttlMs) {
  return ts && (now() - ts) < ttlMs;
}

/* ============================================================
   🔵 CARREGAR LISTA DE MÁQUINAS (A → O)  (COM CACHE)
============================================================ */
export async function getMaquinas(options = {}) {
  const force = !!options.force;

  try {
    if (!force && isFresh(CACHE.maquinas.ts, CACHE.maquinas.ttlMs)) {
      return CACHE.maquinas.data;
    }

    const range = `'${SHEET_NAME}'!A2:O2000`;
    const dados = await getSheetData(range);

    if (!dados || dados.length === 0) {
      CACHE.maquinas.ts = now();
      CACHE.maquinas.data = [];
      // também invalida index
      CACHE.maquinasIndex.ts = 0;
      CACHE.maquinasIndex.data = new Map();
      return [];
    }

    const maquinas = dados.map((linha, i) => ({
      linha: i + 2,
      modelo: linha[1] || "-",
      serial: linha[2] || "-",
      status: linha[6] || "-",
      empresa: linha[8] || "-",
      idEvento: linha[9] || "-",
      nomeEvento: linha[10] || "-",
      produtora: linha[11] || "-",
      comercial: linha[12] || "-",
      // ✅ converte número-de-série do Sheets de volta para dd/mm/aaaa
      dataSaida: serialSheetParaBR(linha[13]) || "-",
      dataRetorno: serialSheetParaBR(linha[14]) || "-"
    }));

    CACHE.maquinas.ts = now();
    CACHE.maquinas.data = maquinas;

    // invalida o index para ser reconstruído com esse snapshot
    CACHE.maquinasIndex.ts = 0;
    CACHE.maquinasIndex.data = new Map();

    return maquinas;
  } catch (err) {
    console.error("❌ Erro ao carregar máquinas:", err);
    return [];
  }
}

/* ============================================================
   🔵 MAPA serial → { linha, ... } (COM CACHE)
============================================================ */
export async function getMaquinasIndex(options = {}) {
  const force = !!options.force;

  try {
    if (!force && isFresh(CACHE.maquinasIndex.ts, CACHE.maquinasIndex.ttlMs)) {
      return CACHE.maquinasIndex.data;
    }

    const arr = await getMaquinas({ force });

    const map = new Map();
    for (const m of arr) {
      const serial = String(m.serial || "").trim();
      if (serial && serial !== "-") {
        map.set(serial, m);
      }
    }

    CACHE.maquinasIndex.ts = now();
    CACHE.maquinasIndex.data = map;

    return map;
  } catch (err) {
    console.error("❌ Erro ao montar index de máquinas:", err);
    return new Map();
  }
}

/* ============================================================
   🔵 RESUMO DASHBOARD
============================================================ */
export async function getResumo() {
  try {
    const maquinas = await getMaquinas();
    const hoje = startOfDayLocal(); // ✅ compara dia-a-dia, sem ruído do horário/UTC

    let disponiveisSP = 0;
    let disponiveisRJ = 0;
    let disponiveisURA = 0;

    const total = maquinas.length;

    const disponiveis = maquinas.filter(m => {
      const st = (m.status || "").toUpperCase();

      if (st.includes("ESTOQUE")) {
        if (st.includes("SP")) disponiveisSP++;
        else if (st.includes("RJ")) disponiveisRJ++;
        else if (st.includes("URA")) disponiveisURA++;
        return true;
      }
      return false;
    }).length;

    const emUso = maquinas.filter(m => {
      const st = (m.status || "").toLowerCase().trim();
      return st.includes("em uso") || st === "fixo";
    }).length;

    const fixas = maquinas.filter(m =>
      (m.status || "").toLowerCase().trim() === "fixo"
    ).length;

    const atrasadas = maquinas.filter(m => {
      const st = (m.status || "").toLowerCase().trim();
      if (st === "fixo") return false;
      if (!st.includes("em uso")) return false;

      const dataRet = parseBRDate(m.dataRetorno); // meia-noite local ou null
      if (!dataRet) return false;

      // ✅ atrasada só se a data de retorno JÁ PASSOU (vence hoje = ainda no prazo)
      return dataRet < hoje;
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
  } catch (err) {
    console.error("❌ Erro resumo:", err);
    return {
      total: 0,
      disponiveis: 0,
      disponiveisSP: 0,
      disponiveisRJ: 0,
      disponiveisURA: 0,
      emUso: 0,
      fixas: 0,
      atrasadas: 0
    };
  }
}

/* ============================================================
   🔵 BUSCAR DADOS DO EVENTO (COM CACHE)
============================================================ */
export async function getEventoInfo(idEvento) {
  try {
    const alvo = String(idEvento || "").trim();
    if (!alvo) return null;

    // cache hit
    const cached = CACHE.eventoInfo.map.get(alvo);
    if (cached && isFresh(cached.ts, CACHE.eventoInfo.ttlMs)) {
      return cached.data;
    }

    // lê planilha
    const linhas = await getSheetData(`'${EVENTOS_SHEET}'!A2:D`);
    const row = linhas.find(r => String(r[0]).trim() === alvo);

    if (!row) {
      CACHE.eventoInfo.map.set(alvo, { ts: now(), data: null });
      return null;
    }

    const data = {
      id_evento: row[0],
      nome_evento: row[1] || "-",
      produtora: row[2] || "-",
      comercial: row[3] || "-"
    };

    CACHE.eventoInfo.map.set(alvo, { ts: now(), data });
    return data;
  } catch (err) {
    console.error("❌ Erro ao buscar dados do evento:", err);
    return null;
  }
}

/* ============================================================
   🔵 REGISTRAR MOVIMENTO (HISTÓRICO)
   - Aceita 1 linha (obj) ou várias linhas (array de arrays)
============================================================ */
export async function registrarMovimento(info) {
  try {
    // compat anterior (1 linha só)
    if (!Array.isArray(info)) {
      if (!info.serial) return false;
      const row = [
        info.serial,
        info.id_evento,
        info.acao,
        info.data_saida || "-",
        info.data_retorno || "-",
        info.statusFinal || "-",
        info.usuario || "Sistema",
        info.nome_evento || "-",
        info.produtora || "-",
        info.comercial || "-",
        info.observacao || "-"
      ];
      return await appendToSheet(`'${HISTORICO_SHEET}'!A:K`, row);
    }

    // novo: várias linhas de uma vez (já no formato A..K)
    return await appendToSheet(`'${HISTORICO_SHEET}'!A:K`, info);
  } catch (err) {
    console.error("❌ registrarMovimento erro:", err);
    return false;
  }
}

/* ============================================================
   🔵 HISTÓRICO COMPLETO
   - Sem cache (pra refletir o “último” imediatamente no front)
   - situacao: prazo calculado AO VIVO (ver utils/datas.js)
============================================================ */
export async function getHistorico() {
  try {
    const dados = await getSheetData(`'${HISTORICO_SHEET}'!A2:K20000`);
    if (!dados || dados.length === 0) return [];

    // índice do ÚLTIMO movimento de cada serial (planilha está em ordem cronológica de append)
    const ultimoIdxPorSerial = new Map();
    dados.forEach((l, i) => {
      const s = String(l[0] || "").trim();
      if (s) ultimoIdxPorSerial.set(s, i);
    });

    return dados.map((l, i) => {
      const serial = String(l[0] || "-").trim();
      const acao = l[2] || "-";
      // ✅ converte número-de-série do Sheets de volta para dd/mm/aaaa
      const saida = serialSheetParaBR(l[3]) || "-";
      const retorno = serialSheetParaBR(l[4]) || "-";

      // Situação de prazo AO VIVO (ignora o texto congelado na planilha).
      // Só vale para a linha de Envio que ainda é o ÚLTIMO movimento do serial
      // (ou seja, a máquina ainda está fora). Envios já sucedidos por um retorno = "Devolvida".
      let situacao = situacaoPrazo(acao, retorno);
      if (situacao && situacao !== "Fixo" && ultimoIdxPorSerial.get(serial) !== i) {
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
  } catch (err) {
    console.error("❌ Erro getHistorico:", err);
    return [];
  }
}
