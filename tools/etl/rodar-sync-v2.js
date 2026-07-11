// tools/etl/rodar-sync-v2.js
// Roda o sync v2 (Fase 0 do cutover) contra o Neon real: auto-aplica a migração
// (órfãos + denormalizados) e repovoa o espelho. Imprime as contagens p/ verificar
// que os órfãos deixaram de ser descartados. Uso: node tools/etl/rodar-sync-v2.js
import "dotenv/config";
import { sincronizar } from "../../src/sync-neon.js";

const r = await sincronizar({ origem: "manual:cutover-fase0-verif" });
console.log(JSON.stringify(r, null, 2));
process.exit(0);
