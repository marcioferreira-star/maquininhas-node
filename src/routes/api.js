// src/routes/api.js
import express from "express";
import {
  registrarMovimento,
  getEventoInfo,
  getHistorico,
  getMaquinasIndex
} from "../db.js";

import { batchUpdateValues } from "../sheet.js";

const router = express.Router();

const SHEET_NAME = "CONTROLE MAQUININHAS PAGSEGURO - INGRESSE";

/* ======================================================
   Utils
====================================================== */
function hojeBR() {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const d = String(hoje.getDate()).padStart(2, "0");
  return `${d}/${m}/${y}`;
}

function toBR(dateStr) {
  if (!dateStr) return "-";
  const onlyDate = String(dateStr).slice(0, 10);
  const [y, m, d] = onlyDate.split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

// converte "dd/mm/aaaa" para timestamp (para comparar datas)
function parseBRDateToTime(br) {
  if (!br || br === "-") return 0;
  const [d, m, y] = String(br).split("/");
  if (!d || !m || !y) return 0;
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
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
    if (!acao) return res.json({ ok: false, msg: "Selecione a ação." });

    if (!Array.isArray(seriais) || seriais.length === 0) {
      return res.json({ ok: false, msg: "Nenhuma máquina selecionada." });
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
        return res.json({ ok: false, msg: "Informe o ID do evento." });
      }

      if (!dt_saida) {
        return res.json({ ok: false, msg: "Data de saída obrigatória." });
      }

      // retorno só é obrigatório quando NÃO for Envio Fixo
      if (!isEnvioFixo && !dt_retorno) {
        return res.json({ ok: false, msg: "Data de retorno obrigatória." });
      }

      eventoInfo = await getEventoInfo(id_evento);

      if (!eventoInfo) {
        return res.json({
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

    // snapshot dos valores atuais (G,O,N,J,K,L,M) de uma linha — usado p/ rollback
    const snapshotRollback = (ln, m) => [
      { range: `'${SHEET_NAME}'!G${ln}`, value: m.status ?? "-" },
      { range: `'${SHEET_NAME}'!O${ln}`, value: m.dataRetorno ?? "-" },
      { range: `'${SHEET_NAME}'!N${ln}`, value: m.dataSaida ?? "-" },
      { range: `'${SHEET_NAME}'!J${ln}`, value: m.idEvento ?? "-" },
      { range: `'${SHEET_NAME}'!K${ln}`, value: m.nomeEvento ?? "-" },
      { range: `'${SHEET_NAME}'!L${ln}`, value: m.produtora ?? "-" },
      { range: `'${SHEET_NAME}'!M${ln}`, value: m.comercial ?? "-" }
    ];

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

          rollbackUpdates.push(...snapshotRollback(linha, maquina));
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

        rollbackUpdates.push(...snapshotRollback(linha, maquina));
        valueUpdates.push(
          { range: `'${SHEET_NAME}'!G${linha}`, value: statusFinal },
          { range: `'${SHEET_NAME}'!O${linha}`, value: hoje },
          { range: `'${SHEET_NAME}'!J${linha}`, value: origem.evento },
          { range: `'${SHEET_NAME}'!K${linha}`, value: origem.nome_evento },
          { range: `'${SHEET_NAME}'!L${linha}`, value: origem.produtora },
          { range: `'${SHEET_NAME}'!M${linha}`, value: origem.comercial }
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

      rollbackUpdates.push(...snapshotRollback(linha, maquina));
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
        return res.json({
          ok: false,
          msg: "Falha ao atualizar a planilha. Nada foi gravado, tente de novo."
        });
      }
    }

    if (historicoRows.length > 0) {
      const okHist = await registrarMovimento(historicoRows);
      if (!okHist) {
        // rollback do CONTROLE para não deixar estado sem histórico
        if (rollbackUpdates.length > 0) {
          const okRb = await batchUpdateValues(rollbackUpdates);
          console.error("❌ Histórico falhou. Rollback do CONTROLE:", okRb ? "OK" : "FALHOU");
        }
        return res.json({
          ok: false,
          msg: "Falha ao gravar o histórico. As alterações foram revertidas, tente de novo."
        });
      }
    }

    /* ======================================================
       RETORNO FINAL
    ======================================================= */
    if (erros.length > 0) {
      return res.json({
        ok: false,
        msg: "Alguns itens não foram processados.",
        erros
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRO /api/registrar-envio:", err);
    return res.json({ ok: false, msg: "Erro interno no servidor." });
  }
});

/* ======================================================
   POST /api/atualizar-status
====================================================== */
router.post("/atualizar-status", async (req, res) => {
  try {
    const { serial, status } = req.body;

    if (!serial?.trim()) return res.json({ ok: false, msg: "Serial obrigatório." });
    if (!status?.trim()) return res.json({ ok: false, msg: "Status obrigatório." });

    const idx = await getMaquinasIndex({ force: true }); // ✅ linha sempre atualizada
    const m = idx.get(String(serial).trim());

    if (!m) return res.json({ ok: false, msg: "Serial não encontrado." });

    const updates = [];

    // Atualiza STATUS (coluna G)
    updates.push({ range: `'${SHEET_NAME}'!G${m.linha}`, value: status });

    // Se virou FIXO → limpa retorno (coluna O) pra não ficar data antiga
    if (status === "Fixo") {
      updates.push({ range: `'${SHEET_NAME}'!O${m.linha}`, value: "-" });
    }

    // Se virou ESTOQUE → limpa evento e retorno (mantém planilha coerente)
    if (status.startsWith("Estoque")) {
      updates.push(
        { range: `'${SHEET_NAME}'!J${m.linha}`, value: "-" },
        { range: `'${SHEET_NAME}'!K${m.linha}`, value: "-" },
        { range: `'${SHEET_NAME}'!L${m.linha}`, value: "-" },
        { range: `'${SHEET_NAME}'!M${m.linha}`, value: "-" },
        { range: `'${SHEET_NAME}'!O${m.linha}`, value: "-" }
      );
    }

    const ok = await batchUpdateValues(updates);
    if (!ok) return res.json({ ok: false, msg: "Falha ao atualizar." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRO /api/atualizar-status:", err);
    return res.json({ ok: false, msg: "Erro interno no servidor." });
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
    return res.json({ ok: false, msg: "Erro ao carregar máquinas." });
  }
});

export default router;
