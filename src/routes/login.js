// src/routes/login.js
import express from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

/* ============================================================
   RESOLVER CAMINHO ABSOLUTO DO users.json
============================================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Arquivo real onde ficam os usuários
const usersFile = path.join(__dirname, "../auth/users.json");

/* ============================================================
   CARREGAR USUÁRIOS
============================================================ */
function loadUsers() {
  try {
    if (!fs.existsSync(usersFile)) return [];
    const raw = fs.readFileSync(usersFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Erro lendo users.json:", err);
    return [];
  }
}

/* ============================================================
   RATE LIMIT SIMPLES (em memória) — anti brute-force no login
============================================================ */
const MAX_TENTATIVAS = 5;
const JANELA_MS = 10 * 60 * 1000; // 10 min
const tentativas = new Map(); // chave -> { count, bloqueadoAte }

function chaveTentativa(req, email) {
  return `${req.ip || ""}|${String(email || "").toLowerCase()}`;
}

function estaBloqueado(chave) {
  const t = tentativas.get(chave);
  return !!(t && t.bloqueadoAte && Date.now() < t.bloqueadoAte);
}

function registrarFalha(chave) {
  const t = tentativas.get(chave) || { count: 0, bloqueadoAte: 0 };
  t.count += 1;
  if (t.count >= MAX_TENTATIVAS) {
    t.bloqueadoAte = Date.now() + JANELA_MS;
    t.count = 0;
  }
  tentativas.set(chave, t);
}

/* ============================================================
   GET /login
============================================================ */
router.get("/login", (req, res) => {
  res.render("login", { page: "login", erro: null });
});

/* ============================================================
   POST /login
============================================================ */
router.post("/login", async (req, res) => {
  const { email, senha } = req.body;
  const chave = chaveTentativa(req, email);

  if (estaBloqueado(chave)) {
    return res.render("login", {
      page: "login",
      erro: "Muitas tentativas. Tente novamente em alguns minutos."
    });
  }

  const users = loadUsers();
  const user = users.find(u => u.email === email);

  // mensagem genérica nos dois casos (não revela se o e-mail existe)
  const ok = user ? await bcrypt.compare(senha, user.senha) : false;

  if (!ok) {
    registrarFalha(chave);
    return res.render("login", {
      page: "login",
      erro: "E-mail ou senha inválidos."
    });
  }

  // sucesso → zera o contador dessa chave
  tentativas.delete(chave);

  // Sessão salva — acessível em qualquer EJS via res.locals.user
  req.session.user = {
    nome: user.nome,
    email: user.email
  };

  return res.redirect("/");
});

/* ============================================================
   LOGOUT
============================================================ */
router.get("/logout", (req, res) => {
  req.session = null; // cookie-session: limpa o cookie de sessão
  res.redirect("/login");
});

export default router;
