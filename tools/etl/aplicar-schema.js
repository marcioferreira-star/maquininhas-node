// tools/etl/aplicar-schema.js
// Aplica db/schema.sql no Neon. Usa a conexão DIRETA (sem -pooler), recomendada
// para DDL/migrations. Uso: node tools/etl/aplicar-schema.js  (lê DATABASE_URL do .env)

import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não está no .env.");
  process.exit(1);
}
// endpoint direto (DDL não deve passar pelo pooler/PgBouncer)
const direta = url.replace("-pooler", "");

const sql = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");

const client = new pg.Client({
  connectionString: direta,
  ssl: true // TLS com verificação (Neon usa certificado de CA pública)
});

try {
  await client.connect();
  console.log("Conectado ao Neon (conexão direta). Aplicando db/schema.sql…");
  await client.query(sql);

  const { rows: tabelas } = await client.query(
    `SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema IN ('public','staging') AND table_type='BASE TABLE'
      ORDER BY table_schema, table_name`
  );
  const { rows: views } = await client.query(
    `SELECT table_name FROM information_schema.views WHERE table_schema='public'`
  );
  const { rows: enums } = await client.query(
    `SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname`
  );

  console.log("\n✅ Schema aplicado.");
  console.log("Enums:", enums.map((e) => e.typname).join(", "));
  console.log("Views:", views.map((v) => v.table_name).join(", "));
  console.log("Tabelas:");
  tabelas.forEach((t) => console.log(`  ${t.table_schema}.${t.table_name}`));
} catch (e) {
  console.error("❌ ERRO ao aplicar schema:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
