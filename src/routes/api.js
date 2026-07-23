// src/routes/api.js
import express from "express";
import {
  registrarMovimento,
  getEventoInfo,
  getHistorico,
  getMaquinasIndex,
  invalidarCacheMaquinas,
  cadastrarEvento
} from "../db.js";

import { batchUpdateValues } from "../sheet.js";
import { hojeBR, parseBRDate, dataISOValida } from "../utils/datas.js";
import { montarAjusteStatus, montarRespostaEnvio } from "../utils/dominio.js";
import {
  marcarPerdida,
  registrarTroca,
  enviarParaLocalizar,
  ErroExcecao
} from "../excecoes.js";
import { sincronizar, ultimoSync } from "../sync-neon.js";

// flag: as ações de exceção (perda/troca/localizar) só gravam quando ligado.
const excecoesAtivas = () => process.env.EXCECOES_ATIVAS === "1";

const router = express.Router();

const SHEET_NAME = "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE";

// snapshot dos valores ATUAIS (G,O,N,J,K,L,M) de uma linha da CONTROLE — usado
// p/ desfazer o batchUpdate se o append no HISTORICO falhar (gravação quase-
// atômica). Compartilhado por /registrar-envio e /atualizar-status.
const snapshotControle = (ln, m) => [
  { range: `'${SHEET_NAME}'!G${ln}`, value: m.status ?? "-" },
  { range: `'${SHEET_NAME}'!O${ln}`, value: m.dataRetorno ?? "-" },
  { range: `'${SHEET_NAME}'!N${ln}`, value: m.dataSaida ?? "-" },
  { range: `'${SHEET_NAME}'!J${ln}`, value: m.idEvento ?? "-" },
  { range: `'${SHEET_NAME}'!K${ln}`, value: m.nomeEvento ?? "-" },
  { range: `'${SHEET_NAME}'!L${ln}`, value: m.produtora ?? "-" },
  { range: `'${SHEET_NAME}'!M${ln}`, value: m.comercial ?? "-" }
];

/* ======================================================
   Utils
   - hojeBR() e parseBRDate() vêm de utils/datas.js (fuso de Brasília,
     independente do TZ do processo — ver datas.js).
====================================================== */
function toBR(dateStr) {
  if (!dateStr) return "-";
  const onlyDate = String(dateStr).slice(0, 10);
  const [y, m, d] = onlyDate.split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

// converte "dd/mm/aaaa" para timestamp (para comparar datas)
function parseBRDateToTime(br) {
  const d = parseBRDate(br);
  return d ? d.getTime() : 0;
}

// garante que o "último envio" seja o mais recente pela data de saída
function getUltimoEnvio(registros) {
  const envios = (registros || []).filter(r =>
    String(r.acao || "").includes("Envio")
  );

  if (envios.length === 0) return null;

  let ultimo = envios[0];
  let maior = parseBRDateToTime(ultimo.saida);

  for (const r of envios) {
    const t = parseBRDateToTime(r.saida);
    if (t >= maior) {
      ultimo = r;
      maior = t;
    }
  }

  return ultimo;
}

// retorno deve usar primeiro os dados atuais do CONTROLE (mais confiável)
function temOrigemControle(maquina) {
  const id = String(maquina?.idEvento || "").trim();
  return id && id !== "-" && id !== "0";
}

/* ======================================================
   POST /api/registrar-envio
   - aceita:
     seriais: [{ serial, linha }]
     seriais: ["SERIAL"] (compat/popup/testes)
====================================================== */
router.post("/registrar-envio", async (req, res) => {
  try {
    const {
      id_evento,
      acao,
      dt_saida,
      dt_retorno,
      obs,
      seriais,
      obs_origem
    } = req.body;

    /* ============================
       VALIDAÇÕES BÁSICAS
    ============================ */
    if (!acao) return res.status(400).json({ ok: false, msg: "Selecione a ação." });

    if (!Array.isArray(seriais) || seriais.length === 0) {
      return res.status(400).json({ ok: false, msg: "Nenhuma máquina selecionada." });
    }

    const isEnvio = acao.includes("Envio");
    const isRetorno = acao.includes("Retorno");
    const isEnvioFixo = acao === "Envio Fixo";

    let eventoInfo = null;

    /* ============================
       FLUXO DE ENVIO
    ============================ */
    if (isEnvio) {
      if (!id_evento?.trim()) {
        return res.status(400).json({ ok: false, msg: "Informe o ID do evento." });
      }

      if (!dt_saida) {
        return res.status(400).json({ ok: false, msg: "Data de saída obrigatória." });
      }
      if (!dataISOValida(dt_saida)) {
        return res.status(400).json({ ok: false, msg: "Data de saída inválida." });
      }

      // retorno só é obrigatório (e validado) quando NÃO for Envio Fixo
      if (!isEnvioFixo) {
        if (!dt_retorno) {
          return res.status(400).json({ ok: false, msg: "Data de retorno obrigatória." });
        }
        if (!dataISOValida(dt_retorno)) {
          return res.status(400).json({ ok: false, msg: "Data de retorno inválida." });
        }
        // retorno não pode ser anterior à saída (agora sempre checado — datas válidas)
        const tSaida = parseBRDateToTime(toBR(dt_saida));
        const tRetorno = parseBRDateToTime(toBR(dt_retorno));
        if (tRetorno < tSaida) {
          return res.status(400).json({
            ok: false,
            msg: "A data de retorno não pode ser anterior à data de saída."
          });
        }
      }

      try {
        eventoInfo = await getEventoInfo(id_evento);
      } catch (e) {
        // erro de LEITURA da planilha ≠ "ID não existe"
        console.error("❌ Falha ao ler DADOS EVENTOS:", e);
        return res.status(503).json({
          ok: false,
          msg: "Não foi possível validar o evento agora (planilha indisponível). Tente de novo."
        });
      }

      if (!eventoInfo) {
        return res.status(404).json({
          ok: false,
          msg: `O ID ${id_evento} não existe na aba DADOS EVENTOS.`
        });
      }
    }

    /* ============================
       CARREGAMENTOS ÚNICOS
    ============================ */
    // ⚠️ histórico só é necessário no Retorno (fallback de origem)
    const historicoCompleto = isRetorno ? await getHistorico() : [];
    // ⚠️ index é usado para:
    // - resolver a linha correta pelo SERIAL (chave confiável)
    // - resolver origem do controle (idEvento/nomeEvento/etc) no retorno
    // ✅ force: garante nº de linha atualizado mesmo se a planilha mudou (uso simultâneo)
    const idxMaquinas = await getMaquinasIndex({ force: true });

    const hoje = hojeBR();
    const autor = req.session.user?.nome || "Sistema";

    /* ============================
       ACUMULADORES
    ============================ */
    const valueUpdates = [];
    const rollbackUpdates = [];   // ✅ valores ANTERIORES, p/ desfazer se o histórico falhar
    const historicoRows = [];
    const pendenciasPopup = [];
    const erros = [];

    /* ============================
       LOOP PRINCIPAL
    ============================ */
    for (const item of seriais) {
      let serial = "";
      let linha = 0;

      // compat: serial puro (string)
      if (typeof item === "string") {
        serial = String(item).trim();
      } else if (item && typeof item === "object") {
        serial = String(item.serial || "").trim();
        linha = Number(item.linha || 0);
      }

      if (!serial) {
        erros.push({ step: "invalid-serial", item });
        continue;
      }

      // serial que aparece 2×+ na CONTROLE é ambíguo: não dá pra saber qual
      // linha é a certa → recusa a operação em vez de gravar na máquina errada.
      if (idxMaquinas.duplicados && idxMaquinas.duplicados.has(serial)) {
        erros.push({ serial, step: "serial-duplicado" });
        continue;
      }

      const maquina = idxMaquinas.get(serial);
      if (!maquina) {
        erros.push({ serial, step: "not-found" });
        continue;
      }

      // ✅ a linha é SEMPRE resolvida pelo serial no índice fresco.
      // (ignora a linha enviada pelo front, que pode estar velha e apontar pra outra máquina)
      linha = Number(maquina.linha || 0);
      if (!linha) {
        erros.push({ serial, step: "no-line" });
        continue;
      }

      // ✅ pré-condição de status no BACKEND (defesa em profundidade; hoje só o
      // front valida). Envio exige máquina em Estoque; Retorno exige Em Uso/Fixo.
      // Evita reenviar máquina já em uso (perde a locação) ou "retornar" uma de
      // estoque (histórico inventado) via chamada direta ou tela velha.
      const statusAtual = String(maquina.status || "").toLowerCase().trim();
      if (isRetorno) {
        if (!(statusAtual.includes("em uso") || statusAtual === "fixo")) {
          erros.push({ serial, step: "nao-esta-em-uso", statusAtual: maquina.status });
          continue;
        }
      } else if (isEnvio) {
        if (!statusAtual.includes("estoque")) {
          erros.push({ serial, step: "ja-fora-do-estoque", statusAtual: maquina.status });
          continue;
        }
      }

      /* =========================================
           FLUXO DE RETORNO
      ========================================= */
      if (isRetorno) {
        const statusFinal = acao.replace("Retorno", "Estoque");

        // ✅ ORIGEM preferencial: dados atuais do CONTROLE
        let origem = null;

        if (temOrigemControle(maquina)) {
          origem = {
            evento: String(maquina.idEvento || "-"),
            nome_evento: String(maquina.nomeEvento || "-"),
            produtora: String(maquina.produtora || "-"),
            comercial: String(maquina.comercial || "-"),
            saida: String(maquina.dataSaida || "-")
          };
        } else {
          // fallback: pega o último envio pelo histórico
          const registros = historicoCompleto.filter(
            h => String(h.serial || "").trim() === serial
          );
          const ultimoEnvio = getUltimoEnvio(registros);

          if (ultimoEnvio) {
            origem = {
              evento: ultimoEnvio.evento,
              nome_evento: ultimoEnvio.nome_evento,
              produtora: ultimoEnvio.produtora,
              comercial: ultimoEnvio.comercial,
              saida: ultimoEnvio.saida
            };
          }
        }

        /* -------------------------------
           1) RETORNO sem origem (sem controle e sem histórico)
        ------------------------------- */
        if (!origem && !obs_origem) {
          pendenciasPopup.push(serial);
          continue;
        }

        /* -------------------------------
           2) RETORNO órfão com origem manual
        ------------------------------- */
        if (!origem && obs_origem) {
          historicoRows.push([
            serial,
            "-",
            acao,
            "-",
            hoje,
            statusFinal,
            autor,
            "-",
            "-",
            "-",
            obs_origem
          ]);

          rollbackUpdates.push(...snapshotControle(linha, maquina));
          valueUpdates.push(
            { range: `'${SHEET_NAME}'!G${linha}`, value: statusFinal },
            { range: `'${SHEET_NAME}'!O${linha}`, value: hoje },
            { range: `'${SHEET_NAME}'!J${linha}`, value: "-" },
            { range: `'${SHEET_NAME}'!K${linha}`, value: "-" },
            { range: `'${SHEET_NAME}'!L${linha}`, value: "-" },
            { range: `'${SHEET_NAME}'!M${linha}`, value: "-" }
          );

          continue;
        }

        /* -------------------------------
           3) RETORNO NORMAL
        ------------------------------- */
        historicoRows.push([
          serial,
          origem.evento,
          acao,
          origem.saida,
          hoje,
          statusFinal,
          autor,
          origem.nome_evento,
          origem.produtora,
          origem.comercial,
          obs || "-"
        ]);

        // ✅ política ÚNICA de retorno: o vínculo do evento fica registrado no
        // HISTÓRICO (origem.*), mas no CONTROLE as colunas de evento (J..M) são
        // LIMPAS — igual ao retorno órfão e ao /atualizar-status→Estoque. Antes,
        // este caminho mantinha o evento e os três caminhos divergiam.
        rollbackUpdates.push(...snapshotControle(linha, maquina));
        valueUpdates.push(
          { range: `'${SHEET_NAME}'!G${linha}`, value: statusFinal },
          { range: `'${SHEET_NAME}'!O${linha}`, value: hoje },
          { range: `'${SHEET_NAME}'!J${linha}`, value: "-" },
          { range: `'${SHEET_NAME}'!K${linha}`, value: "-" },
          { range: `'${SHEET_NAME}'!L${linha}`, value: "-" },
          { range: `'${SHEET_NAME}'!M${linha}`, value: "-" }
        );

        continue;
      }

      /* =========================================
           FLUXO DE ENVIO (NORMAL / FIXO)
      ========================================= */
      const dataSaidaBR = toBR(dt_saida);

      // Envio Fixo salva retorno como "-"
      const dataRetornoBR = isEnvioFixo ? "-" : toBR(dt_retorno);

      // Status "Fixo" quando for Envio Fixo
      const statusFinal = isEnvioFixo ? "Fixo" : acao.replace("Envio", "Em Uso");

      historicoRows.push([
        serial,
        id_evento,
        acao,
        dataSaidaBR,
        dataRetornoBR,
        statusFinal,
        autor,
        eventoInfo.nome_evento,
        eventoInfo.produtora,
        eventoInfo.comercial,
        obs || "-"
      ]);

      rollbackUpdates.push(...snapshotControle(linha, maquina));
      valueUpdates.push(
        { range: `'${SHEET_NAME}'!G${linha}`, value: statusFinal },
        { range: `'${SHEET_NAME}'!O${linha}`, value: dataRetornoBR },
        { range: `'${SHEET_NAME}'!N${linha}`, value: dataSaidaBR },
        { range: `'${SHEET_NAME}'!J${linha}`, value: eventoInfo.id_evento },
        { range: `'${SHEET_NAME}'!K${linha}`, value: eventoInfo.nome_evento },
        { range: `'${SHEET_NAME}'!L${linha}`, value: eventoInfo.produtora },
        { range: `'${SHEET_NAME}'!M${linha}`, value: eventoInfo.comercial }
      );
    }

    /* ======================================================
       POPUP
    ======================================================= */
    if (pendenciasPopup.length > 0) {
      return res.json({
        ok: false,
        needsPopup: true,
        seriais: pendenciasPopup,
        msg: "Alguns seriais não possuem histórico de envio."
      });
    }

    /* ======================================================
       GRAVAÇÃO QUASE-ATÔMICA
       1º) CONTROLE (estado/fonte da verdade)
       2º) HISTÓRICO (log). Se o log falhar, desfaz o CONTROLE.
       Assim nunca fica "máquina movida sem registro" nem o contrário.
    ======================================================= */
    if (valueUpdates.length > 0) {
      const okBatch = await batchUpdateValues(valueUpdates);
      if (!okBatch) {
        return res.status(500).json({
          ok: false,
          msg: "Falha ao atualizar a planilha. Nada foi gravado, tente de novo."
        });
      }
      // a planilha mudou → invalida o cache p/ o dashboard não servir o estado antigo
      invalidarCacheMaquinas();
    }

    if (historicoRows.length > 0) {
      const okHist = await registrarMovimento(historicoRows);
      if (!okHist) {
        // rollback do CONTROLE para não deixar estado sem histórico
        if (rollbackUpdates.length > 0) {
          const okRb = await batchUpdateValues(rollbackUpdates);
          console.error("❌ Histórico falhou. Rollback do CONTROLE:", okRb ? "OK" : "FALHOU");
          invalidarCacheMaquinas();
        }
        return res.status(500).json({
          ok: false,
          msg: "Falha ao gravar o histórico. As alterações foram revertidas, tente de novo."
        });
      }
    }

    /* ======================================================
       RETORNO FINAL
    ======================================================= */
    // cada máquina gravada empurrou exatamente 1 linha de histórico. O contrato
    // distingue total (200 ok) / PARCIAL (200 ok+parcial, a planilha mudou) /
    // nada gravado (422). Ver montarRespostaEnvio em utils/dominio.js.
    const resposta = montarRespostaEnvio(historicoRows.length, erros);
    return res.status(resposta.http).json(resposta.body);
  } catch (err) {
    console.error("❌ ERRO /api/registrar-envio:", err);
    return res.status(500).json({ ok: false, msg: "Erro interno no servidor." });
  }
});

/* ======================================================
   POST /api/atualizar-status
====================================================== */
router.post("/atualizar-status", async (req, res) => {
  try {
    const { serial, status } = req.body || {};

    if (!serial?.trim()) return res.status(400).json({ ok: false, msg: "Serial obrigatório." });
    if (!status?.trim()) return res.status(400).json({ ok: false, msg: "Status obrigatório." });

    // allow-list: só os status canônicos entram na planilha (defense-in-depth;
    // o front já limita, mas um POST forjado não deve gravar lixo na col G)
    const STATUS_VALIDOS = ["Estoque SP", "Estoque RJ", "Estoque URA", "Em Uso SP", "Em Uso RJ", "Em Uso URA", "Fixo"];
    const statusLimpo = String(status).trim();
    if (!STATUS_VALIDOS.includes(statusLimpo)) {
      return res.status(400).json({ ok: false, msg: "Status inválido." });
    }

    const idx = await getMaquinasIndex({ force: true }); // ✅ linha sempre atualizada
    const serialTrim = String(serial).trim();

    if (idx.duplicados && idx.duplicados.has(serialTrim)) {
      return res.status(409).json({ ok: false, msg: "Serial duplicado na planilha — resolver a duplicidade antes." });
    }

    const m = idx.get(serialTrim);

    if (!m) return res.status(404).json({ ok: false, msg: "Serial não encontrado." });

    // DIFF + linha do HISTORICO (preserva a origem que a CONTROLE vai perder).
    const autor = req.session.user?.nome || "Sistema";
    const plano = montarAjusteStatus(m, statusLimpo, hojeBR(), autor);

    // nada mudaria na planilha (status igual e nada a limpar) → não grava nem loga
    if (plano.nadaAMudar) {
      return res.json({ ok: true, msg: `Nada a alterar — a máquina já está em ${statusLimpo}.` });
    }

    const updates = plano.celulas.map((c) => ({
      range: `'${SHEET_NAME}'!${c.col}${m.linha}`,
      value: c.value
    }));
    const rollback = snapshotControle(m.linha, m); // snapshot ANTES de escrever

    /* gravação quase-atômica (mesmo padrão do /registrar-envio):
       1º CONTROLE; 2º HISTORICO; se o log falhar, desfaz o CONTROLE — nunca
       fica "status mudado sem registro" (a divergência silenciosa que existia). */
    const ok = await batchUpdateValues(updates);
    if (!ok) return res.status(500).json({ ok: false, msg: "Falha ao atualizar. Nada foi gravado, tente de novo." });
    invalidarCacheMaquinas(); // a planilha mudou → não servir estado antigo

    const okHist = await registrarMovimento([plano.historicoRow]);
    if (!okHist) {
      const okRb = await batchUpdateValues(rollback);
      console.error("❌ Histórico do ajuste falhou. Rollback do CONTROLE:", okRb ? "OK" : "FALHOU");
      invalidarCacheMaquinas();
      return res.status(500).json({
        ok: false,
        msg: "Falha ao gravar o histórico. A alteração foi revertida, tente de novo."
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRO /api/atualizar-status:", err);
    return res.status(500).json({ ok: false, msg: "Erro interno no servidor." });
  }
});

/* ======================================================
   GET /api/maquinas
====================================================== */
router.get("/maquinas", async (req, res) => {
  try {
    const idx = await getMaquinasIndex();
    const maquinas = Array.from(idx.values());
    return res.json({ ok: true, maquinas });
  } catch (err) {
    console.error("❌ ERRO /api/maquinas:", err);
    return res.status(503).json({ ok: false, msg: "Erro ao carregar máquinas." });
  }
});

/* ======================================================
   GET /api/evento/:id — lookup ao vivo (eco do nome no Envio)
   - 200 {ok, evento} | 404 não existe | 503 planilha indisponível
====================================================== */
router.get("/evento/:id", async (req, res) => {
  try {
    const evento = await getEventoInfo(req.params.id);
    if (!evento) return res.status(404).json({ ok: false, msg: "Evento não encontrado." });
    return res.json({ ok: true, evento });
  } catch (err) {
    console.error("❌ ERRO /api/evento (GET):", err);
    return res.status(503).json({ ok: false, msg: "Planilha indisponível. Tente de novo." });
  }
});

/* ======================================================
   POST /api/evento — cadastra evento novo na aba DADOS EVENTOS
====================================================== */
router.post("/evento", async (req, res) => {
  try {
    const { id_evento, nome, produtora, comercial } = req.body || {};
    const id = String(id_evento || "").trim();
    const nomeT = String(nome || "").trim();

    if (!id || !nomeT) {
      return res.status(400).json({ ok: false, msg: "ID e nome do evento são obrigatórios." });
    }

    // não duplicar: se já existe, avisa (diferencia planilha indisponível)
    let existente = null;
    try {
      existente = await getEventoInfo(id);
    } catch (e) {
      console.error("❌ Falha ao checar evento existente:", e);
      return res.status(503).json({ ok: false, msg: "Planilha indisponível. Tente de novo." });
    }
    if (existente) {
      return res.status(409).json({ ok: false, msg: `O ID ${id} já existe.` });
    }

    const ok = await cadastrarEvento({
      id,
      nome: nomeT,
      produtora: String(produtora || "").trim(),
      comercial: String(comercial || "").trim()
    });
    if (!ok) return res.status(500).json({ ok: false, msg: "Falha ao cadastrar o evento." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRO /api/evento (POST):", err);
    return res.status(500).json({ ok: false, msg: "Erro interno no servidor." });
  }
});

/* ======================================================
   AÇÕES DE EXCEÇÃO — gated pelo flag EXCECOES_ATIVAS
   (default OFF: retorna 403 até o Marcio ligar e validar)
====================================================== */
function gateExcecoes(res) {
  if (!excecoesAtivas()) {
    res.status(403).json({
      ok: false,
      msg: "Ações de exceção desativadas. Ligue EXCECOES_ATIVAS=1 para habilitar."
    });
    return false;
  }
  return true;
}

async function tratarAcaoExcecao(res, fn) {
  try {
    await fn();
    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroExcecao) return res.status(400).json({ ok: false, msg: e.message });
    console.error("❌ ação de exceção:", e);
    return res.status(500).json({ ok: false, msg: "Erro interno no servidor." });
  }
}

// POST /api/perdida — marca máquina como perdida (PERDIDAS + status na CONTROLE)
router.post("/perdida", async (req, res) => {
  if (!gateExcecoes(res)) return;
  const { serial, responsavel, observacao } = req.body || {};
  return tratarAcaoExcecao(res, () => marcarPerdida({ serial, responsavel, observacao }));
});

// POST /api/troca — registra troca (defeituosa → nova)
router.post("/troca", async (req, res) => {
  if (!gateExcecoes(res)) return;
  const { serialDefeito, problema, local, serialNova } = req.body || {};
  return tratarAcaoExcecao(res, () => registrarTroca({ serialDefeito, problema, local, serialNova }));
});

// POST /api/localizar — envia máquina para localizar (LOCALIZAR)
router.post("/localizar", async (req, res) => {
  if (!gateExcecoes(res)) return;
  const { serial, referencia } = req.body || {};
  return tratarAcaoExcecao(res, () => enviarParaLocalizar({ serial, referencia }));
});

/* ======================================================
   SYNC MANUAL (planilha → Neon) — login-gated
   - Paths propositalmente FORA de /api/sync-neon/... (esse prefixo casa
     antes, na rota do cron protegida por Bearer).
   - CSRF same-origin passa (é POST da própria página). A trava de
     concorrência (pg_advisory_lock) vive no sincronizar().
====================================================== */
router.post("/sync-manual", async (req, res) => {
  const quem = req.session.user?.email || req.session.user?.nome || "operador";
  try {
    const r = await sincronizar({ origem: `manual:${quem}` });
    return res.json(r);
  } catch (e) {
    if (e.code === "SYNC_EM_ANDAMENTO") {
      return res.status(409).json({ ok: false, msg: "Já há uma sincronização em andamento. Tente em instantes." });
    }
    console.error("❌ /api/sync-manual:", e);
    return res.status(500).json({ ok: false, msg: e.message || "Falha ao sincronizar." });
  }
});

router.get("/sync-status", async (req, res) => {
  try {
    const ultimo = await ultimoSync();
    return res.json({ ok: true, ultimo });
  } catch (e) {
    console.error("❌ /api/sync-status:", e);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
