// src/routes/historico.js
import express from "express";
import { getHistorico } from "../db.js";

const router = express.Router();

/* ============================================================
   GET – Página Histórico
============================================================ */
router.get("/", async (req, res) => {
  const inicio = Date.now();

  try {
    const historico = await getHistorico();

    const listaSegura = Array.isArray(historico) ? historico : [];

    console.log(
      `📘 /historico carregado: ${listaSegura.length} linhas (em ${Date.now() - inicio}ms)`
    );

    res.render("historico", {
      page: "historico",
      erro: false,
      historico: listaSegura
    });

  } catch (err) {
    console.error("❌ Erro ao carregar histórico:");
    console.error(err.stack || err);

    res.render("historico", {
      page: "historico",
      erro: true,
      historico: []
    });
  }
});

export default router;
