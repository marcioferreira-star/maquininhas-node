// eslint.config.js — flat config (ESLint 10)
import js from "@eslint/js";
import globals from "globals";

export default [
  // vendor de terceiros (zxing-wasm minificado) não é lintado
  { ignores: ["src/public/vendor/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      // avisa (não quebra) em variáveis não usadas; ignora args/catch prefixados com _
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]
    }
  },
  {
    // JS de CLIENTE (browser, servido estático) — ex.: o scanner. IIFE (script), globais de browser.
    files: ["src/public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // catch vazio é intencional no scanner (sem áudio/foco/zoom/haptics — degrada sem quebrar)
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  }
];
