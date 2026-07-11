// tools/parity.js — shadow/parity da Fase 1 do cutover: compara os adapters
// sheets × neon campo-a-campo e reporta os diffs REAIS, filtrando os ACEITOS.
// Diffs aceitos (o Neon é mais limpo, por construção do sync v2):
//   - whitespace: o sync faz trim; a planilha guarda espaços crus.
//   - data: to_char zero-padda ("24/06" vs "24/6", mesma data); sentinela/lixo→NULL ("-").
//   - empresa: default 'Ingresse' no schema vs "-" na planilha vazia.
//   - situacao (histórico, campo derivado e NÃO exibido): muda quando o retorno era
//     sentinela (2040→NULL) — consequência aceita do item acima.
// Objetivo: diff_real=0 por vários dias antes de flipar READ_BACKEND. Uso: node tools/parity.js
import "dotenv/config";
import * as sheets from "../src/repo/sheets.js";
import * as neon from "../src/repo/neon.js";

const norm = (v) => String(v == null ? "" : v).trim();
function normDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(norm(v));
  return m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : norm(v);
}

function maquinaDiffAceito(campo, s, n) {
  if (norm(s) === norm(n)) return true;                                  // whitespace
  if (campo === "empresa" && norm(s) === "-" && n === "Ingresse") return true;
  if (campo === "dataSaida" || campo === "dataRetorno") {
    if (n === "-" && s !== "-") return true;                             // sentinela/lixo/FIXO→NULL
    if (normDate(s) === normDate(n)) return true;                        // "24/6" vs "24/06"
  }
  return false;
}

function histDiffAceito(campo, s, v, rowS, rowV) {
  if (norm(s) === norm(v)) return true;                                  // whitespace
  if (campo === "saida" || campo === "retorno") {
    if (v === "-" && s !== "-") return true;
    if (normDate(s) === normDate(v)) return true;
  }
  // situacao é derivada de retorno; se o retorno virou "-" (sentinela), a situacao muda junto.
  if (campo === "situacao" && norm(rowV.retorno) === "-" && norm(rowS.retorno) !== "-") return true;
  return false;
}

function comparaMaquinas(arrS, arrN) {
  const idxN = new Map(arrN.map((m) => [norm(m.serial), m])); // casa por serial trimado
  const diffs = [];
  let soAceito = 0;
  for (const s of arrS) {
    const n = idxN.get(norm(s.serial));
    if (!n) { diffs.push({ serial: s.serial, campo: "(ausente no neon)" }); continue; }
    for (const campo of Object.keys(s)) {
      if (campo === "linha") continue;
      if (String(s[campo]) !== String(n[campo])) {
        if (maquinaDiffAceito(campo, s[campo], n[campo])) { soAceito++; continue; }
        diffs.push({ serial: s.serial, campo, sheets: s[campo], neon: n[campo] });
      }
    }
  }
  return { total: arrS.length, neonTotal: arrN.length, diffs, soAceito };
}

function comparaHistorico(arrS, arrN) {
  const diffs = [];
  let soAceito = 0;
  const n = Math.max(arrS.length, arrN.length);
  for (let i = 0; i < n; i++) {
    const s = arrS[i], v = arrN[i];
    if (!s || !v) { diffs.push({ i, campo: "(comprimento)" }); continue; }
    for (const campo of Object.keys(s)) {
      if (String(s[campo]) !== String(v[campo])) {
        if (histDiffAceito(campo, s[campo], v[campo], s, v)) { soAceito++; continue; }
        diffs.push({ i, serial: s.serial, campo, sheets: s[campo], neon: v[campo] });
      }
    }
  }
  return { total: arrS.length, neonTotal: arrN.length, diffs, soAceito };
}

const [mS, mN, hS, hN] = await Promise.all([
  sheets.fetchMaquinas(), neon.fetchMaquinas(),
  sheets.fetchHistorico(), neon.fetchHistorico()
]);

const maq = comparaMaquinas(mS, mN);
const his = comparaHistorico(hS, hN);

console.log("=== MAQUINAS ===");
console.log(`sheets=${maq.total} neon=${maq.neonTotal} | diffs_reais=${maq.diffs.length} | so_aceitos=${maq.soAceito}`);
if (maq.diffs.length) console.log(JSON.stringify(maq.diffs.slice(0, 25), null, 2));
console.log("=== HISTORICO ===");
console.log(`sheets=${his.total} neon=${his.neonTotal} | diffs_reais=${his.diffs.length} | so_aceitos=${his.soAceito}`);
if (his.diffs.length) console.log(JSON.stringify(his.diffs.slice(0, 25), null, 2));

const ok = maq.diffs.length === 0 && his.diffs.length === 0;
console.log(ok ? "\n✅ PARIDADE OK (só diffs aceitos)" : "\n⚠️ diffs reais acima");
process.exit(ok ? 0 : 1);
