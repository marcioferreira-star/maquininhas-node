// src/sync-neon.js
// Sync ONE-WAY (Planilha → Neon). Lê as 6 abas, carrega em staging (raw+parse+
// motivo_revisao) e promove para as tabelas finais. Chamado pelo endpoint do
// Vercel Cron. NÃO altera a planilha; a planilha continua sendo a fonte viva.
//
// Self-contido de propósito (roda no serverless da Vercel sem depender de ler
// arquivos .sql). Os scripts em tools/etl/* são os equivalentes para rodar à mão.

import pg from "pg";
import { getSheetData, getSheetDataOptional } from "./sheet.js";
import { serialSheetParaBR } from "./utils/datas.js";

const TABS = {
  CONTROLE: "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE",
  HISTORICO: "HISTORICO MAQUINAS",
  EVENTOS: "DADOS EVENTOS",
  EVENTOS_MANUAIS: "DADOS EVENTOS MANUAIS",
  PERDIDAS: "PERDIDAS PAGSEGURO - INGRESSE",
  TROCAS: "TROCAS",
  LOCALIZAR: "LOCALIZAR"
};
// origem_linha dos eventos manuais entra deslocada: a coluna é INT e serve só
// p/ rastrear a linha de origem — 1.000.002+ nunca colide com a aba oficial.
const LINHA_BASE_MANUAIS = 1_000_000;
const ANO_MIN = 2018;
const SENTINELAS = new Set(["01/01/2040", "15/07/1905"]);

/* ---- parse (mesma lógica de tools/etl/import-staging.js) ---- */
function classificaData(v) {
  const s = serialSheetParaBR(String(v ?? "").trim());
  if (!s || s === "-" || s === "0") return { tipo: "vazio", br: "" };
  if (SENTINELAS.has(s)) return { tipo: "sentinela", br: s };
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return { tipo: "nao-data", br: s };
  const ano = Number(m[3]);
  if (ano < ANO_MIN || ano > new Date().getUTCFullYear() + 2) return { tipo: "lixo", br: s };
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
  const m = /^(estoque|em uso)\s+(sp|rj|ura)$/i.exec(s);
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
  if ((!raw || raw === "-") && temNome) return { id: null, motivo: "sem_id_com_nome" };
  if (raw && raw !== "-") return { id: null, motivo: "id_nao_numerico" };
  return { id: null, motivo: null };
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
function tipoMov(acao) {
  const a = String(acao || "").toLowerCase();
  if (a.includes("retorno")) return "RETORNO";
  if (a.includes("fixo")) return "ENVIO_FIXO";
  if (a.includes("envio")) return "ENVIO";
  return "AJUSTE";
}
const j = (row) => JSON.stringify(row);
const nn = (v) => (v && String(v).trim() && String(v).trim() !== "-" ? String(v).trim() : null);
const dm = (arr) => [...new Set(arr.filter(Boolean))];

// staging é TRANSIENTE → DROP+CREATE a cada sync garante que o schema sempre casa
// com o código (antes usava CREATE IF NOT EXISTS + TRUNCATE, o que fossilizava o
// schema antigo e quebrava o bulk quando colunas novas eram adicionadas).
const STAGING_DDL = `
CREATE SCHEMA IF NOT EXISTS staging;
DROP TABLE IF EXISTS staging.controle;
DROP TABLE IF EXISTS staging.historico;
DROP TABLE IF EXISTS staging.eventos;
DROP TABLE IF EXISTS staging.perdidas;
DROP TABLE IF EXISTS staging.trocas;
DROP TABLE IF EXISTS staging.localizar;
CREATE TABLE staging.controle (origem_linha INT, raw JSONB, serial TEXT, modelo TEXT, operadora TEXT, info_chip TEXT, empresa TEXT, adquirente TEXT, processando BOOLEAN, observacao TEXT, status_raw TEXT, status maquina_status, local praca, id_evento_raw TEXT, id_evento BIGINT, nome_evento TEXT, produtora TEXT, comercial TEXT, data_saida_raw TEXT, data_saida DATE, data_retorno_raw TEXT, data_retorno DATE, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
CREATE TABLE staging.historico (origem_linha INT, raw JSONB, serial TEXT, acao TEXT, tipo movimento_tipo, usuario TEXT, observacao TEXT, nome_evento TEXT, status_raw TEXT, produtora TEXT, comercial TEXT, id_evento_raw TEXT, id_evento BIGINT, data_saida_raw TEXT, data_saida DATE, data_retorno_raw TEXT, data_retorno DATE, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
CREATE TABLE staging.eventos (origem_linha INT, raw JSONB, id_evento_raw TEXT, id_evento BIGINT, nome TEXT, produtora_codigo INT, produtora_nome TEXT, comercial TEXT, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
CREATE TABLE staging.perdidas (origem_linha INT, raw JSONB, serial TEXT, status_perda TEXT, local TEXT, empresa TEXT, id_evento_raw TEXT, id_evento BIGINT, nome_evento TEXT, responsavel TEXT, comercial TEXT, data_envio_raw TEXT, data_envio DATE, observacao TEXT, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
CREATE TABLE staging.trocas (origem_linha INT, raw JSONB, serial_defeito TEXT, problema TEXT, local TEXT, serial_nova TEXT, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
CREATE TABLE staging.localizar (origem_linha INT, raw JSONB, modelo TEXT, serial TEXT, referencia TEXT, motivo_revisao TEXT[] NOT NULL DEFAULT '{}');
`;

// v2 (Fase 0 do cutover): LEFT JOIN em vez de INNER → órfãos (serial fora da
// CONTROLE) deixam de ser DESCARTADOS; guarda serial cru + campos denormalizados
// do HISTORICO. Ver db/migrations/2026-07-11-v2-orfaos-denormalizado.sql.
const PROMOCAO_SQL = `
TRUNCATE movimento, perda, troca, localizacao, maquina, evento RESTART IDENTITY CASCADE;
INSERT INTO evento (id_evento, nome, produtora_codigo, produtora_nome, comercial)
SELECT DISTINCT ON (id_evento) id_evento, nome, produtora_codigo, produtora_nome, comercial
FROM staging.eventos WHERE id_evento IS NOT NULL AND nome IS NOT NULL
ORDER BY id_evento, ((produtora_nome IS NOT NULL)::int+(produtora_codigo IS NOT NULL)::int+(comercial IS NOT NULL)::int) DESC, origem_linha DESC;
INSERT INTO maquina (serial, modelo, operadora, info_chip, empresa, adquirente, status_raw, status, local, id_evento_atual, data_saida, data_retorno, processando, observacao, id_evento_raw, nome_evento_raw, produtora_raw, comercial_raw, origem_linha)
SELECT c.serial, c.modelo, c.operadora, c.info_chip, COALESCE(c.empresa,'Ingresse'), c.adquirente, c.status_raw, c.status, c.local,
  (SELECT e.id_evento FROM evento e WHERE e.id_evento=c.id_evento), c.data_saida,
  CASE WHEN c.status='FIXO' THEN NULL ELSE c.data_retorno END, COALESCE(c.processando,false), c.observacao,
  c.id_evento_raw, c.nome_evento, c.produtora, c.comercial, c.origem_linha
FROM staging.controle c WHERE c.serial IS NOT NULL AND c.status IS NOT NULL;
INSERT INTO movimento (maquina_id, serial, id_evento, id_evento_raw, tipo, acao_raw, status_raw, data_saida, data_retorno, usuario, observacao, nome_evento_raw, produtora_raw, comercial_raw, origem, origem_linha, criado_em)
SELECT m.id, h.serial, (SELECT e.id_evento FROM evento e WHERE e.id_evento=h.id_evento), h.id_evento_raw, h.tipo, h.acao, h.status_raw, h.data_saida, h.data_retorno, h.usuario, h.observacao, h.nome_evento, h.produtora, h.comercial, 'sheet_sync', h.origem_linha,
  COALESCE(h.data_saida, h.data_retorno, CURRENT_DATE)::timestamptz
FROM staging.historico h LEFT JOIN maquina m ON m.serial=h.serial;
INSERT INTO perda (maquina_id, serial, id_evento, responsavel, comercial, data_envio, status_perda, local, observacao)
SELECT m.id, p.serial, (SELECT e.id_evento FROM evento e WHERE e.id_evento=p.id_evento), p.responsavel, p.comercial, p.data_envio, p.status_perda, p.local, p.observacao
FROM staging.perdidas p LEFT JOIN maquina m ON m.serial=p.serial;
INSERT INTO troca (maquina_defeito_id, serial_defeito, problema, local, maquina_nova_id, serial_nova)
SELECT md.id, t.serial_defeito, t.problema, t.local, mn.id, t.serial_nova FROM staging.trocas t LEFT JOIN maquina md ON md.serial=t.serial_defeito LEFT JOIN maquina mn ON mn.serial=t.serial_nova;
INSERT INTO localizacao (maquina_id, serial, referencia)
SELECT m.id, l.serial, l.referencia FROM staging.localizar l LEFT JOIN maquina m ON m.serial=l.serial;
`;

// v2 (Fase 0 do cutover) — auto-migração idempotente: torna as satélites
// tolerantes a órfão (maquina_id nulo) + adiciona serial cru e os campos
// denormalizados do HISTORICO. Roda a cada sync (como o STAGING/SYNC_META DDL);
// após a 1ª vez, tudo vira no-op instantâneo. Espelho de db/migrations/2026-07-11-*.
const MIGRATION_V2_DDL = `
ALTER TABLE movimento ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS serial TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS acao_raw TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS id_evento_raw TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS status_raw TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS nome_evento_raw TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS produtora_raw TEXT;
ALTER TABLE movimento ADD COLUMN IF NOT EXISTS comercial_raw TEXT;
ALTER TABLE perda ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE perda ADD COLUMN IF NOT EXISTS serial TEXT;
ALTER TABLE troca ALTER COLUMN maquina_defeito_id DROP NOT NULL;
ALTER TABLE troca ADD COLUMN IF NOT EXISTS serial_defeito TEXT;
ALTER TABLE troca ADD COLUMN IF NOT EXISTS serial_nova TEXT;
ALTER TABLE localizacao ALTER COLUMN maquina_id DROP NOT NULL;
ALTER TABLE localizacao ADD COLUMN IF NOT EXISTS serial TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS status_raw      TEXT;
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS id_evento_raw   TEXT;  -- col J crua ("N/A" etc.)
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS nome_evento_raw TEXT;  -- col K denormalizada
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS produtora_raw   TEXT;  -- col L denormalizada
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS comercial_raw   TEXT;  -- col M denormalizada
`;

// chave fixa do advisory lock de sessão (impede cron + manual, ou 2 operadores,
// de rodar o sync ao mesmo tempo — o bulk de staging roda fora da transação).
const SYNC_LOCK_KEY = 771020;

// trilha de auditoria do sync (quem/quando/quanto/resultado). Idempotente.
const SYNC_META_DDL = `
CREATE TABLE IF NOT EXISTS sync_meta (
  id BIGSERIAL PRIMARY KEY,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  origem TEXT NOT NULL DEFAULT 'cron',
  ok BOOLEAN NOT NULL,
  duracao_ms INT,
  contagens JSONB,
  erro TEXT
);`;

async function bulk(client, tabela, cols, linhas) {
  const CHUNK = 300;
  for (let o = 0; o < linhas.length; o += CHUNK) {
    const slice = linhas.slice(o, o + CHUNK);
    const vals = [], params = [];
    let p = 1;
    for (const row of slice) { vals.push("(" + cols.map(() => `$${p++}`).join(",") + ")"); params.push(...row); }
    await client.query(`INSERT INTO ${tabela} (${cols.join(",")}) VALUES ${vals.join(",")}`, params);
  }
}

/** Sync completo Planilha→Neon. Retorna resumo. `origem` = "cron" | "manual:<quem>". */
export async function sincronizar({ origem = "cron" } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  const inicio = Date.now();

  const [controle, historico, eventos, eventosManuais, perdidas, trocas, localizar] = await Promise.all([
    getSheetData(`'${TABS.CONTROLE}'!A2:P`),
    getSheetData(`'${TABS.HISTORICO}'!A2:K`),
    getSheetData(`'${TABS.EVENTOS}'!A2:D`),
    getSheetDataOptional(`'${TABS.EVENTOS_MANUAIS}'!A2:D`), // pode não existir ainda
    getSheetData(`'${TABS.PERDIDAS}'!A2:P`),
    getSheetData(`'${TABS.TROCAS}'!A2:D`),
    getSheetData(`'${TABS.LOCALIZAR}'!A2:K`)
  ]);

  const setP = new Set(perdidas.map((r) => nn(r[0])).filter(Boolean));
  const setL = new Set(localizar.map((r) => nn(r[2])).filter(Boolean));

  const rowsControle = controle.map((r, i) => {
    const st = mapStatus(r[6]), idp = parseId(r[9], r[10]), dS = dataISO(r[13]), dR = dataISO(r[14]), serial = nn(r[2]);
    const mot = dm([st.motivo, idp.motivo, dS.motivo === "sentinela" ? null : dS.motivo, dR.motivo === "sentinela" ? null : dR.motivo,
      serial && (setP.has(serial) || setL.has(serial)) ? "serial_multi_aba" : null]);
    return [i + 2, j(r), serial, nn(r[1]), nn(r[3]), nn(r[4]), nn(r[8]), adquirente(serial), /Sim/i.test(String(r[7] || "")), nn(r[15]),
      nn(r[6]), st.status, st.local, nn(r[9]), idp.id, nn(r[10]), nn(r[11]), nn(r[12]), dS.raw, dS.iso, dR.raw, dR.iso, mot];
  });
  const rowsHist = historico.map((r, i) => {
    const idp = parseId(r[1], r[7]), dS = dataISO(r[3]), dR = dataISO(r[4]);
    // captura tb col F (status congelado), I (produtora), J (comercial) p/ o adapter
    // de leitura reproduzir montarHistorico sem JOIN (inclusive em id "N/A"/órfão).
    return [i + 2, j(r), nn(r[0]), nn(r[2]), tipoMov(r[2]), nn(r[6]), nn(r[10]), nn(r[7]), nn(r[5]), nn(r[8]), nn(r[9]), nn(r[1]), idp.id, dS.raw, dS.iso, dR.raw, dR.iso,
      dm([dS.motivo === "sentinela" ? null : dS.motivo, dR.motivo === "sentinela" ? null : dR.motivo])];
  });
  const visto = new Map();
  // Eventos = aba oficial (derivada da QUERY) + cadastros manuais do app, estes
  // SEM os IDs que a oficial já traz (mesma precedência da leitura em
  // repo/sheets.js). origem_linha dos manuais deslocada p/ não colidir.
  const idsOficiais = new Set(eventos.map((r) => nn(r[0])).filter(Boolean));
  const eventosTodos = [
    ...eventos.map((r, i) => ({ r, linha: i + 2 })),
    ...eventosManuais
      .filter((r) => { const id = nn(r[0]); return id && !idsOficiais.has(id); })
      .map((r, i) => ({ r, linha: LINHA_BASE_MANUAIS + i + 2 }))
  ];
  const rowsEv = eventosTodos.map(({ r, linha }) => {
    const idRaw = nn(r[0]), prod = parseProdutora(r[2]), chave = `${nn(r[1]) || ""}|${nn(r[2]) || ""}|${nn(r[3]) || ""}`;
    let mot = null;
    if (idRaw && /^\d+$/.test(idRaw)) { if (!visto.has(idRaw)) visto.set(idRaw, new Set()); const s = visto.get(idRaw); if (s.size >= 1 && !s.has(chave)) mot = "evento_divergente"; s.add(chave); }
    else if (idRaw) mot = "id_nao_numerico";
    return [linha, j(r), nn(r[0]), (idRaw && /^\d+$/.test(idRaw)) ? idRaw : null, nn(r[1]), prod.codigo, prod.nome, nn(r[3]), dm([mot])];
  });
  const rowsPerd = perdidas.map((r, i) => {
    const idp = parseId(r[7], r[8]), dE = dataISO(r[11]), cL = classificaData(r[11]), cM = classificaData(r[12]);
    const sp = (cL.tipo === "nao-data" ? cL.br : "") || (cM.tipo === "nao-data" ? cM.br : "") || nn(r[3]);
    return [i + 2, j(r), nn(r[0]), sp, nn(r[4]), nn(r[6]), nn(r[7]), idp.id, nn(r[8]), nn(r[9]), nn(r[10]), dE.raw, dE.iso, nn(r[13]),
      dm([idp.motivo, dE.motivo === "sentinela" ? null : dE.motivo, (cL.tipo === "nao-data" || cM.tipo === "nao-data") ? "texto_em_data" : null])];
  });
  const rowsTr = trocas.map((r, i) => [i + 2, j(r), nn(r[0]), nn(r[1]), nn(r[2]), nn(r[3]), dm([!nn(r[3]) ? "troca_sem_substituta" : null])]);
  const rowsLoc = localizar.map((r, i) => [i + 2, j(r), nn(r[1]), nn(r[2]), nn(r[10]), dm([nn(r[10]) && /^\*|voltou|encontrad/i.test(nn(r[10])) ? "provavel_resolvida" : null])]);

  const client = new pg.Client({ connectionString: url.replace("-pooler", ""), ssl: true });
  await client.connect();
  try {
    await client.query(SYNC_META_DDL); // garante a tabela de trilha (idempotente)

    // trava: se já há um sync rodando, aborta sem tocar em nada (não é erro de dados)
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [SYNC_LOCK_KEY]);
    if (!lock.rows[0].ok) {
      const err = new Error("Já existe uma sincronização em andamento.");
      err.code = "SYNC_EM_ANDAMENTO";
      throw err;
    }

    try {
      await client.query(MIGRATION_V2_DDL); // auto-migração idempotente (Fase 0)
      await client.query(STAGING_DDL);
      await bulk(client, "staging.controle", ["origem_linha","raw","serial","modelo","operadora","info_chip","empresa","adquirente","processando","observacao","status_raw","status","local","id_evento_raw","id_evento","nome_evento","produtora","comercial","data_saida_raw","data_saida","data_retorno_raw","data_retorno","motivo_revisao"], rowsControle);
      await bulk(client, "staging.historico", ["origem_linha","raw","serial","acao","tipo","usuario","observacao","nome_evento","status_raw","produtora","comercial","id_evento_raw","id_evento","data_saida_raw","data_saida","data_retorno_raw","data_retorno","motivo_revisao"], rowsHist);
      await bulk(client, "staging.eventos", ["origem_linha","raw","id_evento_raw","id_evento","nome","produtora_codigo","produtora_nome","comercial","motivo_revisao"], rowsEv);
      await bulk(client, "staging.perdidas", ["origem_linha","raw","serial","status_perda","local","empresa","id_evento_raw","id_evento","nome_evento","responsavel","comercial","data_envio_raw","data_envio","observacao","motivo_revisao"], rowsPerd);
      await bulk(client, "staging.trocas", ["origem_linha","raw","serial_defeito","problema","local","serial_nova","motivo_revisao"], rowsTr);
      await bulk(client, "staging.localizar", ["origem_linha","raw","modelo","serial","referencia","motivo_revisao"], rowsLoc);
      await client.query("BEGIN");
      await client.query(PROMOCAO_SQL);
      await client.query("COMMIT");
      const cnt = async (t) => (await client.query(`select count(*) n from ${t}`)).rows[0].n;
      const resumo = {
        ok: true, ms: Date.now() - inicio, origem,
        maquina: await cnt("maquina"), evento: await cnt("evento"), movimento: await cnt("movimento"),
        perda: await cnt("perda"), troca: await cnt("troca"), localizacao: await cnt("localizacao")
      };
      // trilha (best-effort — não derruba o sync se falhar)
      await client.query(
        "INSERT INTO sync_meta (origem, ok, duracao_ms, contagens) VALUES ($1, true, $2, $3)",
        [origem, resumo.ms, JSON.stringify({ maquina: resumo.maquina, evento: resumo.evento, movimento: resumo.movimento, perda: resumo.perda, troca: resumo.troca, localizacao: resumo.localizacao })]
      ).catch(() => {});
      return resumo;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query(
        "INSERT INTO sync_meta (origem, ok, duracao_ms, erro) VALUES ($1, false, $2, $3)",
        [origem, Date.now() - inicio, String(e.message || e).slice(0, 500)]
      ).catch(() => {});
      throw e;
    }
    // advisory lock é de SESSÃO → liberado automaticamente no client.end() abaixo
  } finally {
    await client.end();
  }
}

/** Última execução registrada em sync_meta (ou null). Login-gated no endpoint. */
export async function ultimoSync() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const client = new pg.Client({ connectionString: url.replace("-pooler", ""), ssl: true });
  await client.connect();
  try {
    await client.query(SYNC_META_DDL); // garante existência (1ª vez)
    const r = await client.query(
      "SELECT executado_em, origem, ok, duracao_ms, contagens, erro FROM sync_meta ORDER BY id DESC LIMIT 1"
    );
    return r.rows[0] || null;
  } finally {
    await client.end();
  }
}
