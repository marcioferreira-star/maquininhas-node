"use client";
// Leitor de código de barras pela CÂMERA. Engine HÍBRIDA em 3 ramos: BarcodeDetector NATIVO (Chrome Android = ML Kit),
// zxing-wasm chamado DIRETO com ReaderOptions rápidos (iOS Safari/Firefox — o ponyfill rodava os defaults lentos), e o
// ponyfill 'barcode-detector' como último recurso. Lê SÓ na banda central (mapeada 1:1 com a linha-guia, mesmo com
// object-fit cover), exige 2 leituras iguais (consenso), pula frame borrado (gate de nitidez com anti-inanição),
// escala o esforço do decode quando a etiqueta não lê (tryHarder/tryRotate sob demanda), compensa exposição quando o
// branco estoura, toca pra focar (re-kick do AF) e monta a SEQUÊNCIA de bipagem dentro do modal (lista visível,
// desfazer, trocar por bipe/manual). Sobrevive a background/troca de app (reabre a câmera sozinho). A lógica pura
// (validação, consenso, nitidez, crop, gate, escalonador, exposição, sequência) vive em ./scanner-engine (testável).
// Câmera/DOM/UI ficam aqui. Portado do bipar-meep (deduplica — ledger #14).
import { useEffect, useRef, useState } from "react";
import type { ReaderOptions } from "zxing-wasm/reader";
import { Icon } from "./Icon";
import {
  ehSerialDeMaquina, criarConsenso, FORMATOS, FORMATOS_ZXING, calcularCrop, medirFrame, pontoRelativo,
  criarGateNitidez, criarEscalonador, decidirExposicao, criarMediaMovel,
  addItem, removeItem, replaceItem, codesDe, type ItemBipe,
} from "./scanner-engine";

const LIMIAR_NITIDEZ = 25;   // variância do Laplaciano mínima p/ VALER decodificar (conservador: deixa quase tudo passar; calibrar em campo)
const BORRADOS_REFOCO = 8;   // N frames borrados seguidos → re-dispara o autofoco
const BORRADOS_FORCA = 30;   // N frames borrados seguidos → tenta 1 decode mesmo assim (device de baixo contraste nunca cruza o limiar)

// as chaves de câmera (focusMode/torch/zoom/exposureCompensation…) não existem no lib.dom do TS — tipagem mínima local
// pra não espalhar `any` pelo componente.
type FaixaCap = { min?: number; max?: number; step?: number };
type CapsCamera = {
  focusMode?: string[]; exposureMode?: string[]; whiteBalanceMode?: string[];
  torch?: boolean; zoom?: FaixaCap; exposureCompensation?: FaixaCap; pointsOfInterest?: unknown;
};
const capsDe = (t: MediaStreamTrack): CapsCamera => {
  try { return (t.getCapabilities ? t.getCapabilities() : {}) as CapsCamera; } catch { return {}; }
};
const aplicarAvancado = (t: MediaStreamTrack, ...c: Record<string, unknown>[]) =>
  t.applyConstraints({ advanced: c } as MediaTrackConstraints);

type ModoDecode = "rapido" | "caprichado";
type Detector = {
  fonte: "nativo" | "wasm" | "wasm-pf";
  // canvas = fonte p/ os ramos que decodificam elemento; img = o MESMO ImageData que o gate de nitidez já extraiu
  // (o ramo WASM decodifica a partir dele — evita o drawImage+getImageData que o ponyfill refaz a cada frame).
  detectar: (canvas: HTMLCanvasElement, img: ImageData, modo: ModoDecode) => Promise<string[]>;
};
type ResultadoNativo = { rawValue?: string };
type DetectorNativo = { detect(src: CanvasImageSource): Promise<ResultadoNativo[]> };

// carrega o melhor decodificador disponível, do mais rápido pro mais lento.
async function criarDetector(): Promise<Detector> {
  // 1) BarcodeDetector NATIVO (ML Kit acelerado; já faz rotação/inversão por conta própria — modo não se aplica)
  try {
    const W = window as unknown as { BarcodeDetector?: { getSupportedFormats(): Promise<string[]>; new (o: { formats: string[] }): DetectorNativo } };
    if (typeof window !== "undefined" && W.BarcodeDetector) {
      const sup = await W.BarcodeDetector.getSupportedFormats();
      if (sup && sup.includes("code_128")) {
        const fmts = (FORMATOS as readonly string[]).filter((f) => sup.includes(f));
        const det = new W.BarcodeDetector({ formats: fmts.length ? fmts : ["code_128"] });
        return { fonte: "nativo", detectar: async (canvas) => (await det.detect(canvas)).map((c) => String(c?.rawValue ?? "")) };
      }
    }
  } catch { /* cai no WASM */ }
  // 2) zxing-wasm DIRETO (a mesma lib que o ponyfill embute) com ReaderOptions "rápido": os defaults do ponyfill
  //    (tryHarder/tryRotate/tryInvert=true, 255 símbolos) custam caro POR FRAME no iPhone; os casos que o modo
  //    rápido perde (etiqueta girada/invertida) o escalonador recupera com frames "caprichado" pontuais.
  try {
    const zx = await import("zxing-wasm/reader");
    try { void zx.prepareZXingModule({ fireImmediately: true }).catch(() => { /* aquece o WASM em paralelo ao getUserMedia; 1º readBarcodes re-tenta */ }); } catch { /* idem */ }
    const rapido: ReaderOptions = {
      formats: FORMATOS.map((f) => FORMATOS_ZXING[f]),
      tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: true,
      binarizer: "LocalAverage", maxNumberOfSymbols: 2, minLineCount: 2,
    };
    const caprichado: ReaderOptions = { ...rapido, tryHarder: true, tryRotate: true, tryInvert: true };
    return {
      fonte: "wasm",
      detectar: async (_canvas, img, modo) =>
        (await zx.readBarcodes(img, modo === "caprichado" ? caprichado : rapido)).map((r) => r.text ?? ""),
    };
  } catch { /* zxing-wasm indisponível → ponyfill */ }
  // 3) ponyfill (defaults lentos, mas funciona em qualquer lugar) — só se o import direto falhar
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  let formats = [...FORMATOS];
  try {
    const sup = await BarcodeDetector.getSupportedFormats();
    const f = formats.filter((x) => (sup as readonly string[]).includes(x));
    if (f.length) formats = f;
  } catch { /* usa todos */ }
  const det = new BarcodeDetector({ formats });
  return { fonte: "wasm-pf", detectar: async (canvas) => (await det.detect(canvas)).map((c) => String(c?.rawValue ?? "")) };
}

const vibrar = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* sem haptics */ } };

export function BarcodeScanner({ onChange, onLeu, onClose, existing = [], titulo = "Escanear código de barras", statusDe }: {
  onChange?: (codes: string[]) => void;
  onLeu?: (code: string) => void;        // legado (opcional) — o fluxo novo usa onChange(codes[])
  onClose: () => void;
  existing?: string[];
  titulo?: string;
  statusDe?: (code: string) => string;   // maquininhas: status da máquina p/ mostrar ao lado do serial bipado
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const consensoRef = useRef(criarConsenso());
  const onChangeRef = useRef(onChange);
  const onLeuRef = useRef(onLeu);
  onChangeRef.current = onChange;
  onLeuRef.current = onLeu;

  // SEQUÊNCIA de bipagem — fonte-de-verdade do modal (seeded do que já está na busca, deduplicado).
  const [itens, setItens] = useState<ItemBipe[]>(() => (existing || []).reduce<ItemBipe[]>((acc, c) => addItem(acc, c).itens, []));
  const itensRef = useRef(itens); itensRef.current = itens;
  // a lista rola (max-height) e o bipe novo entra no FIM — auto-rola pro último pro freela VER o que acabou de ler.
  const listRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (itens.length > prevLenRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    prevLenRef.current = itens.length;
  }, [itens.length]);
  const [trocandoId, setTrocandoId] = useState<string | null>(null);
  const trocandoRef = useRef<string | null>(null); trocandoRef.current = trocandoId;
  const [editId, setEditId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);   // feedback do botão Copiar (padrão copy-ok da casa: "Copiado" ~1,5s)

  const [erro, setErro] = useState("");
  const [fonte, setFonte] = useState("");
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ tipo: string; msg: string } | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torch, setTorch] = useState(false);
  const [hasFocusCtl, setHasFocusCtl] = useState(false);
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [debug, setDebug] = useState("");   // HUD de medição (opt-in: localStorage scan_debug = "1")

  const toggleTorch = async () => { const t = trackRef.current; if (!t) return; const v = !torch; try { await aplicarAvancado(t, { torch: v }); setTorch(v); } catch { /* sem lanterna */ } };
  const onZoom = async (v: number) => { setZoom(v); const t = trackRef.current; if (!t) return; try { await aplicarAvancado(t, { zoom: v }); } catch { /* sem zoom */ } };

  // destrava o AudioContext num GESTO do usuário (autoplay policy: nasce suspended). resume() DEVE ser síncrono no
  // handler. Recria se um unmount anterior fechou o contexto (StrictMode monta 2x).
  const destravarAudio = () => {
    try {
      if (!audioRef.current || audioRef.current.state === "closed") {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
        const Ctor = AC.AudioContext || AC.webkitAudioContext;
        if (Ctor) audioRef.current = new Ctor();
      }
      void audioRef.current?.resume?.();
    } catch { /* sem áudio */ }
  };

  // re-dispara o autofoco (single-shot na região tocada; senão manual→continuous força reconvergência em muitos Android).
  const reKickFoco = async (poi?: { x: number; y: number }) => {
    const t = trackRef.current; if (!t) return;
    try {
      const caps = capsDe(t);
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("single-shot")) {
        const adv: Record<string, unknown> = { focusMode: "single-shot" };
        if (poi && caps.pointsOfInterest) adv.pointsOfInterest = [poi];
        await aplicarAvancado(t, adv);
        setTimeout(() => aplicarAvancado(t, { focusMode: "continuous" }).catch(() => {}), 900);
      } else if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
        await aplicarAvancado(t, { focusMode: "manual" }).catch(() => {});
        await aplicarAvancado(t, { focusMode: "continuous" });
      }
    } catch { /* sem foco */ }
  };
  const aoTocarVideo = (e: React.PointerEvent) => {
    destravarAudio();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFlashKey((k) => k + 1);
    void reKickFoco(pontoRelativo(e.clientX, e.clientY, r));
  };

  // feedback sonoro (Web Audio) — sucesso agudo, duplicado grave, "não é máquina" descendente
  const tom = (tipo: "ok" | "dup" | "alerta") => {
    const ctx = audioRef.current; if (!ctx) return;
    try {
      if (ctx.state === "suspended") void ctx.resume?.();
      const t = ctx.currentTime;
      const nota = (freq: number, dt: number, dur: number, wave: OscillatorType, gain: number) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = wave; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(gain, t + dt); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
        o.start(t + dt); o.stop(t + dt + dur + 0.01);
      };
      if (tipo === "ok") nota(1180, 0, 0.12, "square", 0.08);
      else if (tipo === "dup") nota(360, 0, 0.18, "sine", 0.07);
      else { nota(660, 0, 0.13, "sawtooth", 0.07); nota(440, 0.14, 0.13, "sawtooth", 0.07); }
    } catch { /* sem áudio */ }
  };
  const flashToast = (tipo: string, msg: string) => setToast({ tipo, msg });
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 1400); return () => clearTimeout(id); }, [toast]);

  const emitir = (novos: ItemBipe[]) => { itensRef.current = novos; setItens(novos); onChangeRef.current?.(codesDe(novos)); };

  // um código já confirmado pelo consenso: se em MODO-TROCA substitui o alvo; senão empilha (entra mesmo inválido, marcado).
  const aceitar = (code: string) => {
    // MODO-TROCA: o próximo bipe substitui o item selecionado
    const alvo = trocandoRef.current;
    if (alvo) {
      const r = replaceItem(itensRef.current, alvo, code);
      if (r.dup) { tom("dup"); vibrar([35, 45, 35]); flashToast("warn", "já na lista"); return; }
      tom("ok"); vibrar(60); setFlashKey((k) => k + 1);
      setTrocandoId(null); onLeuRef.current?.(code); emitir(r.itens); return;
    }
    const r = addItem(itensRef.current, code);
    if (r.dup) { tom("dup"); vibrar([35, 45, 35]); flashToast("warn", "já na lista"); return; }
    if (!ehSerialDeMaquina(code)) { tom("alerta"); vibrar([70, 50, 130]); flashToast("erro", "confira: " + code); }
    else { tom("ok"); vibrar(60); }
    setFlashKey((k) => k + 1);
    onLeuRef.current?.(code); emitir(r.itens);
  };

  // ações da lista
  const desfazer = () => { const a = itensRef.current; if (a.length) emitir(a.slice(0, -1)); };
  // copia os códigos bipados UM-POR-LINHA pra colar na planilha no desktop (caso: freela bipa no celular).
  // só marca "Copiado" no SUCESSO real do clipboard — no catch NUNCA finge que copiou (feedback honesto).
  const copiar = async () => {
    const codes = codesDe(itensRef.current);
    if (!codes.length) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { flashToast("erro", "não consegui copiar"); }
  };
  const removerItem = (id: string) => { if (editId === id) setEditId(null); if (trocandoId === id) setTrocandoId(null); emitir(removeItem(itensRef.current, id)); };
  const iniciarTroca = (id: string) => { setEditId(null); setTrocandoId((cur) => (cur === id ? null : id)); consensoRef.current.reset(); };
  const confirmarEdicao = (id: string, valor: string) => {
    const v = valor.trim(); setEditId(null);
    if (!v) { emitir(removeItem(itensRef.current, id)); return; }
    const r = replaceItem(itensRef.current, id, v);
    if (r.dup) { flashToast("warn", "já na lista"); return; }
    emitir(r.itens);
  };

  useEffect(() => {
    let parar = false, timer: ReturnType<typeof setTimeout> | null = null, rvfcId = 0, inFlight = false;
    let stream: MediaStream | null = null, reabrindo = false;
    let det: Detector | null = null;
    // HUD de medição: ?scandebug=1 na URL (fácil no celular, onde não há console) ou localStorage scan_debug=1
    let debugAtivo = false;
    try { debugAtivo = /[?&]scandebug=1/.test(location.search) || localStorage.getItem("scan_debug") === "1"; } catch { /* sem storage */ }

    const gate = criarGateNitidez({ limiar: LIMIAR_NITIDEZ, refocoApos: BORRADOS_REFOCO, forcarApos: BORRADOS_FORCA });
    const escalonador = criarEscalonador();
    const msDecode = criarMediaMovel(30);
    const lumaMedia = criarMediaMovel(10);
    const expo = { caps: null as { min: number; max: number; step: number } | null, atual: 0, ultimoAjuste: 0 };
    let frames = 0, decodes = 0, ultimoHud = 0;

    // para SÓ o stream deste effect e limpa trackRef apenas se a track era NOSSA (StrictMode monta 2x: o 1º effect
    // pode morrer tarde e não pode anular a track que o 2º acabou de abrir).
    const pararStream = () => {
      const tracks = stream ? stream.getTracks() : [];
      try { tracks.forEach((t) => t.stop()); } catch { /* já parado */ }
      if (trackRef.current && tracks.includes(trackRef.current)) trackRef.current = null;
      stream = null;
    };

    const configurarTrack = async (track: MediaStreamTrack) => {
      try {
        const caps = capsDe(track);
        const adv: Record<string, unknown>[] = [];
        if (Array.isArray(caps.focusMode)) { setHasFocusCtl(true); if (caps.focusMode.includes("continuous")) adv.push({ focusMode: "continuous" }); }
        if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) adv.push({ exposureMode: "continuous" });
        if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) adv.push({ whiteBalanceMode: "continuous" });
        if (adv.length) { try { await aplicarAvancado(track, ...adv); } catch { /* algum modo indisponível */ } }
        setHasTorch(!!caps.torch); setTorch(false);   // track novo nasce com a lanterna apagada
        const ec = caps.exposureCompensation;
        if (ec && typeof ec.min === "number" && typeof ec.max === "number") {
          expo.caps = { min: ec.min, max: ec.max, step: typeof ec.step === "number" ? ec.step : 0 };
          const s = (track.getSettings ? track.getSettings() : {}) as { exposureCompensation?: number };
          expo.atual = typeof s.exposureCompensation === "number" ? s.exposureCompensation : 0;
        } else expo.caps = null;
        if (caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max) {
          const z0 = Math.max(caps.zoom.min || 1, Math.min(2, caps.zoom.max));
          setZoomCaps({ min: caps.zoom.min || 1, max: caps.zoom.max, step: caps.zoom.step || 0.1 }); setZoom(z0);
          try { await aplicarAvancado(track, { zoom: z0 }); } catch { /* sem zoom */ }
        }
      } catch { /* sem capabilities */ }
    };

    // abre (ou REABRE) a câmera — usada no mount e na recuperação pós-background/track morto.
    const abrirCamera = async (): Promise<boolean> => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
        if (parar) { s.getTracks().forEach((t) => t.stop()); return false; }
        pararStream();
        stream = s;
        const v = videoRef.current;
        if (!v) { pararStream(); return false; }
        v.srcObject = s;
        try { await v.play(); } catch { /* autoplay bloqueado — o gesto de abrir o modal costuma destravar */ }
        const track = s.getVideoTracks()[0];
        if (track) {
          trackRef.current = track;
          track.onended = onTrackEnded;
          await configurarTrack(track);
        }
        setErro("");
        return true;
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const m = String((err && (err.name + " " + err.message)) || e);
        setErro(/permission|denied|notallowed|notfound|notreadable/i.test(m)
          ? "Câmera bloqueada ou indisponível — libere a permissão de câmera no navegador e tente de novo."
          : "Não consegui abrir a câmera: " + (err?.message || m));
        return false;
      }
    };

    // a câmera morreu (outro app tomou, OS suspendeu a track) → tenta reabrir 1x em silêncio antes de pedir socorro.
    const onTrackEnded = () => {
      if (parar || reabrindo) return;
      reabrindo = true;
      void abrirCamera().then((ok) => {
        reabrindo = false;
        if (!ok && !parar) setErro("A câmera parou — feche e abra de novo.");
      });
    };

    // voltou do background: retoma o áudio (iOS suspende), dá play no vídeo pausado e reabre a track se ela morreu.
    const onVisibilidade = () => {
      if (parar || document.visibilityState !== "visible") return;
      try { void audioRef.current?.resume?.(); } catch { /* sem áudio */ }
      const t = trackRef.current;
      if (!t || t.readyState === "ended") { onTrackEnded(); return; }
      const v = videoRef.current;
      if (v && v.paused) v.play().catch(() => { /* volta no próximo gesto */ });
    };
    document.addEventListener("visibilitychange", onVisibilidade);

    // compensação de exposição adaptativa (Android expõe a capability; iOS não): decide no motor puro, aplica com
    // throttle pra não brigar com o auto-exposure do device; se o device recusar, desliga o ajuste de vez.
    const ajustarExposicao = (media: number) => {
      const t = trackRef.current;
      if (!t || !expo.caps) return;
      const agora = Date.now();
      if (agora - expo.ultimoAjuste < 800) return;
      const alvo = decidirExposicao(media, expo.atual, expo.caps);
      if (alvo === null) return;
      expo.ultimoAjuste = agora; expo.atual = alvo;
      aplicarAvancado(t, { exposureCompensation: alvo }).catch(() => { expo.caps = null; });
    };

    (async () => {
      // detector (import dinâmico + warm-up do WASM) e permissão de câmera em PARALELO — 1ª leitura mais rápida.
      const [d, okCam] = await Promise.all([criarDetector(), abrirCamera()]);
      if (parar) { pararStream(); return; }
      det = d; setFonte(d.fonte);
      if (!okCam) return;   // erro já exibido pelo abrirCamera
      const v = videoRef.current;
      if (!v) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const vRVFC = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void };
      const usarRVFC = typeof vRVFC.requestVideoFrameCallback === "function";

      const processar = async () => {
        if (parar || inFlight || !det) return;
        const vd = videoRef.current;
        if (!vd || !vd.videoWidth || vd.paused || vd.readyState < 2) return;
        inFlight = true;
        try {
          const crop = calcularCrop(vd.videoWidth, vd.videoHeight, vd.clientWidth || vd.videoWidth, vd.clientHeight || vd.videoHeight);
          if (crop && crop.sw > 0 && crop.sh > 0) {
            frames++;
            const modo: ModoDecode = det.fonte === "wasm" ? escalonador.modo() : "rapido";
            // WASM escala com pixels → crop menor por padrão; o frame "caprichado" investe em mais resolução também.
            const larguraMax = det.fonte === "nativo" || modo === "caprichado" ? 1024 : 720;
            const destW = Math.min(Math.round(crop.sw), larguraMax);
            const destH = Math.max(2, Math.round(crop.sh * destW / crop.sw));
            if (canvas.width !== destW || canvas.height !== destH) { canvas.width = destW; canvas.height = destH; }
            ctx.drawImage(vd, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, destW, destH);
            const img = ctx.getImageData(0, 0, destW, destH);
            const { nitidez: nit, media } = medirFrame(img.data, destW, destH);
            lumaMedia.add(media);
            const gd = gate.decidir(nit);
            if (gd.refocar) void reKickFoco();
            if (gd.decodificar) {
              decodes++;
              const t0 = performance.now();
              let codes: string[] = [];
              try { codes = await det.detectar(canvas, img, modo); } catch { codes = []; }
              msDecode.add(performance.now() - t0);
              if (det.fonte === "wasm") escalonador.registrar(codes.some(Boolean));
              if (!parar) {
                const aceitos = consensoRef.current.registrar(codes, Date.now());
                for (const code of aceitos) aceitar(code);
              }
            }
            ajustarExposicao(lumaMedia.media());
            if (debugAtivo) {
              const agora = performance.now();
              if (agora - ultimoHud > 500) {
                ultimoHud = agora;
                const pulados = frames ? Math.round(100 * (frames - decodes) / frames) : 0;
                setDebug(`${det.fonte}${modo === "caprichado" ? "+" : ""} ${msDecode.media().toFixed(0)}ms nit ${nit.toFixed(0)} luz ${media.toFixed(0)} gate ${pulados}%`);
              }
            }
          }
        } catch { /* frame ruim */ }
        inFlight = false;
      };
      // loop = requestVideoFrameCallback (decodifica só frame NOVO; pausa em background) com fallback setTimeout.
      const loop = () => {
        if (parar) return;
        void processar();
        if (usarRVFC) rvfcId = vRVFC.requestVideoFrameCallback!(loop);
        else timer = setTimeout(loop, 55);
      };
      loop();
    })();

    return () => {
      parar = true;
      document.removeEventListener("visibilitychange", onVisibilidade);
      if (timer) clearTimeout(timer);
      const v = videoRef.current as (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }) | null;
      try { if (rvfcId && v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(rvfcId); } catch { /* ok */ }
      pararStream();
      if (v) v.srcObject = null;
      try { audioRef.current?.close(); } catch { /* já fechado */ }
      audioRef.current = null;   // StrictMode remonta → destravarAudio recria em vez de reusar um contexto fechado
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = itens.length;
  return (
    <div className="modal-bg" onClick={onClose} onPointerDown={destravarAudio}>
      <div className="modal modal-scan" data-vazio={n ? "0" : "1"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{titulo}</div>
            <div className="modal-sub">alinhe na linha{hasFocusCtl ? " · toque pra focar" : ""}{fonte ? ` · ${fonte}` : ""}</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="fechar"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          {erro ? <div className="pesq-guard" role="alert"><Icon name="alert" size={14} verticalAlign="-0.15em" /> {erro}</div> : (
            <>
              <div className="scan-view">
                <video ref={videoRef} muted playsInline autoPlay title="câmera" onPointerDown={aoTocarVideo} />
                <div className="scan-band" />
                <div className="aimer"><i className="tl" /><i className="tr" /><i className="bl" /><i className="br" /></div>
                <div className={`scan-line${trocandoId ? " trocando" : ""}`} />
                {flashKey > 0 && <div key={flashKey} className="scan-flash" />}
                {toast && <div className={`scan-toast ${toast.tipo}`}>{toast.msg}</div>}
                {debug && <div className="scan-debug">{debug}</div>}
                {hasTorch && <button className="btn btn-mini scan-torch" onClick={toggleTorch} title="Lanterna"><Icon name="bulb" size={14} verticalAlign="-0.15em" /> {torch ? "Luz on" : "Luz"}</button>}
                {trocandoId && (
                  <div className="scan-modo">
                    <span><Icon name="refresh" size={13} verticalAlign="-0.15em" /> Trocando <b>{itens.find((it) => it.id === trocandoId)?.code || ""}</b> — bipe o novo</span>
                    <button type="button" className="scan-modo-x" onClick={() => setTrocandoId(null)}>Cancelar</button>
                  </div>
                )}
              </div>
              {zoomCaps && (
                <div className="scan-ctl">
                  <Icon name="zoom-in" size={14} color="var(--muted)" />
                  <span className="scan-ctl-lbl">Zoom</span>
                  <input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step} value={zoom} onChange={(e) => onZoom(Number(e.target.value))} aria-label="zoom" />
                </div>
              )}
              {/* SEQUÊNCIA de bipagem (ordem de bipagem; auto-rola pro último) */}
              <div className="scan-seq">
                <div className="scan-seq-head">
                  <span>Bipados ({n})</span>
                  <span className="scan-seq-acts-head">
                    {/* Copiar: manda os códigos um-por-linha pro clipboard (colar na planilha no desktop). Reusa .scan-seq-undo. */}
                    <button type="button" className="scan-seq-undo" onClick={copiar} disabled={!n}>
                      <Icon name={copiado ? "check" : "copy"} size={13} verticalAlign="-0.15em" /> {copiado ? "Copiado" : "Copiar"}
                    </button>
                    <button type="button" className="scan-seq-undo" onClick={desfazer} disabled={!n}><Icon name="eraser" size={13} verticalAlign="-0.15em" /> Desfazer</button>
                  </span>
                </div>
                {n === 0 ? (
                  <div className="scan-seq-empty">Aponte a câmera na etiqueta — o código aparece aqui.</div>
                ) : (
                  <div className="scan-seq-list" ref={listRef}>
                    {itens.map((it, i) => (
                      <div key={it.id} className={`scan-seq-item${it.ok ? "" : " bad"}${trocandoId === it.id ? " sel" : ""}`}>
                        <span className="scan-seq-n"># {i + 1}</span>
                        {it.ok ? null : <Icon name="alert" size={14} verticalAlign="-0.15em" />}
                        {editId === it.id ? (
                          <input
                            className="scan-seq-edit mono" defaultValue={it.code} autoFocus inputMode="text"
                            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                            onKeyDown={(e) => { if (e.key === "Enter") confirmarEdicao(it.id, (e.target as HTMLInputElement).value); if (e.key === "Escape") setEditId(null); }}
                            onBlur={(e) => confirmarEdicao(it.id, e.target.value)}
                          />
                        ) : (
                          <span className="scan-seq-code mono">{it.code}{statusDe && statusDe(it.code) ? <span className="scan-seq-status"> · {statusDe(it.code)}</span> : null}</span>
                        )}
                        <span className="scan-seq-acts">
                          <button type="button" title="Trocar por bipe" aria-label="trocar por bipe" onClick={() => iniciarTroca(it.id)}><Icon name="refresh" size={14} /></button>
                          <button type="button" title="Editar" aria-label="editar" onClick={() => { setTrocandoId(null); setEditId(it.id); }}><Icon name="pencil" size={14} /></button>
                          <button type="button" title="Remover" aria-label="remover" onClick={() => removerItem(it.id)}><Icon name="x" size={14} /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="scan-foot">
            <button className="btn btn-primary" onClick={onClose}><Icon name="check" size={14} verticalAlign="-0.15em" /> Usar {n} código{n === 1 ? "" : "s"}</button>
            <span className="sub">bipe em sequência · toque num item p/ trocar ou editar</span>
          </div>
        </div>
      </div>
    </div>
  );
}
