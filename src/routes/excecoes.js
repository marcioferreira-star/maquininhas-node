// src/routes/excecoes.js
import express from "express";
import { getPerdidas, getTrocas, getLocalizar } from "../excecoes.js";

const router = express.Router();

/* ============================================================
   GET – Exceções (Perdidas / Trocas / Localizar)
============================================================ */
router.get("/", async (req, res) => {
  const inicio = Date.now();

  try {
    const [perdidas, trocas, localizar] = await Promise.all([
      getPerdidas(),
      getTrocas(),
      getLocalizar()
    ]);

    console.log(
      `⚠️  /excecoes carregado: ${perdidas.length} perdidas · ${trocas.length} trocas · ${localizar.length} localizar (em ${Date.now() - inicio}ms)`
    );

    res.render("excecoes", {
      page: "excecoes",
      erro: false,
      perdidas,
      trocas,
      localizar
    });
  } catch (err) {
    console.error("❌ Erro ao carregar exceções:");
    console.error(err.stack || err);
    res.render("excecoes", {
      page: "excecoes",
      erro: true,
      perdidas: [],
      trocas: [],
      localizar: []
    });
  }
});

export default router;
