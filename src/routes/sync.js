// src/routes/sync.js
// Endpoint chamado pelo Vercel Cron para sincronizar Planilha → Neon.
// Protegido por CRON_SECRET (a Vercel injeta "Authorization: Bearer <CRON_SECRET>").
// NÃO fica atrás do requireLogin (é chamado por máquina, não por usuário).
import express from "express";
import { sincronizar } from "../sync-neon.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, msg: "não autorizado" });
  }
  try {
    const r = await sincronizar({ origem: "cron" });
    console.log("✅ sync-neon:", JSON.stringify(r));
    return res.json(r);
  } catch (e) {
    // colisão com um sync manual/em andamento não é falha — pula o ciclo sem alarmar
    if (e.code === "SYNC_EM_ANDAMENTO") {
      console.log("⏭️ sync-neon: já em andamento, pulando este ciclo.");
      return res.json({ ok: false, motivo: "em_andamento" });
    }
    console.error("❌ sync-neon:", e);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
