// test/somente-leitura.test.js — o modo SOMENTE LEITURA do dia da virada (25/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { somenteLeituraLigado, deveRecusar, bloquearEscritaSeSomenteLeitura, MENSAGEM_SOMENTE_LEITURA } from "../src/utils/somente-leitura.js";

test("a flag liga SÓ com o valor exato '1'", () => {
  assert.equal(somenteLeituraLigado({ SOMENTE_LEITURA: "1" }), true);
  assert.equal(somenteLeituraLigado({ SOMENTE_LEITURA: " 1 " }), true);
  for (const v of [undefined, "", "0", "true", "sim", "on"]) {
    assert.equal(somenteLeituraLigado({ SOMENTE_LEITURA: v }), false, `não deveria ligar com ${JSON.stringify(v)}`);
  }
});

test("desligado: nada é recusado", () => {
  for (const c of ["/registrar-envio", "/atualizar-status", "/perdida", "/evento"]) {
    assert.equal(deveRecusar(false, "POST", c), false);
  }
});

test("ligado: as escritas de /api são recusadas", () => {
  for (const c of ["/registrar-envio", "/atualizar-status", "/evento", "/perdida", "/troca", "/localizar"]) {
    assert.equal(deveRecusar(true, "POST", c), true, c);
  }
  assert.equal(deveRecusar(true, "PUT", "/qualquer"), true);
  assert.equal(deveRecusar(true, "DELETE", "/qualquer"), true);
});

test("ligado: leitura e os dois syncs (só LEEM a planilha) continuam", () => {
  assert.equal(deveRecusar(true, "GET", "/registrar-envio"), false);
  assert.equal(deveRecusar(true, "HEAD", "/x"), false);
  assert.equal(deveRecusar(true, "OPTIONS", "/x"), false);
  assert.equal(deveRecusar(true, "POST", "/sync-manual"), false);
  assert.equal(deveRecusar(true, "POST", "/sync-manual/"), false);
  assert.equal(deveRecusar(true, "POST", "/sync-neon"), false);
});

test("o middleware responde 403 no formato que o front lê (data.msg)", () => {
  const antes = process.env.SOMENTE_LEITURA;
  process.env.SOMENTE_LEITURA = "1";
  try {
    let status = 0, corpo = null, seguiu = false;
    const res = { status(s) { status = s; return this; }, json(j) { corpo = j; return this; } };
    bloquearEscritaSeSomenteLeitura({ method: "POST", path: "/perdida" }, res, () => { seguiu = true; });
    assert.equal(seguiu, false);
    assert.equal(status, 403);
    assert.deepEqual(corpo, { ok: false, msg: MENSAGEM_SOMENTE_LEITURA });

    seguiu = false;
    bloquearEscritaSeSomenteLeitura({ method: "GET", path: "/perdida" }, res, () => { seguiu = true; });
    assert.equal(seguiu, true);
  } finally {
    if (antes === undefined) delete process.env.SOMENTE_LEITURA; else process.env.SOMENTE_LEITURA = antes;
  }
});
