// Build do bundle do scanner (ilha React do BarcodeScanner do torre) via API do esbuild.
// Usa a API JS (não a CLI) p/ evitar a fragilidade de citação de shell no --define:
// NODE_ENV precisa virar a STRING "production" (com aspas), senão o React cai no build DEV
// (~677KB + warnings) em vez do PROD (~292KB). cmd.exe e sh tratam as aspas diferente → API resolve.
// Uso: npm run build:scanner
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/scanner-island/entry.tsx"],
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "src/public/vendor/scanner-torre.js",
});

console.log("scanner-torre.js gerado (production)");
