// test/datas.test.js
// Roda com: npm test   (usa o runner nativo do Node: node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBRDate,
  startOfDayLocal,
  diffDiasDeHoje,
  situacaoPrazo,
  serialSheetParaBR
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

test("serialSheetParaBR — número de série vira data; texto fica igual", () => {
  assert.equal(serialSheetParaBR("46175"), "02/06/2026"); // o caso real do print
  assert.equal(serialSheetParaBR("01/12/2025"), "01/12/2025"); // já é data
  assert.equal(serialSheetParaBR("-"), "-");
  assert.equal(serialSheetParaBR(""), "");
  assert.equal(serialSheetParaBR("0"), "0"); // número pequeno não é data
});
