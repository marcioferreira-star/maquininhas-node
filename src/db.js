// db.js
import {
  getSheetData,
  appendToSheet
} from "./sheet.js";
import { startOfDayLocal, serialSheetParaBR } from "./utils/datas.js";
import { resumoDeMaquinas, montarHistorico } from "./utils/dominio.js";

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
   🔵 INVALIDAR CACHE DE MÁQUINAS
   - Chamar APÓS qualquer escrita na CONTROLE (envio/retorno/status),
     senão o dashboard/lista servem o snapshot pré-escrita por até 15s.
============================================================ */
export function invalidarCacheMaquinas() {
  CACHE.maquinas.ts = 0;
  CACHE.maquinas.data = [];
  CACHE.maquinasIndex.ts = 0;
  CACHE.maquinasIndex.data = new Map();
}

/* ============================================================
   🔵 CARREGAR LISTA DE MÁQUINAS (A → O)  (COM CACHE)
============================================================ */
export async function getMaquinas(options = {}) {
  const force = !!options.force;

  if (!force && isFresh(CACHE.maquinas.ts, CACHE.maquinas.ttlMs)) {
    return CACHE.maquinas.data;
  }

  // range ABERTO (A2:O) — o Sheets limita pelo fim dos dados. Antes era
  // A2:O2000, que truncaria silenciosamente ao passar de ~2000 máquinas.
  // getSheetData PROPAGA erro (throw) → não cacheamos [] disfarçando falha de API.
  const range = `'${SHEET_NAME}'!A2:O`;
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
}

/* ============================================================
   🔵 MAPA serial → { linha, ... } (COM CACHE)
============================================================ */
export async function getMaquinasIndex(options = {}) {
  const force = !!options.force;

  if (!force && isFresh(CACHE.maquinasIndex.ts, CACHE.maquinasIndex.ttlMs)) {
    return CACHE.maquinasIndex.data;
  }

  const arr = await getMaquinas({ force }); // propaga erro de leitura

  const map = new Map();
  // seriais que aparecem 2×+ na CONTROLE são ambíguos: map.set sobrescreveria
  // silenciosamente e a resolução "sempre pelo serial" gravaria na linha errada.
  // Guardamos os duplicados p/ a rota recusar a operação (ver api.js).
  const duplicados = new Set();
  for (const m of arr) {
    const serial = String(m.serial || "").trim();
    if (serial && serial !== "-") {
      if (map.has(serial)) duplicados.add(serial);
      map.set(serial, m);
    }
  }
  map.duplicados = duplicados;

  CACHE.maquinasIndex.ts = now();
  CACHE.maquinasIndex.data = map;

  return map;
}

/* ============================================================
   🔵 RESUMO DASHBOARD
============================================================ */
export async function getResumo() {
  const maquinas = await getMaquinas(); // propaga erro de leitura
  // ✅ compara dia-a-dia, "hoje" em BRT (ver utils/datas.js). Lógica pura testável.
  return resumoDeMaquinas(maquinas, startOfDayLocal());
}

/* ============================================================
   🔵 BUSCAR DADOS DO EVENTO (COM CACHE)
============================================================ */
export async function getEventoInfo(idEvento) {
  const alvo = String(idEvento || "").trim();
  if (!alvo) return null;

  // cache hit
  const cached = CACHE.eventoInfo.map.get(alvo);
  if (cached && isFresh(cached.ts, CACHE.eventoInfo.ttlMs)) {
    return cached.data;
  }

  // ⚠️ getSheetData PROPAGA erro (throw). NÃO cacheamos null nesse caso —
  // senão uma falha transitória da API vira "ID não existe" grudado por 5 min.
  // Só cacheamos null quando a leitura funcionou e o evento realmente não está lá.
  const linhas = await getSheetData(`'${EVENTOS_SHEET}'!A2:D`);
  const row = linhas.find((r) => String(r[0]).trim() === alvo);

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
}

/* ============================================================
   🔵 CADASTRAR EVENTO (aba DADOS EVENTOS)
   - Append de 1 linha (ID, Nome, Produtora, Comercial).
   - Invalida o cache daquele ID p/ o lookup seguinte já enxergar.
============================================================ */
export async function cadastrarEvento({ id, nome, produtora, comercial }) {
  const alvo = String(id || "").trim();
  if (!alvo) return false;

  const ok = await appendToSheet(`'${EVENTOS_SHEET}'!A:D`, [
    alvo,
    String(nome || "-"),
    String(produtora || "-"),
    String(comercial || "-")
  ]);

  if (ok) CACHE.eventoInfo.map.delete(alvo); // força re-leitura fresca
  return ok;
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
  // range ABERTO (A2:K) — HISTORICO é append-only e cresce sempre; teto fixo truncaria.
  // getSheetData PROPAGA erro; a derivação (situação/Devolvida) é pura e testável.
  const dados = await getSheetData(`'${HISTORICO_SHEET}'!A2:K`);
  return montarHistorico(dados);
}
