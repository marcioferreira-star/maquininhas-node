// api/index.js — handler serverless da Vercel.
// A Vercel roteia TODAS as requisições (ver vercel.json) para esta função,
// que delega ao app Express configurado em src/app.js.
import app from "../src/app.js";

export default app;
