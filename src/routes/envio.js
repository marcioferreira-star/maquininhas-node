// src/routes/envio.js
import express from "express";
import { getMaquinas } from "../db.js";
import { hojeBR } from "../utils/datas.js";

const router = express.Router();

// "hoje" em BRT no formato aaaa-mm-dd (para o default do <input type=date>,
// sem depender do relógio/fuso do navegador)
function hojeISO() {
  const [d, m, a] = hojeBR().split("/");
  return `${a}-${m}-${d}`;
}

/* ============================================================
   GET – Página Envio / Retorno
============================================================ */
router.get("/", async (req, res) => {
  try {
    // ✅ força ler do Google Sheets (ignora cache)
    const maquinas = await getMaquinas({ force: true });

    const listaSegura = Array.isArray(maquinas) ? maquinas : [];

    console.log(`🔵 /envio → Máquinas carregadas: ${listaSegura.length}`);

    res.render("envio", {
      page: "envio",
      maquinas: listaSegura,
      hojeISO: hojeISO()
    });

  } catch (err) {
    console.error("❌ Erro ao carregar máquinas na rota /envio:");
    console.error(err.stack || err);

    res.render("envio", {
      page: "envio",
      maquinas: [],
      hojeISO: hojeISO()
    });
  }
});

export default router;
