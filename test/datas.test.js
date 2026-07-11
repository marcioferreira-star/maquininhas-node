// test/datas.test.js
// Roda com: npm test   (usa o runner nativo do Node: node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  parseBRDate,
  startOfDayLocal,
  diffDiasDeHoje,
  situacaoPrazo,
  situacaoDeMaquina,
  dataISOValida,
  serialSheetParaBR,
  hojeBR
} from "../src/utils/datas.js";

// helper: formata um Date em "dd/mm/aaaa" no fuso local
function toBR(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

const hoje = startOfDayLocal();
const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);

test("parseBRDate — válidas e inválidas", () => {
  const d = parseBRDate("01/06/2026");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5); // junho = 5
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0); // meia-noite local

  // aceita dia/mês sem zero à esquerda
  assert.equal(parseBRDate("1/6/2026").getDate(), 1);

  // inválidas → null
  assert.equal(parseBRDate(""), null);
  assert.equal(parseBRDate("-"), null);
  assert.equal(parseBRDate("abc"), null);
  assert.equal(parseBRDate(null), null);
});

test("parseBRDate — não regride 1 dia (bug UTC)", () => {
  // o bug antigo: new Date('2026-06-01') virava 31/05 em BRT
  const d = parseBRDate("01/06/2026");
  assert.equal(d.getDate(), 1, "tem que continuar dia 1");
});

test("diffDiasDeHoje", () => {
  assert.equal(diffDiasDeHoje(toBR(hoje)), 0);
  assert.equal(diffDiasDeHoje(toBR(amanha)), 1);
  assert.equal(diffDiasDeHoje(toBR(ontem)), -1);
  assert.equal(diffDiasDeHoje("data ruim"), null);
});

test("situacaoPrazo — só envio tem prazo", () => {
  assert.equal(situacaoPrazo("Retorno SP", toBR(ontem)), "");
  assert.equal(situacaoPrazo("Envio Fixo", "-"), "Fixo");
  assert.equal(situacaoPrazo("Envio SP", "-"), "Fixo");
});

test("situacaoPrazo — atrasado / vence hoje / no prazo", () => {
  assert.equal(situacaoPrazo("Envio SP", toBR(ontem)), "Atrasado");
  assert.equal(situacaoPrazo("Envio SP", toBR(hoje)), "Vence hoje");
  assert.equal(situacaoPrazo("Envio SP", toBR(amanha)), "Dentro do prazo");
});

test("dataISOValida — só aceita data de calendário real em aaaa-mm-dd", () => {
  assert.equal(dataISOValida("2026-07-10"), true);
  assert.equal(dataISOValida("2026-02-28"), true);
  // fora de faixa / inexistente → false (parseBRDate normalizaria em silêncio)
  assert.equal(dataISOValida("2026-13-45"), false);
  assert.equal(dataISOValida("2026-02-30"), false); // 30 de fev não existe
  assert.equal(dataISOValida("2026-00-10"), false);
  // formato errado / vazio → false
  assert.equal(dataISOValida("10/07/2026"), false);
  assert.equal(dataISOValida("2026-7-10"), false); // sem zero à esquerda
  assert.equal(dataISOValida("-"), false);
  assert.equal(dataISOValida(""), false);
  assert.equal(dataISOValida(null), false);
});

test("situacaoDeMaquina — derivada do STATUS atual (aba Máquinas)", () => {
  // Em Uso → depende da data de retorno
  assert.equal(situacaoDeMaquina("Em Uso SP", toBR(ontem)), "Atrasado");
  assert.equal(situacaoDeMaquina("Em Uso RJ", toBR(hoje)), "Vence hoje");
  assert.equal(situacaoDeMaquina("Em Uso URA", toBR(amanha)), "Dentro do prazo");
  assert.equal(situacaoDeMaquina("Em Uso SP", "-"), "Sem data");
  // Fixo / Estoque / outros
  assert.equal(situacaoDeMaquina("Fixo", "-"), "Fixo");
  assert.equal(situacaoDeMaquina("Estoque SP", "-"), "Disponível");
  assert.equal(situacaoDeMaquina("Perdida", "-"), "");
});

test("serialSheetParaBR — número de série vira data; texto fica igual", () => {
  assert.equal(serialSheetParaBR("46175"), "02/06/2026"); // o caso real do print
  assert.equal(serialSheetParaBR("01/12/2025"), "01/12/2025"); // já é data
  assert.equal(serialSheetParaBR("-"), "-");
  assert.equal(serialSheetParaBR(""), "");
  assert.equal(serialSheetParaBR("0"), "0"); // número pequeno não é data
});

test("hojeBR — formato dd/mm/aaaa válido", () => {
  const s = hojeBR();
  assert.match(s, /^\d{2}\/\d{2}\/\d{4}$/);
  const [d, m, y] = s.split("/").map(Number);
  assert.ok(d >= 1 && d <= 31);
  assert.ok(m >= 1 && m <= 12);
  assert.ok(y >= 2020);
});

// Regressão do bug de fuso: "hoje" é derivado de America/Sao_Paulo, então NÃO
// pode depender do TZ do processo. Rodamos hojeBR() em dois fusos que diferem
// 25h (UTC+14 e UTC-11) — no mesmo instante, sob o código antigo (TZ do
// processo) eles cairiam em datas de calendário diferentes; com o fix, iguais.
test("hojeBR — independente do TZ do processo (não regride o dia)", () => {
  const modUrl = new URL("../src/utils/datas.js", import.meta.url).href;
  const script = `import(${JSON.stringify(modUrl)}).then(m => process.stdout.write(m.hojeBR()))`;
  const run = (tz) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz }
    }).toString().trim();

  const maisAdiantado = run("Pacific/Kiritimati"); // UTC+14
  const maisAtrasado = run("Pacific/Pago_Pago");   // UTC-11
  assert.equal(
    maisAdiantado,
    maisAtrasado,
    "hojeBR deve ser a mesma data BRT mesmo em fusos que diferem 25h"
  );
});
