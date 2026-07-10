// tools/etl/import-staging.js
// Onda 6 — Fase 2: carrega 100% das 6 abas no schema `staging` do Neon
// (raw + parseado + motivo_revisao). Não altera a planilha. Não promove nada
// para o schema public — a PROMOÇÃO depende da curadoria (decisão do Marcio).
//
// Uso: node tools/etl/import-staging.js   (lê DATABASE_URL do .env)

import "dotenv/config";
import pg from "pg";
import { getSheetData } from "../../src/sheet.js";
import { serialSheetParaBR } from "../../src/utils/datas.js";

const TABS = {
  CONTROLE: "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE",
  HISTORICO: "HISTORICO MAQUINAS",
  EVENTOS: "DADOS EVENTOS",
  PERDIDAS: "PERDIDAS PAGSEGURO - INGRESSE",
  TROCAS: "TROCAS",
  LOCALIZAR: "LOCALIZAR"
};

const ANO_MIN = 2018;
const ANO_MAX = new Date().getFullYear() + 2;
const SENTINELAS = new Set(["01/01/2040", "15/07/1905"]);

// ---- helpers de parse ----
function classificaData(v) {
  const s = serialSheetParaBR(String(v ?? "").trim());
  if (!s || s === "-" || s === "0") return { tipo: "vazio", br: "" };
  if (SENTINELAS.has(s)) return { tipo: "sentinela", br: s };
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return { tipo: "nao-data", br: s };
  const ano = Number(m[3]);
  if (ano < ANO_MIN || ano > ANO_MAX) return { tipo: "lixo", br: s };
  return { tipo: "ok", br: s, y: m[3], mo: m[2].padStart(2, "0"), d: m[1].padStart(2, "0") };
}
function dataISO(v) {
  const c = classificaData(v);
  if (c.tipo === "ok") return { iso: `${c.y}-${c.mo}-${c.d}`, raw: c.br, motivo: null };
  if (c.tipo === "sentinela") return { iso: null, raw: c.br, motivo: "sentinela" };
  if (c.tipo === "lixo" || c.tipo === "nao-data") return { iso: null, raw: c.br, motivo: "data_suspeita" };
  return { iso: null, raw: "", motivo: null };
}
function mapStatus(g) {
  const s = String(g ?? "").trim();
  let m = /^(estoque|em uso)\s+(sp|rj|ura)$/i.exec(s);
  if (m) return { status: m[1].toLowerCase() === "estoque" ? "ESTOQUE" : "EM_USO", local: m[2].toUpperCase(), motivo: null };
  if (/^fixo$/i.test(s)) return { status: "FIXO", local: null, motivo: null };
  if (/^perdida$/i.test(s)) return { status: "PERDIDA", local: null, motivo: null };
  if (/^defeito$/i.test(s)) return { status: "DEFEITO", local: null, motivo: null };
  if (/^localizar$/i.test(s)) return { status: "LOCALIZAR", local: null, motivo: null };
  return { status: null, local: null, motivo: "status_fora_mapa" };
}
function parseId(v, nome) {
  const raw = String(v ?? "").trim();
  const temNome = nome && String(nome).trim() && String(nome).trim() !== "-";
  if (/^\d+$/.test(raw)) return { id: raw, motivo: null };
  if (/n\/?a/i.test(raw)) return { id: null, motivo: "id_na" };
  const embut = /ID:?\s*(\d{4,6})/i.exec(String(nome || ""));
  if ((!raw || raw === "-") && temNome) return { id: null, motivo: embut ? "id_no_nome" : "sem_id_com_nome" };
  if (raw && raw !== "-") return { id: null, motivo: "id_nao_numerico" };
  return { id: null, motivo: null }; // vazio, sem nome = estoque não-vinculado (ok)
}
function parseProdutora(v) {
  const s = String(v ?? "").trim();
  const m = /^(\d+)\s*\|\s*(.+)$/.exec(s);
  if (m) return { codigo: Number(m[1]), nome: m[2].trim() };
  return { codigo: null, nome: s && s !== "-" ? s : null };
}
function adquirente(serial) {
  const s = String(serial || "").trim().toUpperCase();
  if (/^PB09/.test(s)) return "Stone";
  if (/^(257|259)/.test(s)) return "GetNet";
  if (/^4A/.test(s)) return "Cielo";
  if (/^PB/.test(s) || /^\d+$/.test(s)) return "PagSeguro";
  return null;
}

// ---- DDL do schema staging (self-contido, re-runnable) ----
const DDL = `
CREATE SCHEMA IF NOT EXISTS staging;
DROP TABLE IF EXISTS staging.controle, staging.historico, staging.eventos,
  staging.perdidas, staging.trocas, staging.localizar CASCADE;

CREATE TABLE staging.controle (
  origem_linha INT, raw JSONB,
  serial TEXT, modelo TEXT, operadora TEXT, info_chip TEXT, empresa TEXT,
  adquirente TEXT, processando BOOLEAN, observacao TEXT,
  status_raw TEXT, status maquina_status, local praca,
  id_evento_raw TEXT, id_evento BIGINT,
  data_saida_raw TEXT, data_saida DATE, data_retorno_raw TEXT, data_retorno DATE,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE staging.historico (
  origem_linha INT, raw JSONB,
  serial TEXT, acao TEXT, tipo movimento_tipo, usuario TEXT, observacao TEXT, nome_evento TEXT,
  id_evento_raw TEXT, id_evento BIGINT,
  data_saida_raw TEXT, data_saida DATE, data_retorno_raw TEXT, data_retorno DATE,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE staging.eventos (
  origem_linha INT, raw JSONB,
  id_evento_raw TEXT, id_evento BIGINT, nome TEXT,
  produtora_codigo INT, produtora_nome TEXT, comercial TEXT,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE staging.perdidas (
  origem_linha INT, raw JSONB,
  serial TEXT, status_perda TEXT, local TEXT, empresa TEXT,
  id_evento_raw TEXT, id_evento BIGINT, nome_evento TEXT, responsavel TEXT, comercial TEXT,
  data_envio_raw TEXT, data_envio DATE, observacao TEXT,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE staging.trocas (
  origem_linha INT, raw JSONB,
  serial_defeito TEXT, problema TEXT, local TEXT, serial_nova TEXT,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE staging.localizar (
  origem_linha INT, raw JSONB,
  modelo TEXT, serial TEXT, referencia TEXT,
  motivo_revisao TEXT[] NOT NULL DEFAULT '{}'
);
`;

async function bulkInsert(client, tabela, cols, linhas) {
  if (!linhas.length) return;
  const CHUNK = 300;
  for (let off = 0; off < linhas.length; off += CHUNK) {
    const slice = linhas.slice(off, off + CHUNK);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of slice) {
      values.push("(" + cols.map(() => `$${p++}`).join(",") + ")");
      params.push(...row);
    }
    await client.query(
      `INSERT INTO ${tabela} (${cols.join(",")}) VALUES ${values.join(",")}`,
      params
    );
  }
}
const j = (row) => JSON.stringify(row);
const nn = (v) => (v && String(v).trim() && String(v).trim() !== "-" ? String(v).trim() : null);
const dedupMotivos = (arr) => [...new Set(arr.filter(Boolean))];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL não está no .env."); process.exit(1); }
  const direta = url.replace("-pooler", "");

  console.log("Lendo as 6 abas (read-only)…");
  const [controle, historico, eventos, perdidas, trocas, localizar] = await Promise.all([
    getSheetData(`'${TABS.CONTROLE}'!A2:P`),
    getSheetData(`'${TABS.HISTORICO}'!A2:K`),
    getSheetData(`'${TABS.EVENTOS}'!A2:D`),
    getSheetData(`'${TABS.PERDIDAS}'!A2:P`),
    getSheetData(`'${TABS.TROCAS}'!A2:D`),
    getSheetData(`'${TABS.LOCALIZAR}'!A2:K`)
  ]);

  // conjuntos p/ tag de serial em múltiplas abas
  const setPerdidas = new Set(perdidas.map((r) => nn(r[0])).filter(Boolean));
  const setLocalizar = new Set(localizar.map((r) => nn(r[2])).filter(Boolean));

  // ---- CONTROLE ----
  const rowsControle = controle.map((r, i) => {
    const st = mapStatus(r[6]);
    const idp = parseId(r[9], r[10]);
    const dS = dataISO(r[13]);
    const dR = dataISO(r[14]);
    const serial = nn(r[2]);
    const motivos = dedupMotivos([
      st.motivo, idp.motivo, dS.motivo === "sentinela" ? null : dS.motivo, dR.motivo === "sentinela" ? null : dR.motivo,
      serial && (setPerdidas.has(serial) || setLocalizar.has(serial)) ? "serial_multi_aba" : null
    ]);
    return [
      i + 2, j(r), serial, nn(r[1]), nn(r[3]), nn(r[4]), nn(r[8]),
      adquirente(serial), /Sim/i.test(String(r[7] || "")), nn(r[15]),
      nn(r[6]), st.status, st.local,
      nn(r[9]), idp.id, dS.raw, dS.iso, dR.raw, dR.iso, motivos
    ];
  });

  // ---- HISTORICO ----
  const tipoMov = (acao) => {
    const a = String(acao || "").toLowerCase();
    if (a.includes("retorno")) return "RETORNO";
    if (a.includes("fixo")) return "ENVIO_FIXO";
    if (a.includes("envio")) return "ENVIO";
    return "AJUSTE";
  };
  const rowsHistorico = historico.map((r, i) => {
    const idp = parseId(r[1], r[7]);
    const dS = dataISO(r[3]);
    const dR = dataISO(r[4]);
    const motivos = dedupMotivos([
      dS.motivo === "sentinela" ? null : dS.motivo, dR.motivo === "sentinela" ? null : dR.motivo,
      idp.motivo === "sem_id_com_nome" ? "id_no_historico_sem_id" : null
    ]);
    return [
      i + 2, j(r), nn(r[0]), nn(r[2]), tipoMov(r[2]), nn(r[6]), nn(r[10]), nn(r[7]),
      nn(r[1]), idp.id, dS.raw, dS.iso, dR.raw, dR.iso, motivos
    ];
  });

  // ---- EVENTOS (com dedup divergente) ----
  const vistoPorId = new Map(); // id -> Set(chaves)
  const rowsEventos = eventos.map((r, i) => {
    const idRaw = nn(r[0]);
    const prod = parseProdutora(r[2]);
    const chave = `${nn(r[1]) || ""}|${nn(r[2]) || ""}|${nn(r[3]) || ""}`;
    let motivo = null;
    if (idRaw && /^\d+$/.test(idRaw)) {
      if (!vistoPorId.has(idRaw)) vistoPorId.set(idRaw, new Set());
      const set = vistoPorId.get(idRaw);
      if (set.size >= 1 && !set.has(chave)) motivo = "evento_divergente";
      set.add(chave);
    } else if (idRaw) {
      motivo = "id_nao_numerico";
    }
    return [
      i + 2, j(r), nn(r[0]), (idRaw && /^\d+$/.test(idRaw)) ? idRaw : null, nn(r[1]),
      prod.codigo, prod.nome, nn(r[3]), dedupMotivos([motivo])
    ];
  });

  // ---- PERDIDAS ----
  const rowsPerdidas = perdidas.map((r, i) => {
    const idp = parseId(r[7], r[8]);
    const dE = dataISO(r[11]);
    // col L/M podem ter texto (JURÍDICO/MENSAL) → vira status_perda
    const cL = classificaData(r[11]);
    const cM = classificaData(r[12]);
    const statusPerda = (cL.tipo === "nao-data" ? cL.br : "") || (cM.tipo === "nao-data" ? cM.br : "") || nn(r[3]);
    const motivos = dedupMotivos([
      idp.motivo, dE.motivo === "sentinela" ? null : dE.motivo,
      (cL.tipo === "nao-data" || cM.tipo === "nao-data") ? "texto_em_data" : null
    ]);
    return [
      i + 2, j(r), nn(r[0]), statusPerda, nn(r[4]), nn(r[6]),
      nn(r[7]), idp.id, nn(r[8]), nn(r[9]), nn(r[10]),
      dE.raw, dE.iso, nn(r[13]), motivos
    ];
  });

  // ---- TROCAS ----
  const rowsTrocas = trocas.map((r, i) => {
    const semNova = !nn(r[3]);
    return [
      i + 2, j(r), nn(r[0]), nn(r[1]), nn(r[2]), nn(r[3]),
      dedupMotivos([semNova ? "troca_sem_substituta" : null])
    ];
  });

  // ---- LOCALIZAR ----
  const rowsLocalizar = localizar.map((r, i) => {
    const ref = nn(r[10]);
    const resolvida = ref && /^\*|voltou|encontrad/i.test(ref);
    return [i + 2, j(r), nn(r[1]), nn(r[2]), ref, dedupMotivos([resolvida ? "provavel_resolvida" : null])];
  });

  // ---- grava no Neon ----
  const client = new pg.Client({ connectionString: direta, ssl: true });
  await client.connect();
  console.log("Recriando schema staging e carregando…");
  await client.query(DDL);

  await bulkInsert(client, "staging.controle",
    ["origem_linha","raw","serial","modelo","operadora","info_chip","empresa","adquirente","processando","observacao","status_raw","status","local","id_evento_raw","id_evento","data_saida_raw","data_saida","data_retorno_raw","data_retorno","motivo_revisao"],
    rowsControle);
  await bulkInsert(client, "staging.historico",
    ["origem_linha","raw","serial","acao","tipo","usuario","observacao","nome_evento","id_evento_raw","id_evento","data_saida_raw","data_saida","data_retorno_raw","data_retorno","motivo_revisao"],
    rowsHistorico);
  await bulkInsert(client, "staging.eventos",
    ["origem_linha","raw","id_evento_raw","id_evento","nome","produtora_codigo","produtora_nome","comercial","motivo_revisao"],
    rowsEventos);
  await bulkInsert(client, "staging.perdidas",
    ["origem_linha","raw","serial","status_perda","local","empresa","id_evento_raw","id_evento","nome_evento","responsavel","comercial","data_envio_raw","data_envio","observacao","motivo_revisao"],
    rowsPerdidas);
  await bulkInsert(client, "staging.trocas",
    ["origem_linha","raw","serial_defeito","problema","local","serial_nova","motivo_revisao"],
    rowsTrocas);
  await bulkInsert(client, "staging.localizar",
    ["origem_linha","raw","modelo","serial","referencia","motivo_revisao"],
    rowsLocalizar);

  // ---- resumo ----
  const { rows: cont } = await client.query(`
    SELECT 'controle' t, count(*) n, count(*) FILTER (WHERE motivo_revisao <> '{}') revisar FROM staging.controle
    UNION ALL SELECT 'historico', count(*), count(*) FILTER (WHERE motivo_revisao <> '{}') FROM staging.historico
    UNION ALL SELECT 'eventos', count(*), count(*) FILTER (WHERE motivo_revisao <> '{}') FROM staging.eventos
    UNION ALL SELECT 'perdidas', count(*), count(*) FILTER (WHERE motivo_revisao <> '{}') FROM staging.perdidas
    UNION ALL SELECT 'trocas', count(*), count(*) FILTER (WHERE motivo_revisao <> '{}') FROM staging.trocas
    UNION ALL SELECT 'localizar', count(*), count(*) FILTER (WHERE motivo_revisao <> '{}') FROM staging.localizar
    ORDER BY t`);
  const { rows: motivos } = await client.query(`
    SELECT unnest(motivo_revisao) m, count(*) n FROM (
      SELECT motivo_revisao FROM staging.controle
      UNION ALL SELECT motivo_revisao FROM staging.historico
      UNION ALL SELECT motivo_revisao FROM staging.eventos
      UNION ALL SELECT motivo_revisao FROM staging.perdidas
      UNION ALL SELECT motivo_revisao FROM staging.trocas
      UNION ALL SELECT motivo_revisao FROM staging.localizar
    ) x GROUP BY m ORDER BY n DESC`);

  console.log("\n✅ Carga concluída (staging).");
  console.log("Linhas por tabela (total | com motivo_revisao):");
  cont.forEach((r) => console.log(`  staging.${r.t}: ${r.n} | ${r.revisar}`));
  console.log("\nMotivos de revisão (total de tags):");
  motivos.forEach((r) => console.log(`  ${r.m}: ${r.n}`));

  await client.end();
}

main().catch((e) => { console.error("❌ ERRO:", e.message); process.exit(1); });
