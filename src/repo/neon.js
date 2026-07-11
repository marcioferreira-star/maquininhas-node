// src/repo/neon.js — adapter de LEITURA sobre o ESPELHO Neon.
// Reconstrói o SHAPE EXATO da planilha (status/data CRUAS, "-" p/ vazio) a partir
// das colunas denormalizadas gravadas pelo sync v2. Fase 1 do cutover.
// Pool singleton (URL pooled — leitura passa pelo PgBouncer sem problema).
// Datas via to_char no SQL (evita o fuso do driver); montarHistorico é o MESMO
// de sheets → situação/Devolvida idênticas.
import pg from "pg";
import { montarHistorico } from "../utils/dominio.js";

let _pool = null;
function pool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada (adapter neon).");
    _pool = new pg.Pool({ connectionString: url, ssl: true, max: 3 });
  }
  return _pool;
}
const dash = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));

/** Mesma forma de fetchMaquinas do sheets, servida do espelho. */
export async function fetchMaquinas() {
  const { rows } = await pool().query(`
    SELECT origem_linha, modelo, serial, operadora, info_chip, status_raw, processando, empresa,
           id_evento_raw, nome_evento_raw, produtora_raw, comercial_raw,
           to_char(data_saida,'DD/MM/YYYY')   AS data_saida_br,
           to_char(data_retorno,'DD/MM/YYYY') AS data_retorno_br,
           observacao
    FROM maquina ORDER BY origem_linha`);
  return rows.map((m) => ({
    linha: m.origem_linha,
    modelo: dash(m.modelo),
    serial: dash(m.serial),
    operadora: dash(m.operadora),
    infoChip: dash(m.info_chip),
    status: dash(m.status_raw),
    processando: m.processando ? "Sim" : "-",
    empresa: dash(m.empresa),
    idEvento: dash(m.id_evento_raw),
    nomeEvento: dash(m.nome_evento_raw),
    produtora: dash(m.produtora_raw),
    comercial: dash(m.comercial_raw),
    dataSaida: dash(m.data_saida_br),
    dataRetorno: dash(m.data_retorno_br),
    observacao: dash(m.observacao)
  }));
}

/** Reconstrói as linhas A..K cruas do HISTORICO e passa pelo MESMO montarHistorico. */
export async function fetchHistorico() {
  const { rows } = await pool().query(`
    SELECT serial, id_evento_raw, acao_raw,
           to_char(data_saida,'DD/MM/YYYY')   AS saida_br,
           to_char(data_retorno,'DD/MM/YYYY') AS retorno_br,
           status_raw, usuario, nome_evento_raw, produtora_raw, comercial_raw, observacao
    FROM movimento ORDER BY origem_linha`);
  const dados = rows.map((m) => [
    m.serial, m.id_evento_raw, m.acao_raw, m.saida_br, m.retorno_br,
    m.status_raw, m.usuario, m.nome_evento_raw, m.produtora_raw, m.comercial_raw, m.observacao
  ]);
  return montarHistorico(dados);
}

/** Info de um evento (id já trimado por db.js). Null se não existe/não numérico. */
export async function fetchEventoInfo(alvo) {
  if (!/^\d+$/.test(String(alvo))) return null; // evento.id_evento é BIGINT
  const { rows } = await pool().query(
    "SELECT id_evento, nome, produtora_codigo, produtora_nome, comercial FROM evento WHERE id_evento = $1::bigint LIMIT 1",
    [alvo]
  );
  if (!rows.length) return null;
  const e = rows[0];
  // reconstrói o texto cru da col Produtora ("572 | Nova Produtora" quando há código)
  const produtora = e.produtora_codigo
    ? `${e.produtora_codigo} | ${e.produtora_nome || ""}`.trim()
    : (e.produtora_nome || "-");
  return { id_evento: String(e.id_evento), nome_evento: dash(e.nome), produtora: dash(produtora), comercial: dash(e.comercial) };
}
