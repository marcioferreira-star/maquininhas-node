// test/ajuste-status.test.js
// Cobre montarAjusteStatus (lógica pura do /atualizar-status): o DIFF de células
// da CONTROLE + a linha A..K do HISTORICO que preserva a origem antes da limpeza.
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarAjusteStatus, ACAO_AJUSTE } from "../src/utils/dominio.js";
import { situacaoPrazo } from "../src/utils/datas.js";

const HOJE = "21/07/2026";

// shape de uma máquina como repo/sheets.js entrega
const maq = (over = {}) => ({
  serial: "PBA123X",
  status: "Em Uso SP",
  idEvento: "92044",
  nomeEvento: "Soul João 2026",
  produtora: "Soul Eventos",
  comercial: "Lara",
  dataSaida: "07/04/2026",
  dataRetorno: "22/06/2026",
  ...over
});

test("Em Uso SP → Estoque SP: limpa J..M+O e preserva a origem no HISTORICO", () => {
  const p = montarAjusteStatus(maq(), "Estoque SP", HOJE, "Marcio");
  assert.equal(p.nadaAMudar, false);

  // DIFF: G muda + J,K,L,M,O limpam = 6 células
  const cols = p.celulas.map((c) => c.col).sort();
  assert.deepEqual(cols, ["G", "J", "K", "L", "M", "O"]);
  assert.equal(p.celulas.find((c) => c.col === "G").value, "Estoque SP");
  p.celulas.filter((c) => c.col !== "G").forEach((c) => assert.equal(c.value, "-"));

  // HISTORICO A..K: origem preservada, retorno carimbado com HOJE (igual retorno normal)
  assert.deepEqual(p.historicoRow, [
    "PBA123X", "92044", ACAO_AJUSTE, "07/04/2026", HOJE, "Estoque SP",
    "Marcio", "Soul João 2026", "Soul Eventos", "Lara",
    "Ajuste manual: Em Uso SP → Estoque SP"
  ]);
});

test("Em Uso SP → Fixo: limpa só O; col E do histórico = '-'; evento mantido", () => {
  const p = montarAjusteStatus(maq(), "Fixo", HOJE, "Marcio");
  const cols = p.celulas.map((c) => c.col).sort();
  assert.deepEqual(cols, ["G", "O"]);
  assert.equal(p.historicoRow[4], "-", "Fixo não tem data de retorno");
  assert.equal(p.historicoRow[1], "92044", "evento preservado no histórico");
  assert.equal(p.historicoRow[5], "Fixo");
});

test("Estoque SP → Estoque SP já limpo: nadaAMudar, sem histórico", () => {
  const limpa = maq({ status: "Estoque SP", idEvento: "-", nomeEvento: "-", produtora: "-", comercial: "-", dataRetorno: "-" });
  const p = montarAjusteStatus(limpa, "Estoque SP", HOJE, "Marcio");
  assert.equal(p.nadaAMudar, true);
  assert.deepEqual(p.celulas, []);
  assert.equal(p.historicoRow, null);
});

test("Estoque com resíduo de evento: sana J..M e audita mesmo com status igual", () => {
  const suja = maq({ status: "Estoque SP", dataRetorno: "-" }); // status já Estoque mas J..M sujos
  const p = montarAjusteStatus(suja, "Estoque SP", HOJE, "Marcio");
  assert.equal(p.nadaAMudar, false);
  const cols = p.celulas.map((c) => c.col).sort();
  assert.deepEqual(cols, ["J", "K", "L", "M"], "só limpa o vínculo; G não muda");
  assert.match(p.historicoRow[10], /limpeza de vínculo/);
  assert.equal(p.historicoRow[5], "Estoque SP");
});

test("guard da ação: não confunde com envio/retorno/fixo (Neon → AJUSTE)", () => {
  assert.equal(ACAO_AJUSTE, "Ajuste manual");
  assert.ok(!/envio|retorno|fixo/i.test(ACAO_AJUSTE), "a ação NÃO pode conter essas substrings");
  // situacaoPrazo classifica por substring de 'envio' → ajuste deve dar "" (sem prazo)
  assert.equal(situacaoPrazo(ACAO_AJUSTE, "01/01/2026"), "");
});
