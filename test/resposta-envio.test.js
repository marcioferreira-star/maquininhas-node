// test/resposta-envio.test.js
// Cobre o contrato de resposta do /registrar-envio (total / parcial / nada) e a
// tradução dos motivos de recusa. O bug: sucesso PARCIAL voltava 422 ok:false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarRespostaEnvio, motivoRecusaEnvio } from "../src/utils/dominio.js";

test("motivoRecusaEnvio — traduz os 6 steps para PT (com status quando há)", () => {
  assert.match(motivoRecusaEnvio({ step: "nao-esta-em-uso", statusAtual: "Estoque SP" }), /Em Uso\/Fixo.*Estoque SP/);
  assert.match(motivoRecusaEnvio({ step: "ja-fora-do-estoque", statusAtual: "Em Uso SP" }), /fora do estoque.*Em Uso SP/);
  assert.match(motivoRecusaEnvio({ step: "serial-duplicado" }), /mais de uma vez/);
  assert.match(motivoRecusaEnvio({ step: "not-found" }), /não encontrado/);
  assert.match(motivoRecusaEnvio({ step: "no-line" }), /localizar a linha/);
  assert.match(motivoRecusaEnvio({ step: "invalid-serial" }), /inválido/);
  assert.match(motivoRecusaEnvio({ step: "outra-coisa" }), /recusada/); // fallback
});

test("tudo gravado, zero recusa → 200 ok:true", () => {
  const r = montarRespostaEnvio(3, []);
  assert.equal(r.http, 200);
  assert.deepEqual(r.body, { ok: true, gravados: 3 });
});

test("PARCIAL (2 gravados, 1 recusado) → 200 ok:true parcial:true com motivo", () => {
  const r = montarRespostaEnvio(2, [{ serial: "S9", step: "ja-fora-do-estoque", statusAtual: "Em Uso SP" }]);
  assert.equal(r.http, 200, "200 p/ um front antigo cair no caminho de sucesso e recarregar");
  assert.equal(r.body.ok, true);
  assert.equal(r.body.parcial, true);
  assert.equal(r.body.gravados, 2);
  assert.equal(r.body.erros.length, 1);
  assert.ok(r.body.erros[0].motivo, "cada erro carrega o motivo traduzido");
  assert.match(r.body.msg, /2 máquina.*1 recusada/);
});

test("nada gravado → 422 ok:false gravados:0", () => {
  const r = montarRespostaEnvio(0, [{ serial: "S1", step: "not-found" }, { serial: "S2", step: "serial-duplicado" }]);
  assert.equal(r.http, 422);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.gravados, 0);
  assert.equal(r.body.erros.length, 2);
});
