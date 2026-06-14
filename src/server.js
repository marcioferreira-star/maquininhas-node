// src/server.js — entrypoint para rodar LOCALMENTE (node/nodemon).
// Na Vercel o app é servido por api/index.js (serverless), sem listen.
import app from "./app.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
