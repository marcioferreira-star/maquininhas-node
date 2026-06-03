import "dotenv/config";

// src/server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieSession from "cookie-session";

// Rotas
import loginRoutes from "./routes/login.js";
import indexRoutes from "./routes/index.js";
import maquinasRoutes from "./routes/maquinas.js";
import envioRoutes from "./routes/envio.js";
import apiRoutes from "./routes/api.js";
import historicoRoutes from "./routes/historico.js";

// Middleware de autenticação
import { requireLogin } from "./auth/authMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const IS_PROD = process.env.NODE_ENV === "production";

// Render/Heroku/etc terminam o TLS num proxy. Sem isso o cookie "secure" nunca é enviado.
app.set("trust proxy", 1);

/* ============================================================
   MIDDLEWARES BÁSICOS
============================================================ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ============================================================
   SESSÃO (cookie assinado — sem store em memória)
   - Guarda a sessão (pequena: nome + e-mail) no próprio cookie.
   - Sobrevive a restart/deploy do render (não desloga todo mundo)
     e não vaza memória.
============================================================ */
if (!process.env.SESSION_SECRET) {
  console.warn(
    "⚠️  SESSION_SECRET não definido — usando valor padrão INSEGURO. " +
    "Defina a variável de ambiente SESSION_SECRET em produção."
  );
}

app.use(
  cookieSession({
    name: "sess",
    keys: [process.env.SESSION_SECRET || "super-secret-ingresse"],
    httpOnly: true,            // bloqueia acesso via JS (XSS)
    secure: IS_PROD,           // só envia em HTTPS quando NODE_ENV=production
    sameSite: "lax",           // mitiga CSRF em navegação cross-site
    maxAge: 1000 * 60 * 60 * 8 // expira em 8h
  })
);

/* ============================================================
   USER GLOBAL PARA TODAS AS VIEWS
============================================================ */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

/* ============================================================
   PROTEÇÃO CSRF (checagem de origem)
   - Bloqueia POST/PUT/DELETE vindos de OUTRO site.
   - Complementa o cookie sameSite=lax. Não exige token no front.
============================================================ */
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const origin = req.get("origin") || req.get("referer");
  if (origin) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* origem malformada */ }
    if (originHost && originHost !== req.get("host")) {
      return res.status(403).send("Origem não permitida (CSRF).");
    }
  }
  next();
});

/* ============================================================
   ARQUIVOS ESTÁTICOS
============================================================ */
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   VIEW ENGINE
============================================================ */
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

/* ============================================================
   ROTAS PÚBLICAS (LOGIN)
============================================================ */
app.use("/", loginRoutes);

/* ============================================================
   ROTAS PRIVADAS (EXIGEM LOGIN)
============================================================ */
app.use("/", requireLogin, indexRoutes);
app.use("/maquinas", requireLogin, maquinasRoutes);
app.use("/envio", requireLogin, envioRoutes);
app.use("/historico", requireLogin, historicoRoutes);
app.use("/api", requireLogin, apiRoutes);

/* ============================================================
   INICIAR SERVIDOR (LOCAL + PRODUÇÃO)
============================================================ */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
