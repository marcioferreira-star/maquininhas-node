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

// hash fixo p/ rodar bcrypt.compare mesmo quando o e-mail não existe — iguala o
// tempo de resposta e não vaza a existência do e-mail por timing.
const DUMMY_HASH = bcrypt.hashSync("timing-dummy", 10);

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
  try {
    const { email, senha } = req.body || {};

    // corpo malformado / campos ausentes → mensagem genérica (não 500/pendura)
    if (!email || !senha) {
      return res.status(400).render("login", {
        page: "login",
        erro: "E-mail ou senha inválidos."
      });
    }

    const chave = chaveTentativa(req, email);

    if (estaBloqueado(chave)) {
      return res.status(429).render("login", {
        page: "login",
        erro: "Muitas tentativas. Tente novamente em alguns minutos."
      });
    }

    const users = loadUsers();
    const user = users.find(u => u.email === email);

    // roda bcrypt SEMPRE (contra hash dummy quando o e-mail não existe) p/ igualar
    // o tempo de resposta; mensagem genérica não revela se o e-mail existe.
    const senhaOk = await bcrypt.compare(senha, user ? user.senha : DUMMY_HASH);
    const ok = senhaOk && !!user;

    if (!ok) {
      registrarFalha(chave);
      return res.status(401).render("login", {
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
  } catch (err) {
    console.error("❌ Erro no /login:", err);
    return res.status(500).render("login", {
      page: "login",
      erro: "Erro interno. Tente novamente."
    });
  }
});

/* ============================================================
   LOGOUT
============================================================ */
router.get("/logout", (req, res) => {
  req.session = null; // cookie-session: limpa o cookie de sessão
  res.redirect("/login");
});

export default router;
