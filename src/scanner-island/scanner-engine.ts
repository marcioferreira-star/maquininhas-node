// Motor do SCANNER de código de barras — lógica PURA (sem DOM, sem câmera), testável com Vitest.
// O componente <BarcodeScanner> (BarcodeScanner.tsx) consome isto. Portado do bipar-meep/ops-logistica-dashboard
// (deduplica o scanner que era copiado dashboard↔bipar — ledger #14). Camada UI: SEM exigência de parity do core.

// Formatos que aparecem nas etiquetas de maquininha POS (serial/patrimônio). Tirado EAN_13/EAN_8 (código de
// PRODUTO, não serial — fonte de leitura espúria). Code128 é o majoritário; ITF/Code39/93 e QR completam.
export const FORMATOS = ["code_128", "code_39", "code_93", "itf", "qr_code"] as const;

// Nomes de formato do zxing-wasm ("Code128") ≠ nomes do BarcodeDetector ("code_128"). O ramo WASM chama o
// readBarcodes do zxing-wasm DIRETO (ReaderOptions rápidos) e precisa desta ponte.
export const FORMATOS_ZXING = {
  code_128: "Code128", code_39: "Code39", code_93: "Code93", itf: "ITF", qr_code: "QRCode",
} as const satisfies Record<(typeof FORMATOS)[number], string>;
export const CONFIRMA = 2;        // multi-frame: nº de leituras idênticas seguidas antes de aceitar (anti-falso-positivo)
export const JANELA_MS = 700;     // votos mais velhos que isso reiniciam a contagem
export const COOLDOWN_MS = 1500;  // segura re-leitura do MESMO código enquanto ele fica no campo de visão

// "isso é serial/patrimônio de maquininha?" — ancorado no PADRÃO POR MARCA (prefixo), do banco Meep (vwUsuarioMeepPOS,
// ~101k máquinas, jun/2026; cobre ~98,5% do parque). Se NÃO casa, o lido NÃO é de máquina (IMEI, EAN de produto, QR…).
//  • PATRIMÔNIO (etiqueta Meep): 2-6 letras + dígitos — PAG/MP/STN/TM/LIO/GET/BNS/MAQ/EVO/KRE/FRG/BAN/PIN…
//  • SERIAL com LETRA, 8-16: PB..(PagSeguro/Stone) · 4A..(Cielo) · P340/PBM2/KM..(GetNet) · A0../6N../24C..(GetNet/Gertec).
//  • SERIAL NUMÉRICO só nos comprimentos REAIS: 10 (Moderninha) e 16 (GPOS/GetNet/MP). Exclui 13 (EAN), 14 (ITF-14), 15 (IMEI).
export function ehSerialDeMaquina(code: string): boolean {
  const s = (code || "").trim().toUpperCase();
  if (!s) return false;
  if (/[\s\/:.?=@]/.test(s)) return false;                  // serial/patrimônio NUNCA têm espaço/barra/:/./?/=/@ → mata QR-URL e token ('https://x/abc12345', 'AB12/CD34')
  if (/^[A-Z]{2,6}[0-9]{1,7}$/.test(s)) return true;        // patrimônio
  if (/^(?=.*[A-Z])[0-9A-Z]{8,16}$/.test(s)) return true;   // serial alfanumérico (tem letra)
  if (/^([0-9]{10}|[0-9]{16})$/.test(s)) return true;       // serial numérico: Moderninha (10) e GPOS/GetNet/MP (16)
  return false;
}

// CONSENSO multi-frame + cooldown, PURO (o `now` é injetado p/ testar sem relógio). O componente chama
// registrar(codesLidosNoFrame, now) a cada frame e recebe os códigos ACEITOS (confirmados CONFIRMA vezes na janela e
// fora do cooldown). O componente é quem faz o efeito colateral (beep/vibra/validação ehSerialDeMaquina/onLeu).
export function criarConsenso() {
  const votos = new Map<string, { n: number; last: number }>();     // code -> {contagem, ts do último voto}
  const cooldown = new Map<string, number>();                        // code -> ts do último aceite
  return {
    registrar(codes: string[], now: number): string[] {
      const aceitos: string[] = [];
      for (const raw of codes || []) {
        const code = String(raw || "").trim();
        if (!code) continue;
        const cd = cooldown.get(code);
        if (cd !== undefined && now - cd < COOLDOWN_MS) { cooldown.set(code, now); continue; }  // ainda no campo → segura
        const v0 = votos.get(code);
        const n = v0 && now - v0.last <= JANELA_MS ? v0.n + 1 : 1;    // voto renova a janela; senão reinicia
        votos.set(code, { n, last: now });
        if (n >= CONFIRMA) { votos.delete(code); cooldown.set(code, now); aceitos.push(code); }
      }
      for (const [k, v] of votos) if (now - v.last > JANELA_MS * 3) votos.delete(k);  // GC dos votos velhos
      return aceitos;
    },
    reset() { votos.clear(); cooldown.clear(); },
  };
}
export type Consenso = ReturnType<typeof criarConsenso>;

// ── RECORTE DA BANDA CENTRAL — PURA. O <video> usa object-fit: cover (corta o frame pra preencher o box), então a
// banda que o usuário VÊ (top 39% / altura 22%, casa com .scan-band no CSS) não é a mesma fração do frame cru. Este
// cálculo desfaz o cover (escala + offsets) e devolve o retângulo do FRAME que corresponde 1:1 à linha-guia. ──
export const BANDA_TOPO = 0.39;    // fração da ALTURA VISÍVEL onde a banda começa (espelho de .scan-band { top })
export const BANDA_ALTURA = 0.22;  // fração da altura visível que a banda ocupa (espelho de .scan-band { height })
export function calcularCrop(vw: number, vh: number, cw: number, ch: number): { sx: number; sy: number; sw: number; sh: number } | null {
  if (!vw || !vh || !cw || !ch) return null;
  const scale = Math.max(cw / vw, ch / vh);          // cover = a MAIOR escala que preenche o box
  const visW = Math.min(vw, cw / scale);             // porção do frame realmente visível
  const visH = Math.min(vh, ch / scale);
  const offX = (vw - visW) / 2, offY = (vh - visH) / 2;
  return { sx: offX, sy: offY + visH * BANDA_TOPO, sw: visW, sh: visH * BANDA_ALTURA };
}

// ── NITIDEZ (variância do Laplaciano) + LUMA MÉDIO — PURA, uma passada só. O loop mede o crop antes de decodificar:
// se abaixo do limiar (frame borrado/em movimento), PULA o det.detect (barra fina de Code128 borrada nunca decodifica
// → é só CPU, pior no iOS) e sinaliza re-foco. O luma médio alimenta a exposição adaptativa (decidirExposicao).
// `data` = RGBA do canvas; usa o canal R subamostrado (etiqueta é P&B). nitidez maior = mais nítido. ──
export function medirFrame(data: Uint8ClampedArray, w: number, h: number, step = 8): { nitidez: number; media: number } {
  let sum = 0, sum2 = 0, soma = 0, n = 0;
  const row = w * 4;
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const i = (y * w + x) * 4;
      const c = data[i]!;
      const lap = 4 * c - data[i - 4]! - data[i + 4]! - data[i - row]! - data[i + row]!;  // Laplaciano 4-vizinhos (canal R)
      sum += lap; sum2 += lap * lap; soma += c; n++;
    }
  }
  if (n < 2) return { nitidez: 0, media: 0 };
  const mean = sum / n;
  return { nitidez: sum2 / n - mean * mean, media: soma / n };   // variância + luma médio
}
export function nitidez(data: Uint8ClampedArray, w: number, h: number, step = 8): number {
  return medirFrame(data, w, h, step).nitidez;
}

// ── GATE DE NITIDEZ com re-foco e anti-inanição — PURO. Decide por frame: decodifica (nítido), pula (borrado) e
// quando re-focar (borrado persistente). `forcarApos` garante que o gate NUNCA trava a leitura pra sempre: câmera de
// baixo contraste que nunca cruza o limiar ganha 1 tentativa de decode a cada N frames borrados (barato o bastante). ──
export function criarGateNitidez(opts?: { limiar?: number; refocoApos?: number; forcarApos?: number }) {
  const limiar = opts?.limiar ?? 25, refocoApos = opts?.refocoApos ?? 8, forcarApos = opts?.forcarApos ?? 30;
  let borrados = 0, bloqueados = 0;
  return {
    decidir(nit: number): { decodificar: boolean; refocar: boolean } {
      if (nit >= limiar) { borrados = 0; bloqueados = 0; return { decodificar: true, refocar: false }; }
      borrados++; bloqueados++;
      const refocar = borrados >= refocoApos;
      if (refocar) borrados = 0;
      if (bloqueados >= forcarApos) { bloqueados = 0; return { decodificar: true, refocar }; }
      return { decodificar: false, refocar };
    },
    reset() { borrados = 0; bloqueados = 0; },
  };
}

// ── ESCALONADOR de esforço do decode — PURO. O ramo WASM roda por padrão o modo "rapido" (sem tryHarder/tryRotate/
// tryInvert = frame barato). Se acumular `aposFalhas` tentativas seguidas SEM leitura (etiqueta de cabeça pra baixo,
// invertida, difícil), 1 a cada `periodo` tentativas vira "caprichado" (liga tudo) — recupera esses casos sem pagar o
// custo alto em todo frame. Qualquer leitura volta pro rápido. ──
export function criarEscalonador(opts?: { aposFalhas?: number; periodo?: number }) {
  const aposFalhas = opts?.aposFalhas ?? 12, periodo = opts?.periodo ?? 4;
  let falhas = 0;
  return {
    modo(): "rapido" | "caprichado" {
      return falhas >= aposFalhas && (falhas - aposFalhas) % periodo === 0 ? "caprichado" : "rapido";
    },
    registrar(achou: boolean) { falhas = achou ? 0 : falhas + 1; },
    reset() { falhas = 0; },
  };
}

// ── EXPOSIÇÃO ADAPTATIVA — PURA. Etiqueta laminada/reflexo satura o sensor ("estoura" o branco) e as barras finas do
// Code128 somem no clarão. Decide o exposureCompensation alvo a partir do luma médio do CROP: muito claro (>200) →
// ~0,5 EV pra baixo (quantizado ao step do device); voltou ao escuro (<110) → sobe de volta rumo a 0. Nunca acima de
// 0 (código de barras não precisa de +EV) e histerese larga entre os dois limiares pra não oscilar. null = não mexe. ──
export function decidirExposicao(media: number, atual: number, caps: { min: number; max: number; step: number }): number | null {
  const passo = caps.step > 0 ? caps.step : 0.5;
  const salto = Math.max(passo, Math.round(0.5 / passo) * passo);   // ~0,5 EV no passo do device
  const teto = Math.min(caps.max, 0);
  const EPS = 1e-6;
  if (media > 200) {
    const alvo = Math.max(caps.min, Math.min(teto, atual - salto));
    return alvo < atual - EPS ? alvo : null;
  }
  if (media < 110 && atual < -EPS) {
    const alvo = Math.max(caps.min, Math.min(teto, atual + salto));
    return alvo > atual + EPS ? alvo : null;
  }
  return null;
}

// média móvel simples (janela fixa) — instrumentação (ms/frame do decode, luma suavizado). PURA.
export function criarMediaMovel(janela = 30) {
  const buf: number[] = [];
  return {
    add(v: number) { buf.push(v); if (buf.length > janela) buf.shift(); },
    media(): number { return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : 0; },
    cheia(): boolean { return buf.length >= janela; },
  };
}

// mapeia o toque no <video> (clientX/Y + rect) → ponto relativo 0..1 (p/ pointsOfInterest do tap-to-focus). PURA/clampada.
export function pontoRelativo(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { x: clamp((clientX - rect.left) / (rect.width || 1)), y: clamp((clientY - rect.top) / (rect.height || 1)) };
}

// ── SEQUÊNCIA DE BIPAGEM (fonte-de-verdade do modal). Helpers PUROS testáveis; o componente só guarda o estado e emite
// onChange(codesDe(itens)). `ok` = ehSerialDeMaquina (item entra mesmo inválido, marcado, p/ o freela ver e corrigir). ──
export type ItemBipe = { id: string; code: string; ok: boolean };
let _seq = 0;
const _up = (s: string) => String(s || "").trim().toUpperCase();
export function novoItem(code: string): ItemBipe {
  const c = String(code || "").trim();
  return { id: `b${(_seq++).toString(36)}-${Date.now().toString(36)}`, code: c, ok: ehSerialDeMaquina(c) };   // id estável (contador → único mesmo no mesmo ms)
}
// adiciona no FIM (ordem de bipagem); dup case-insensitive → devolve a MESMA ref (sinaliza duplicado sem mexer na lista).
export function addItem(itens: ItemBipe[], code: string): { itens: ItemBipe[]; dup: boolean } {
  const c = String(code || "").trim();
  if (!c) return { itens, dup: false };
  if (itens.some((it) => _up(it.code) === _up(c))) return { itens, dup: true };
  return { itens: [...itens, novoItem(c)], dup: false };
}
export function removeItem(itens: ItemBipe[], id: string): ItemBipe[] {
  return itens.filter((it) => it.id !== id);
}
// troca o code do alvo e REVALIDA ok. Recusa (dup) se colidir com OUTRO item; PERMITE se o único match é o próprio alvo (re-bipar igual).
export function replaceItem(itens: ItemBipe[], id: string, code: string): { itens: ItemBipe[]; dup: boolean } {
  const c = String(code || "").trim();
  if (c && itens.some((it) => it.id !== id && _up(it.code) === _up(c))) return { itens, dup: true };
  return { itens: itens.map((it) => (it.id === id ? { ...it, code: c, ok: ehSerialDeMaquina(c) } : it)), dup: false };
}
// o que vai pra busca: os codes na ORDEM DE INSERÇÃO (a lista renderiza reverse, mas a busca recebe ordem de bipagem).
export function codesDe(itens: ItemBipe[]): string[] {
  return itens.map((it) => it.code).filter(Boolean);
}
