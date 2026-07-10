// src/routes/maquinas.js
import express from "express";
import { getMaquinas } from "../db.js";

const router = express.Router();

/* ============================================================
   GET – Página Máquinas Cadastradas
============================================================ */
router.get("/", async (req, res) => {
  const inicio = Date.now();

  try {
    const maquinas = await getMaquinas();

    const listaSegura = Array.isArray(maquinas) ? maquinas : [];

    console.log(
      `✅ /maquinas carregado: ${listaSegura.length} máquinas (em ${Date.now() - inicio}ms)`
    );

    res.render("maquinas", {
      page: "maquinas",
      erro: false,
      maquinas: listaSegura
    });

  } catch (err) {
    console.error("❌ Erro ao carregar máquinas:");
    console.error(err.stack || err);

    res.render("maquinas", {
      page: "maquinas",
      erro: true,
      maquinas: []
    });
  }
});

export default router;
