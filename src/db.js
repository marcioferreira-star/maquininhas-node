// db.js — camada de dados: CACHE central + seleção do backend de LEITURA.
// As leituras de lista/histórico são servidas por repo/sheets.js OU repo/neon.js
// conforme READ_BACKEND (default "sheets" = comportamento idêntico ao original).
// O caminho de ESCRITA (getMaquinasIndex resolve linha p/ o batchUpdate;
// getEventoInfo valida o envio) fica SEMPRE em sheets — o espelho é até 15min stale.
import { appendToSheet, ensureSheetExists } from "./sheet.js";
import { startOfDayLocal, agoraBR } from "./utils/datas.js";
import { resumoDeMaquinas } from "./utils/dominio.js";
import * as sheets from "./repo/sheets.js";
import { EVENTOS_MANUAIS_SHEET } from "./repo/sheets.js";
import * as neon from "./repo/neon.js";

const HISTORICO_SHEET = "HISTORICO MAQUINAS";

/** Backend de LEITURA (lista/histórico) selecionado por env. Rollback = flip + redeploy. */
function readBackend() {
  return process.env.READ_BACKEND === "neon" ? neon : sheets;
}

/* ============================================================
   🔵 CACHE (PERFORMANCE) — evita reler a fonte em sequência
============================================================ */
const CACHE = {
  maquinas: { ts: 0, ttlMs: 15_000, data: [] },
  maquinasIndex: { ts: 0, ttlMs: 15_000, data: new Map() },
  eventoInfo: { ttlMs: 5 * 60_000, map: new Map() }
};

function now() {
  return Date.now();
}
function isFresh(ts, ttlMs) {
  return ts && (now() - ts) < ttlMs;
}

/* ============================================================
   🔵 INVALIDAR CACHE DE MÁQUINAS
   - Chamar APÓS qualquer escrita na CONTROLE (envio/retorno/status).
============================================================ */
export function invalidarCacheMaquinas() {
  CACHE.maquinas.ts = 0;
  CACHE.maquinas.data = [];
  CACHE.maquinasIndex.ts = 0;
  CACHE.maquinasIndex.data = new Map();
}

/* ============================================================
   🔵 LISTA DE MÁQUINAS (COM CACHE) — backend selecionável
============================================================ */
export async function getMaquinas(options = {}) {
  const force = !!options.force;

  if (!force && isFresh(CACHE.maquinas.ts, CACHE.maquinas.ttlMs)) {
    return CACHE.maquinas.data;
  }

  // fetch PROPAGA erro (throw) → não cacheamos [] disfarçando falha de API.
  const maquinas = await readBackend().fetchMaquinas();

  CACHE.maquinas.ts = now();
  CACHE.maquinas.data = maquinas;
  // invalida o index para ser reconstruído
  CACHE.maquinasIndex.ts = 0;
  CACHE.maquinasIndex.data = new Map();

  return maquinas;
}

/* ============================================================
   🔵 MAPA serial → máquina (COM CACHE) — SEMPRE sheets (caminho de escrita)
   O api.js resolve a LINHA pelo serial e precisa do dado FRESCO da planilha.
============================================================ */
export async function getMaquinasIndex(options = {}) {
  const force = !!options.force;

  if (!force && isFresh(CACHE.maquinasIndex.ts, CACHE.maquinasIndex.ttlMs)) {
    return CACHE.maquinasIndex.data;
  }

  const arr = await sheets.fetchMaquinas(); // propaga erro de leitura

  const map = new Map();
  // seriais que aparecem 2×+ na CONTROLE são ambíguos: guardamos p/ a rota recusar.
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
   🔵 RESUMO DASHBOARD — segue o backend de leitura (via getMaquinas)
============================================================ */
export async function getResumo() {
  const maquinas = await getMaquinas(); // propaga erro de leitura
  // ✅ compara dia-a-dia, "hoje" em BRT (ver utils/datas.js). Lógica pura testável.
  return resumoDeMaquinas(maquinas, startOfDayLocal());
}

/* ============================================================
   🔵 BUSCAR DADOS DO EVENTO (COM CACHE) — SEMPRE sheets
   Validação do envio: um evento recém-cadastrado não estaria no espelho por até
   15min → 404 falso. Fica no Sheets enquanto a escrita for na planilha.
============================================================ */
export async function getEventoInfo(idEvento) {
  const alvo = String(idEvento || "").trim();
  if (!alvo) return null;

  const cached = CACHE.eventoInfo.map.get(alvo);
  if (cached && isFresh(cached.ts, CACHE.eventoInfo.ttlMs)) {
    return cached.data;
  }

  // fetchEventoInfo PROPAGA erro (getSheetData throw) → NÃO cacheamos null nesse
  // caso (senão falha transitória vira "ID não existe" grudado 5min). Só cacheia
  // null quando a leitura funcionou e o evento realmente não está lá.
  const data = await sheets.fetchEventoInfo(alvo);
  CACHE.eventoInfo.map.set(alvo, { ts: now(), data });
  return data;
}

/* ============================================================
   🔵 CADASTRAR EVENTO — escrita na aba DADOS EVENTOS MANUAIS
   ⚠️ NUNCA escrever em "DADOS EVENTOS": aquela aba é 100% derivada (uma única
   fórmula QUERY/IMPORTRANGE em A1 que expande ~3,5k linhas). Uma linha literal
   embaixo do resultado impede a próxima expansão → a fórmula vira #REF!, a aba
   zera e TODO evento passa a "não existir" no envio. A leitura junta as duas
   abas (repo/sheets.js:fetchEventoInfo).
============================================================ */
export async function cadastrarEvento({ id, nome, produtora, comercial, usuario }) {
  const alvo = String(id || "").trim();
  if (!alvo) return false;

  try {
    await ensureSheetExists(EVENTOS_MANUAIS_SHEET, [
      "ID Evento",
      "Nome Evento",
      "Produtora",
      "Comercial",
      "Cadastrado em",
      "Cadastrado por"
    ]);
  } catch (err) {
    console.error("❌ Falha ao garantir a aba de eventos manuais:", err);
    return false;
  }

  // RAW: o carimbo "dd/mm/aaaa hh:mm" tem que ficar TEXTO (USER_ENTERED faria o
  // Sheets reparsear em en-US e trocar dia↔mês).
  const ok = await appendToSheet(
    `'${EVENTOS_MANUAIS_SHEET}'!A:F`,
    [
      alvo,
      String(nome || "-"),
      String(produtora || "-"),
      String(comercial || "-"),
      agoraBR(),
      String(usuario || "Sistema")
    ],
    { valueInputOption: "RAW" }
  );

  if (ok) CACHE.eventoInfo.map.delete(alvo); // força re-leitura fresca
  return ok;
}

/* ============================================================
   🔵 REGISTRAR MOVIMENTO (HISTÓRICO) — escrita na planilha
   - Aceita 1 linha (obj) ou várias linhas (array de arrays)
============================================================ */
export async function registrarMovimento(info) {
  try {
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
    return await appendToSheet(`'${HISTORICO_SHEET}'!A:K`, info);
  } catch (err) {
    console.error("❌ registrarMovimento erro:", err);
    return false;
  }
}

/* ============================================================
   🔵 HISTÓRICO COMPLETO (sem cache) — backend selecionável
============================================================ */
export async function getHistorico() {
  return readBackend().fetchHistorico();
}
