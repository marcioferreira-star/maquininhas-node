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
    const r = await sincronizar();
    console.log("✅ sync-neon:", JSON.stringify(r));
    return res.json(r);
  } catch (e) {
    console.error("❌ sync-neon:", e);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
