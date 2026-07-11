# Scanner "Bipe" — ilha React (componente REAL do torre)

O maquininhas é Express + EJS **sem bundler**, mas o scanner de câmera é o `BarcodeScanner`
**do torre** (React/TS) — usado aqui como **ilha React**: um bundle IIFE standalone que
o envio carrega como asset e monta num `<div>`.

## Fontes (copiadas do torre, VERBATIM)
- `BarcodeScanner.tsx`, `scanner-engine.ts`, `Icon.tsx` — de `C:\projetos\torre\packages\ui\src\`
  (só ajuste: imports `./x.js` → `./x` p/ o esbuild resolver `.ts/.tsx`).
- `entry.tsx` — wrapper que expõe `window.ScannerBipe.abrir({ onLeu, existing, titulo })` e
  seta o `locateFile` do zxing-wasm p/ `/vendor/zxing/zxing_reader.wasm` (sem CDN).

## Build (roda LOCAL; o bundle vai comitado — a Vercel NÃO buildа)
```
npm run build:scanner
```
Gera `src/public/vendor/scanner-torre.js` (~292KB: React 19 + react-dom + o componente + zxing-wasm).
DevDeps do build (dev-only, não vão pro deploy): react, react-dom, zxing-wasm@3.1.0, barcode-detector, esbuild.

## CSS
O CSS `.modal-*`/`.scan-*`/`.scan-seq-*` do torre foi copiado pro fim de `src/public/css/style.css`
com **aliases** de token no `:root` (`--panel-2`→`--surface-2`, `--modal-bg`→`--surface`,
`--ok-soft`/`--warn-soft`/`--danger-soft`→pill tokens, `--radius-pill`→`--radius-full`).

## Atualizar (se o torre mudar o scanner)
Re-copiar os 3 arquivos + reaplicar o ajuste de imports + `npm run build:scanner` + conferir o CSS.

## Integração no envio
`envio.ejs`: `<script defer src="/vendor/scanner-torre.js">` + botão "Bipar" →
`ScannerBipe.abrir({ onLeu: biparSerial, existing: selecionadas.slice() })`.
`biparSerial(code)` casa o serial CANÔNICO da planilha e popula `selecionadas` (devolve ok|dup|notfound).
Requer HTTPS (getUserMedia) — prod Vercel ok; preview idem; local via http://localhost.
