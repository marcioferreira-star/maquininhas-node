import "dotenv/config";

// src/app.js — configuração do Express (sem listen).
// Exporta o `app` para ser usado tanto no servidor local (server.js)
// quanto no handler serverless da Vercel (api/index.js).
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
import excecoesRoutes from "./routes/excecoes.js";
import syncRoutes from "./routes/sync.js";

// Middleware de autenticação
import { requireLogin } from "./auth/authMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const IS_PROD = process.env.NODE_ENV === "production";

// Render/Vercel/etc terminam o TLS num proxy. Sem isso o cookie "secure" nunca é enviado.
app.set("trust proxy", 1);

// não vaza a stack (Express) no header
app.disable("x-powered-by");

/* ============================================================
   HEADERS DE SEGURANÇA (hardening barato, sem dependência nova)
   - X-Frame-Options: bloqueia clickjacking (embutir a tela logada em iframe)
   - X-Content-Type-Options: nosniff
   - HSTS só em produção (força HTTPS no cliente)
============================================================ */
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (IS_PROD) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

/* ============================================================
   MIDDLEWARES BÁSICOS
============================================================ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ============================================================
   SESSÃO (cookie assinado — sem store em memória)
   - Guarda a sessão (pequena: nome + e-mail) no próprio cookie.
   - Sobrevive a restart/deploy e funciona em serverless (sem
     instância fixa em memória) e não vaza memória.
============================================================ */
// FAIL-CLOSED: em produção, sem SESSION_SECRET o app NÃO sobe — assim nunca
// assina o cookie com uma chave padrão conhecida (que permitiria forjar sessão).
if (!process.env.SESSION_SECRET) {
  if (IS_PROD) {
    throw new Error(
      "SESSION_SECRET não definido em produção. Defina a variável de ambiente " +
      "antes do deploy (fail-closed intencional)."
    );
  }
  console.warn(
    "⚠️  SESSION_SECRET não definido — usando valor de desenvolvimento INSEGURO. " +
    "Só aceitável em ambiente local."
  );
}

app.use(
  cookieSession({
    name: "sess",
    keys: [process.env.SESSION_SECRET || "dev-only-inseguro-nao-usar-em-prod"],
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
  // flag p/ as views mostrarem/ocultarem os botões de ação de exceção
  res.locals.excecoesAtivas = process.env.EXCECOES_ATIVAS === "1";
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

// endpoint do Vercel Cron (autenticado por CRON_SECRET, NÃO por login) —
// registrado ANTES de qualquer requireLogin (o mount "/" do dashboard casa com tudo).
app.use("/api/sync-neon", syncRoutes);

/* ============================================================
   ROTAS PRIVADAS (EXIGEM LOGIN)
============================================================ */
app.use("/", requireLogin, indexRoutes);
app.use("/maquinas", requireLogin, maquinasRoutes);
app.use("/envio", requireLogin, envioRoutes);
app.use("/historico", requireLogin, historicoRoutes);
app.use("/excecoes", requireLogin, excecoesRoutes);
app.use("/api", requireLogin, apiRoutes);

export default app;
