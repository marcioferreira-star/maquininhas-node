// test/dominio.test.js
// Cobre a lógica de negócio pura (sem Sheets): resumo do dashboard e derivação
// da situação no histórico — antes intestável porque vivia dentro de db.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumoDeMaquinas, montarHistorico } from "../src/utils/dominio.js";

// "hoje" fixo p/ o teste ser determinístico (10/07/2026, meia-noite local)
const HOJE = new Date(2026, 6, 10);

test("resumoDeMaquinas — baldes de status e praça", () => {
  const maquinas = [
    { status: "Estoque SP" },
    { status: "Estoque RJ" },
    { status: "Estoque URA" },
    { status: "Em Uso SP", dataRetorno: "09/07/2026" }, // vencida ontem → atrasada
    { status: "Em Uso RJ", dataRetorno: "11/07/2026" }, // vence amanhã → no prazo
    { status: "Em Uso SP", dataRetorno: "10/07/2026" }, // vence HOJE → no prazo
    { status: "Fixo" }
  ];

  const r = resumoDeMaquinas(maquinas, HOJE);

  assert.equal(r.total, 7);
  assert.equal(r.disponiveis, 3);
  assert.equal(r.disponiveisSP, 1);
  assert.equal(r.disponiveisRJ, 1);
  assert.equal(r.disponiveisURA, 1);
  assert.equal(r.emUso, 4);   // 3 "Em Uso" + 1 "Fixo"
  assert.equal(r.fixas, 1);
  assert.equal(r.atrasadas, 1); // só a de 09/07 (vence hoje NÃO conta)
});

test("resumoDeMaquinas — lista vazia/indefinida não quebra", () => {
  const zero = resumoDeMaquinas([], HOJE);
  assert.equal(zero.total, 0);
  assert.equal(zero.atrasadas, 0);
  assert.equal(resumoDeMaquinas(undefined, HOJE).total, 0);
});

test("resumoDeMaquinas — máquina em uso sem data de retorno não é atrasada", () => {
  const r = resumoDeMaquinas([{ status: "Em Uso SP", dataRetorno: "-" }], HOJE);
  assert.equal(r.emUso, 1);
  assert.equal(r.atrasadas, 0);
});

// linhas cruas do HISTORICO: [serial, idEvento, acao, saida, retorno, status, usuario, nome, prod, com, obs]
test("montarHistorico — Devolvida, Fixo devolvido, e situação ao vivo", () => {
  const dados = [
    ["S1", "100", "Envio SP",    "01/06/2026", "30/06/2026", "Em Uso SP", "u", "EvA", "", "", ""], // 0
    ["S2", "200", "Envio Fixo",  "01/06/2026", "-",          "Fixo",      "u", "EvB", "", "", ""], // 1
    ["S1", "100", "Retorno SP",  "01/06/2026", "05/07/2026", "Estoque SP","u", "",    "", "", ""], // 2 (último de S1)
    ["S2", "200", "Retorno SP",  "01/06/2026", "05/07/2026", "Estoque SP","u", "",    "", "", ""], // 3 (último de S2)
    ["S3", "300", "Envio SP",    "01/06/2026", "31/12/2099", "Em Uso SP", "u", "EvC", "", "", ""], // 4 (último de S3)
    ["S4", "400", "Envio Fixo",  "01/06/2026", "-",          "Fixo",      "u", "EvD", "", "", ""]  // 5 (último de S4)
  ];

  const h = montarHistorico(dados);

  assert.equal(h[0].situacao, "Devolvida", "envio de S1 já não é o último → Devolvida");
  assert.equal(h[1].situacao, "Devolvida", "Envio Fixo de S2 já devolvido → Devolvida (fix)");
  assert.equal(h[2].situacao, "", "linha de Retorno não tem situação de prazo");
  assert.equal(h[3].situacao, "");
  assert.equal(h[4].situacao, "Dentro do prazo", "envio ativo com retorno no futuro");
  assert.equal(h[5].situacao, "Fixo", "Envio Fixo ainda ativo permanece Fixo");

  // sanidade dos campos mapeados
  assert.equal(h[0].serial, "S1");
  assert.equal(h[4].nome_evento, "EvC");
});

test("montarHistorico — vazio/indefinido → []", () => {
  assert.deepEqual(montarHistorico([]), []);
  assert.deepEqual(montarHistorico(undefined), []);
});

// R2 documentado: uma linha "Ajuste manual" (do /atualizar-status) vira o último
// movimento do serial → o Envio anterior passa a exibir "Devolvida", e a própria
// linha de ajuste não tem situação de prazo (não contém "envio").
test("montarHistorico — Ajuste manual encerra o envio (Devolvida) e não tem prazo", () => {
  const dados = [
    ["S1", "100", "Envio SP",      "01/06/2026", "30/06/2026", "Em Uso SP",  "u", "EvA", "", "", ""], // 0
    ["S1", "100", "Ajuste manual", "01/06/2026", "10/07/2026", "Estoque SP", "u", "EvA", "", "", "Ajuste manual: Em Uso SP → Estoque SP"] // 1 (último de S1)
  ];
  const h = montarHistorico(dados);
  assert.equal(h[0].situacao, "Devolvida", "envio deixou de ser o último → Devolvida");
  assert.equal(h[1].situacao, "", "linha de ajuste não é envio → sem situação de prazo");
});
