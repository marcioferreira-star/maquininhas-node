// tools/etl/promover.js
// Onda 6 — promove staging → tabelas finais (public), aplicando os defaults:
//  - evento: DISTINCT ON (id_evento) pega a linha MAIS COMPLETA
//  - maquina: status/local já decompostos; id_evento_atual só se o evento existir;
//             FIXO => data_retorno NULL (respeita o CHECK)
//  - movimento/perda/troca/localizacao: JOIN em maquina (órfãos — serial fora da
//    CONTROLE — são PULADOS e contados)
// Idempotente: TRUNCATE + reinsere. Uso: node tools/etl/promover.js

import "dotenv/config";
import pg from "pg";

export const PROMOCAO_SQL = `
BEGIN;

TRUNCATE movimento, perda, troca, localizacao, maquina, evento RESTART IDENTITY CASCADE;

-- EVENTO — a linha mais completa por id (dedup dos divergentes)
INSERT INTO evento (id_evento, nome, produtora_codigo, produtora_nome, comercial)
SELECT DISTINCT ON (id_evento)
  id_evento, nome, produtora_codigo, produtora_nome, comercial
FROM staging.eventos
WHERE id_evento IS NOT NULL AND nome IS NOT NULL
ORDER BY id_evento,
  ( (produtora_nome IS NOT NULL)::int
  + (produtora_codigo IS NOT NULL)::int
  + (comercial IS NOT NULL)::int ) DESC,
  origem_linha DESC;

-- MAQUINA — fonte única de identidade
INSERT INTO maquina
  (serial, modelo, operadora, info_chip, empresa, adquirente, status, local,
   id_evento_atual, data_saida, data_retorno, processando, observacao, origem_linha)
SELECT
  c.serial, c.modelo, c.operadora, c.info_chip, COALESCE(c.empresa, 'Ingresse'),
  c.adquirente, c.status, c.local,
  (SELECT e.id_evento FROM evento e WHERE e.id_evento = c.id_evento),
  c.data_saida,
  CASE WHEN c.status = 'FIXO' THEN NULL ELSE c.data_retorno END,
  COALESCE(c.processando, false), c.observacao, c.origem_linha
FROM staging.controle c
WHERE c.serial IS NOT NULL AND c.status IS NOT NULL;

-- MOVIMENTO (histórico) — JOIN maquina (órfãos pulados)
INSERT INTO movimento
  (maquina_id, id_evento, tipo, data_saida, data_retorno, usuario, observacao, origem, origem_linha, criado_em)
SELECT
  m.id,
  (SELECT e.id_evento FROM evento e WHERE e.id_evento = h.id_evento),
  h.tipo, h.data_saida, h.data_retorno, h.usuario, h.observacao, 'sheet_import', h.origem_linha,
  COALESCE(h.data_saida, h.data_retorno, CURRENT_DATE)::timestamptz
FROM staging.historico h
JOIN maquina m ON m.serial = h.serial;

-- PERDA — JOIN maquina (órfãos pulados)
INSERT INTO perda
  (maquina_id, id_evento, responsavel, comercial, data_envio, status_perda, local, observacao)
SELECT
  m.id,
  (SELECT e.id_evento FROM evento e WHERE e.id_evento = p.id_evento),
  p.responsavel, p.comercial, p.data_envio, p.status_perda, p.local, p.observacao
FROM staging.perdidas p
JOIN maquina m ON m.serial = p.serial;

-- TROCA — defeito obrigatório na maquina; nova opcional
INSERT INTO troca (maquina_defeito_id, problema, local, maquina_nova_id)
SELECT md.id, t.problema, t.local, mn.id
FROM staging.trocas t
JOIN maquina md ON md.serial = t.serial_defeito
LEFT JOIN maquina mn ON mn.serial = t.serial_nova;

-- LOCALIZACAO — JOIN maquina
INSERT INTO localizacao (maquina_id, referencia)
SELECT m.id, l.referencia
FROM staging.localizar l
JOIN maquina m ON m.serial = l.serial;

COMMIT;
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL não está no .env."); process.exit(1); }
  const direta = url.replace("-pooler", "");
  const client = new pg.Client({ connectionString: direta, ssl: true });

  await client.connect();
  console.log("Promovendo staging → tabelas finais…");
  await client.query(PROMOCAO_SQL);

  // contagens finais + órfãos pulados
  const q = async (sql) => (await client.query(sql)).rows[0].n;
  const fin = {
    evento: await q("select count(*) n from evento"),
    maquina: await q("select count(*) n from maquina"),
    movimento: await q("select count(*) n from movimento"),
    perda: await q("select count(*) n from perda"),
    troca: await q("select count(*) n from troca"),
    localizacao: await q("select count(*) n from localizacao")
  };
  const orfaos = {
    movimento: await q("select count(*) n from staging.historico h where h.serial is not null and not exists (select 1 from maquina m where m.serial=h.serial)"),
    perda: await q("select count(*) n from staging.perdidas p where p.serial is not null and not exists (select 1 from maquina m where m.serial=p.serial)"),
    troca: await q("select count(*) n from staging.trocas t where t.serial_defeito is not null and not exists (select 1 from maquina m where m.serial=t.serial_defeito)"),
    localizacao: await q("select count(*) n from staging.localizar l where l.serial is not null and not exists (select 1 from maquina m where m.serial=l.serial)")
  };
  const evStg = await q("select count(distinct id_evento) n from staging.eventos where id_evento is not null");

  console.log("\n✅ Promoção concluída (public).");
  console.log("Tabelas finais:");
  Object.entries(fin).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
  console.log(`\nEventos: ${evStg} ids distintos no staging → ${fin.evento} promovidos (dedup).`);
  console.log("Órfãos PULADOS (serial fora da CONTROLE):");
  Object.entries(orfaos).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

  await client.end();
}

main().catch((e) => { console.error("❌ ERRO:", e.message); process.exit(1); });
