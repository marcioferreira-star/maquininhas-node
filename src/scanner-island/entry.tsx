// entry.tsx — ponto de entrada do BUNDLE do scanner (ilha React).
// Bundla o BarcodeScanner REAL do torre (React 19 + motor + zxing-wasm) num IIFE standalone
// e expõe uma API vanilla: window.ScannerBipe.abrir({ onLeu, titulo }). O maquininhas (Express+EJS,
// sem bundler) só carrega o .js pronto e monta o componente num <div>.
// Build: npx esbuild src/scanner-island/entry.tsx --bundle --format=iife --minify --jsx=automatic
//        --define:process.env.NODE_ENV='"production"' --outfile=src/public/vendor/scanner-torre.js
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { setZXingModuleOverrides } from "zxing-wasm/reader";
import { BarcodeScanner } from "./BarcodeScanner";
import { ehSerialDeMaquina } from "./scanner-engine";

// serve o .wasm LOCAL (senão o zxing-wasm busca no CDN jsDelivr)
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    /\.wasm$/.test(path) ? "/vendor/zxing/zxing_reader.wasm" : prefix + path,
});

interface AbrirOpts {
  onLeu?: (code: string) => unknown;      // por código aceito → o Envio faz biparSerial
  onChange?: (codes: string[]) => void;    // sequência do modal mudou
  statusDe?: (code: string) => string;     // status da máquina p/ mostrar no item bipado
  titulo?: string;
  existing?: string[];
}

(window as unknown as { ScannerBipe: unknown }).ScannerBipe = {
  abrir(opts: AbrirOpts = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fechar = () => {
      root.unmount();
      if (container.parentNode) container.parentNode.removeChild(container);
    };
    root.render(
      createElement(BarcodeScanner, {
        titulo: opts.titulo || "Bipar máquina",
        onLeu: opts.onLeu,
        onChange: opts.onChange,
        statusDe: opts.statusDe,
        onClose: fechar,
        existing: opts.existing || [],
      })
    );
    return { fechar };
  },
  ehSerialDeMaquina,
  disponivel: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
};
