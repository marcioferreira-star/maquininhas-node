// test/eventos-merge.test.js
// Cadastro de evento em DUAS abas: a oficial "DADOS EVENTOS" (derivada de uma
// fórmula QUERY — o app NUNCA escreve nela, senão a expansão colide e a fórmula
// vira #REF!) e "DADOS EVENTOS MANUAIS" (escrita pelo app). A leitura junta as
// duas; aqui está a lógica pura desse merge + o carimbo de auditoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharEvento } from "../src/utils/dominio.js";
import { agoraBR } from "../src/utils/datas.js";

const OFICIAIS = [
  ["77202", "Churrasquinho Menos é Mais - Salvador", "42 | GRUPO ONDA", "Thiago Fernandes"],
  ["76961", "Pranchão", "221 | OQUEI Produções", "Lara Snoeck"]
];
const MANUAIS = [
  ["99001", "Evento cadastrado no app", "", "Marcio", "17/08/2026 14:32", "Marcio Ferreira"]
];

test("acharEvento — acha na aba oficial", () => {
  const e = acharEvento(OFICIAIS, MANUAIS, "76961");
  assert.equal(e.nome_evento, "Pranchão");
  assert.equal(e.comercial, "Lara Snoeck");
});

test("acharEvento — acha na aba manual (colunas extras de auditoria ignoradas)", () => {
  const e = acharEvento(OFICIAIS, MANUAIS, "99001");
  assert.deepEqual(e, {
    id_evento: "99001",
    nome_evento: "Evento cadastrado no app",
    produtora: "-", // vazio vira "-", igual à leitura da oficial
    comercial: "Marcio"
  });
});

test("acharEvento — mesmo ID nas duas: a OFICIAL vence", () => {
  const manuaisComColisao = [["76961", "Nome digitado à mão", "X", "Y"]];
  const e = acharEvento(OFICIAIS, manuaisComColisao, "76961");
  assert.equal(e.nome_evento, "Pranchão");
});

test("acharEvento — não existe em nenhuma → null", () => {
  assert.equal(acharEvento(OFICIAIS, MANUAIS, "12345"), null);
});

test("acharEvento — trim dos dois lados (busca e célula da planilha)", () => {
  assert.equal(acharEvento(OFICIAIS, MANUAIS, " 77202 ").nome_evento, "Churrasquinho Menos é Mais - Salvador");
  assert.equal(acharEvento([["  76961  ", "Pranchão"]], [], "76961").nome_evento, "Pranchão");
});

test("acharEvento — aba manual ausente/vazia não quebra (aba ainda não criada)", () => {
  assert.equal(acharEvento(OFICIAIS, [], "99001"), null);
  assert.equal(acharEvento(OFICIAIS, undefined, "76961").nome_evento, "Pranchão");
  assert.equal(acharEvento([], [], "76961"), null);
});

test("acharEvento — ID vazio nunca casa (não pega a 1ª linha por acidente)", () => {
  assert.equal(acharEvento([["", "Sem id"]], [], ""), null);
  assert.equal(acharEvento([["", "Sem id"]], [], "   "), null);
});

test("acharEvento — linha malformada na planilha não derruba a busca", () => {
  const sujas = [null, "texto solto", [], ["76961", "Pranchão"]];
  assert.equal(acharEvento(sujas, [], "76961").nome_evento, "Pranchão");
});

test("agoraBR — carimbo dd/mm/aaaa hh:mm em BRT, independente do TZ do processo", () => {
  const s = agoraBR();
  assert.match(s, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  const hora = Number(s.slice(11, 13));
  assert.ok(hora >= 0 && hora <= 23, `hora fora de faixa: ${s}`); // h23, nunca "24:00"
});
