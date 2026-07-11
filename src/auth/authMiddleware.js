export function requireLogin(req, res, next) {
  // Nos PREVIEWS da Vercel (VERCEL_ENV=preview) o login é DISPENSADO — revisão de
  // design/UI sem atrito. PRODUÇÃO continua protegida normalmente. Injeta um usuário
  // de preview p/ o app (que espera req.session.user) funcionar.
  // ⚠️ Tradeoff: o preview fica aberto — quem tiver a URL vê o app/dados sem login.
  if (process.env.VERCEL_ENV === "preview") {
    if (!req.session.user) {
      req.session.user = { nome: "Preview", email: "preview@ingresse.com" };
    }
    return next();
  }
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}
