// tools/etl/diagnostico-dados.js
// Onda 6 — diagnóstico de QUALIDADE DE DADOS da planilha (READ-ONLY).
// Lê as 6 abas, aplica os checks de curadoria e gera TSVs "Revisar" p/ o Marcio
// decidir linha a linha (nada é escrito/alterado na planilha).
//
// Uso:  node tools/etl/diagnostico-dados.js [dir_saida]
//   (precisa de GOOGLE_SERVICE_ACCOUNT_JSON no .env)

import "dotenv/config";
import fs from "fs";
import path from "path";
import { getSheetData } from "../../src/sheet.js";
import { serialSheetParaBR } from "../../src/utils/datas.js";

const SAIDA = process.argv[2] || path.join(process.cwd(), "etl-saida");
fs.mkdirSync(SAIDA, { recursive: true });

const TABS = {
  CONTROLE: "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE",
  HISTORICO: "HISTORICO MAQUINAS",
  EVENTOS: "DADOS EVENTOS",
  PERDIDAS: "PERDIDAS PAGSEGURO - INGRESSE",
  TROCAS: "TROCAS",
  LOCALIZAR: "LOCALIZAR"
};

const ANO_MIN = 2018;
const ANO_MAX = new Date().getFullYear() + 2;
const SENTINELAS = new Set(["01/01/2040", "15/07/1905"]);

// devolve {tipo:'ok'|'sentinela'|'lixo'|'nao-data', br} para um valor de célula de data
function classificaData(v) {
  const s = serialSheetParaBR(String(v ?? "").trim());
  if (!s || s === "-" || s === "0") return { tipo: "vazio", br: s };
  if (SENTINELAS.has(s)) return { tipo: "sentinela", br: s };
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return { tipo: "nao-data", br: s };
  const ano = Number(m[3]);
  if (ano < ANO_MIN || ano > ANO_MAX) return { tipo: "lixo", br: s };
  return { tipo: "ok", br: s };
}

function tsv(rows) {
  return rows.map((r) => r.map((c) => String(c ?? "").replace(/\t|\n/g, " ")).join("\t")).join("\n");
}
function grava(nome, header, linhas) {
  const conteudo = tsv([header, ...linhas]);
  fs.writeFileSync(path.join(SAIDA, nome), conteudo + "\n", "utf8");
  return linhas.length;
}

async function main() {
  console.log("Lendo as 6 abas (read-only)…");
  const [controle, historico, eventos, perdidas, trocas, localizar] = await Promise.all([
    getSheetData(`'${TABS.CONTROLE}'!A2:P`),
    getSheetData(`'${TABS.HISTORICO}'!A2:K`),
    getSheetData(`'${TABS.EVENTOS}'!A2:D`),
    getSheetData(`'${TABS.PERDIDAS}'!A2:P`),
    getSheetData(`'${TABS.TROCAS}'!A2:D`),
    getSheetData(`'${TABS.LOCALIZAR}'!A2:K`)
  ]);

  const resumo = {};

  // ---- 1) DATAS suspeitas (lixo / não-data) + contagem de sentinelas ----
  const datasRuins = [];
  let sentinelas = 0;
  const scanDatas = (aba, rows, colsData, colSerial) => {
    rows.forEach((r, i) => {
      colsData.forEach((ci) => {
        const c = classificaData(r[ci]);
        if (c.tipo === "sentinela") sentinelas++;
        if (c.tipo === "lixo" || c.tipo === "nao-data") {
          datasRuins.push([aba, i + 2, colSerial != null ? r[colSerial] : "", `col${ci}`, c.br, c.tipo]);
        }
      });
    });
  };
  scanDatas("CONTROLE", controle, [13, 14], 2);
  scanDatas("HISTORICO", historico, [3, 4], 0);
  scanDatas("PERDIDAS", perdidas, [11, 12], 0);
  resumo.datas_suspeitas = grava(
    "revisar-datas.tsv",
    ["Aba", "Linha", "Serial", "Coluna", "Valor", "Tipo"],
    datasRuins
  );
  resumo.sentinelas_auto_null = sentinelas;

  // ---- 2) id_evento inválido (N/A, vazio-com-nome, embutido no nome) ----
  const idsRuins = [];
  const regexId = /ID:?\s*(\d{4,6})/i;
  const scanId = (aba, rows, colId, colNome, colSerial) => {
    rows.forEach((r, i) => {
      const id = String(r[colId] ?? "").trim();
      const nome = String(r[colNome] ?? "").trim();
      const temNome = nome && nome !== "-";
      const embut = regexId.exec(nome);
      let motivo = "";
      if (/n\/?a/i.test(id)) motivo = "id = N/A";
      else if ((!id || id === "-") && temNome) motivo = embut ? "sem id, mas ID no nome: " + embut[1] : "tem nome de evento mas id vazio";
      else if (id && !/^\d+$/.test(id)) motivo = "id não-numérico";
      // id vazio + sem nome = máquina não-vinculada (estoque) → NÃO é Revisar
      if (motivo) idsRuins.push([aba, i + 2, r[colSerial] ?? "", id || "(vazio)", nome, motivo]);
    });
  };
  scanId("CONTROLE", controle, 9, 10, 2);
  scanId("PERDIDAS", perdidas, 7, 8, 0);
  resumo.ids_invalidos = grava(
    "revisar-ids-evento.tsv",
    ["Aba", "Linha", "Serial", "IdEvento", "NomeEvento", "Sugestao"],
    idsRuins
  );

  // ---- 3) DADOS EVENTOS: duplicatas DIVERGENTES (mesmo id, dados diferentes) ----
  const porId = new Map();
  eventos.forEach((r, i) => {
    const id = String(r[0] ?? "").trim();
    if (!id) return;
    const chave = `${r[1] ?? ""}|${r[2] ?? ""}|${r[3] ?? ""}`;
    if (!porId.has(id)) porId.set(id, new Map());
    const m = porId.get(id);
    m.set(chave, (m.get(chave) || 0) + 1);
  });
  const eventosDiverg = [];
  for (const [id, variantes] of porId) {
    if (variantes.size > 1) {
      for (const [chave, n] of variantes) {
        const [nome, prod, com] = chave.split("|");
        eventosDiverg.push([id, nome, prod, com, n]);
      }
    }
  }
  resumo.eventos_divergentes = grava(
    "revisar-eventos-divergentes.tsv",
    ["IdEvento", "Nome", "Produtora", "Comercial", "Ocorrencias"],
    eventosDiverg
  );

  // ---- 4) Serial duplicado na CONTROLE ----
  const contPorSerial = new Map();
  controle.forEach((r, i) => {
    const s = String(r[2] ?? "").trim();
    if (!s) return;
    if (!contPorSerial.has(s)) contPorSerial.set(s, []);
    contPorSerial.get(s).push({ linha: i + 2, status: r[6] ?? "" });
  });
  const seriaisDup = [];
  for (const [s, ocs] of contPorSerial) {
    if (ocs.length > 1) ocs.forEach((o) => seriaisDup.push([s, o.linha, o.status]));
  }
  resumo.seriais_duplicados = grava(
    "revisar-seriais-duplicados.tsv",
    ["Serial", "Linha", "Status"],
    seriaisDup
  );

  // ---- 5) Serial em MAIS DE UMA aba (CONTROLE + PERDIDAS/LOCALIZAR) ----
  const setControle = new Set([...contPorSerial.keys()]);
  const setPerdidas = new Set(perdidas.map((r) => String(r[0] ?? "").trim()).filter(Boolean));
  const setLocalizar = new Set(localizar.map((r) => String(r[2] ?? "").trim()).filter(Boolean));
  const multiAba = [];
  for (const s of setControle) {
    const emP = setPerdidas.has(s);
    const emL = setLocalizar.has(s);
    if (emP || emL) {
      const st = (contPorSerial.get(s)[0] || {}).status || "";
      multiAba.push([s, "CONTROLE(" + st + ")" + (emP ? " + PERDIDAS" : "") + (emL ? " + LOCALIZAR" : "")]);
    }
  }
  resumo.serial_multi_aba = grava(
    "revisar-serial-multi-aba.tsv",
    ["Serial", "Presenca"],
    multiAba
  );

  // ---- 6) Status fora do mapa (não Estoque/Em Uso/Fixo × SP/RJ/URA) ----
  const statusValidos = /^(estoque|em uso)\s+(sp|rj|ura)$|^fixo$/i;
  const statusRuins = [];
  const vistos = new Set();
  controle.forEach((r, i) => {
    const st = String(r[6] ?? "").trim();
    if (st && !statusValidos.test(st)) {
      statusRuins.push([i + 2, r[2] ?? "", st]);
      vistos.add(st);
    }
  });
  resumo.status_fora_mapa = grava(
    "revisar-status-fora-mapa.tsv",
    ["Linha", "Serial", "Status"],
    statusRuins
  );
  resumo.status_distintos_fora = [...vistos];

  // ---- 7) PERDIDAS: texto em coluna de DATA (JURÍDICO/MENSAL/etc.) ----
  const textoEmData = [];
  perdidas.forEach((r, i) => {
    [11, 12].forEach((ci) => {
      const c = classificaData(r[ci]);
      if (c.tipo === "nao-data" && c.br) textoEmData.push([i + 2, r[0] ?? "", `col${ci}`, c.br]);
    });
  });
  resumo.perdidas_texto_em_data = grava(
    "revisar-perdidas-texto-em-data.tsv",
    ["Linha", "Serial", "Coluna", "Valor"],
    textoEmData
  );

  // ---- 8) LOCALIZAR: entradas provavelmente já resolvidas ("*", "voltou") ----
  const localResolvidas = [];
  localizar.forEach((r, i) => {
    const ref = String(r[10] ?? "").trim();
    if (/^\*|voltou|voltei|encontrad|achei|ok\b/i.test(ref)) {
      localResolvidas.push([i + 2, r[2] ?? "", ref]);
    }
  });
  resumo.localizar_resolvidas = grava(
    "revisar-localizar-resolvidas.tsv",
    ["Linha", "Serial", "Referencia"],
    localResolvidas
  );

  // ---- RESUMO ----
  console.log("\n===== RESUMO (linhas por aba) =====");
  console.log(
    `CONTROLE ${controle.length} · HISTORICO ${historico.length} · EVENTOS ${eventos.length} · ` +
    `PERDIDAS ${perdidas.length} · TROCAS ${trocas.length} · LOCALIZAR ${localizar.length}`
  );
  console.log("\n===== CURADORIA (contagem por categoria 'Revisar') =====");
  console.log(JSON.stringify(resumo, null, 2));
  console.log(`\nTSVs gravados em: ${SAIDA}`);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
