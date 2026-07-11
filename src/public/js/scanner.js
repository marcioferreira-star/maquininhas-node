/* scanner.js — Leitor de código de barras pela CÂMERA ("Bipe") para o Envio/Retorno.
 * Port VANILLA (sem bundler/React) do scanner V2 da Torre:
 *   - motor puro de torre/packages/ui/src/scanner-engine.ts (consenso, crop, nitidez,
 *     gate, escalonador, exposição adaptativa) — portado verbatim;
 *   - camada câmera/DOM/loop de torre/packages/ui/src/BarcodeScanner.tsx.
 * Engine HÍBRIDA: BarcodeDetector NATIVO (Chrome Android = ML Kit) → zxing-wasm DIRETO
 * (iOS Safari/Firefox, via o IIFE window.ZXingWASM em /vendor/zxing/).
 * API: ScannerBipe.abrir({ onLeu, titulo }). onLeu(code) devolve 'ok'|'dup'|'notfound'
 * (o Envio decide via biparSerial); o scanner dá o feedback (beep/vibra/toast/flash).
 * Requer HTTPS (getUserMedia) — em prod a Vercel é HTTPS; local via http://localhost.
 */
(function () {
  "use strict";

  /* ==================================================================== */
  /* ENGINE PURO (port de scanner-engine.ts)                              */
  /* ==================================================================== */
  var FORMATOS = ["code_128", "code_39", "code_93", "itf", "qr_code"];
  var FORMATOS_ZXING = { code_128: "Code128", code_39: "Code39", code_93: "Code93", itf: "ITF", qr_code: "QRCode" };
  var CONFIRMA = 2, JANELA_MS = 700, COOLDOWN_MS = 1500;
  var BANDA_TOPO = 0.39, BANDA_ALTURA = 0.22;   // espelham .scan-band { top / height } no CSS
  var LIMIAR_NITIDEZ = 25, BORRADOS_REFOCO = 8, BORRADOS_FORCA = 30;

  // "isso é serial/patrimônio de maquininha?" — regra validada no banco Meep (~101k máq). Mantida EXATA.
  function ehSerialDeMaquina(code) {
    var s = (code || "").trim().toUpperCase();
    if (!s) return false;
    if (/[\s/:.?=@]/.test(s)) return false;                  // sem espaço/barra/:/./?/=/@ → mata QR-URL/token
    if (/^[A-Z]{2,6}[0-9]{1,7}$/.test(s)) return true;       // patrimônio
    if (/^(?=.*[A-Z])[0-9A-Z]{8,16}$/.test(s)) return true;  // serial alfanumérico (tem letra) — PBA... passa
    if (/^([0-9]{10}|[0-9]{16})$/.test(s)) return true;      // serial numérico: Moderninha (10), GPOS/GetNet/MP (16)
    return false;                                            // exclui 13 (EAN), 14 (ITF-14), 15 (IMEI)
  }

  // consenso multi-frame + cooldown (anti-falso-positivo). registrar(codes, now) → códigos ACEITOS.
  function criarConsenso() {
    var votos = new Map(), cooldown = new Map();
    return {
      registrar: function (codes, now) {
        var aceitos = [];
        (codes || []).forEach(function (raw) {
          var code = String(raw || "").trim();
          if (!code) return;
          var cd = cooldown.get(code);
          if (cd !== undefined && now - cd < COOLDOWN_MS) { cooldown.set(code, now); return; }
          var v0 = votos.get(code);
          var n = v0 && now - v0.last <= JANELA_MS ? v0.n + 1 : 1;
          votos.set(code, { n: n, last: now });
          if (n >= CONFIRMA) { votos.delete(code); cooldown.set(code, now); aceitos.push(code); }
        });
        votos.forEach(function (v, k) { if (now - v.last > JANELA_MS * 3) votos.delete(k); });
        return aceitos;
      },
      reset: function () { votos.clear(); cooldown.clear(); }
    };
  }

  // recorte da banda central desfazendo o object-fit: cover (o que o usuário vê ≠ fração do frame cru).
  function calcularCrop(vw, vh, cw, ch) {
    if (!vw || !vh || !cw || !ch) return null;
    var scale = Math.max(cw / vw, ch / vh);
    var visW = Math.min(vw, cw / scale), visH = Math.min(vh, ch / scale);
    var offX = (vw - visW) / 2, offY = (vh - visH) / 2;
    return { sx: offX, sy: offY + visH * BANDA_TOPO, sw: visW, sh: visH * BANDA_ALTURA };
  }

  // nitidez (variância do Laplaciano) + luma médio, uma passada (canal R subamostrado).
  function medirFrame(data, w, h, step) {
    step = step || 8;
    var sum = 0, sum2 = 0, soma = 0, n = 0, row = w * 4;
    for (var y = step; y < h - step; y += step) {
      for (var x = step; x < w - step; x += step) {
        var i = (y * w + x) * 4, c = data[i];
        var lap = 4 * c - data[i - 4] - data[i + 4] - data[i - row] - data[i + row];
        sum += lap; sum2 += lap * lap; soma += c; n++;
      }
    }
    if (n < 2) return { nitidez: 0, media: 0 };
    var mean = sum / n;
    return { nitidez: sum2 / n - mean * mean, media: soma / n };
  }

  // gate de nitidez com re-foco e anti-inanição (nunca trava a leitura pra sempre).
  function criarGateNitidez() {
    var borrados = 0, bloqueados = 0;
    return {
      decidir: function (nit) {
        if (nit >= LIMIAR_NITIDEZ) { borrados = 0; bloqueados = 0; return { decodificar: true, refocar: false }; }
        borrados++; bloqueados++;
        var refocar = borrados >= BORRADOS_REFOCO;
        if (refocar) borrados = 0;
        if (bloqueados >= BORRADOS_FORCA) { bloqueados = 0; return { decodificar: true, refocar: refocar }; }
        return { decodificar: false, refocar: refocar };
      },
      reset: function () { borrados = 0; bloqueados = 0; }
    };
  }

  // escalonador de esforço: rápido por padrão; "caprichado" (tryHarder/rotate/invert) sob demanda após N falhas.
  function criarEscalonador() {
    var aposFalhas = 12, periodo = 4, falhas = 0;
    return {
      modo: function () { return falhas >= aposFalhas && (falhas - aposFalhas) % periodo === 0 ? "caprichado" : "rapido"; },
      registrar: function (achou) { falhas = achou ? 0 : falhas + 1; },
      reset: function () { falhas = 0; }
    };
  }

  // exposição adaptativa: etiqueta laminada estoura o branco → baixa ~0.5EV; voltou ao escuro → sobe rumo a 0.
  function decidirExposicao(media, atual, caps) {
    var passo = caps.step > 0 ? caps.step : 0.5;
    var salto = Math.max(passo, Math.round(0.5 / passo) * passo);
    var teto = Math.min(caps.max, 0), EPS = 1e-6;
    if (media > 200) { var a = Math.max(caps.min, Math.min(teto, atual - salto)); return a < atual - EPS ? a : null; }
    if (media < 110 && atual < -EPS) { var b = Math.max(caps.min, Math.min(teto, atual + salto)); return b > atual + EPS ? b : null; }
    return null;
  }

  function criarMediaMovel(janela) {
    janela = janela || 30; var buf = [];
    return {
      add: function (v) { buf.push(v); if (buf.length > janela) buf.shift(); },
      media: function () { return buf.length ? buf.reduce(function (a, b) { return a + b; }, 0) / buf.length : 0; }
    };
  }

  function pontoRelativo(cx, cy, rect) {
    var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    return { x: clamp((cx - rect.left) / (rect.width || 1)), y: clamp((cy - rect.top) / (rect.height || 1)) };
  }

  /* ==================================================================== */
  /* DETECTOR HÍBRIDO (nativo → zxing-wasm IIFE)                          */
  /* ==================================================================== */
  var _zxingConfigurado = false;
  function configurarZxing() {
    if (_zxingConfigurado || typeof window.ZXingWASM === "undefined") return;
    _zxingConfigurado = true;
    try {
      window.ZXingWASM.setZXingModuleOverrides({
        locateFile: function (path, prefix) { return /\.wasm$/.test(path) ? "/vendor/zxing/zxing_reader.wasm" : prefix + path; }
      });
      // aquece o WASM em paralelo ao getUserMedia (1ª leitura mais rápida)
      if (window.ZXingWASM.prepareZXingModule) window.ZXingWASM.prepareZXingModule({ fireImmediately: true });
    } catch { /* segue */ }
  }

  async function criarDetector() {
    // 1) BarcodeDetector NATIVO — só se suportar code_128 DE FATO (Chrome Android/ML Kit)
    try {
      if (typeof window.BarcodeDetector !== "undefined") {
        var sup = await window.BarcodeDetector.getSupportedFormats();
        if (sup && sup.indexOf("code_128") >= 0) {
          var fmts = FORMATOS.filter(function (f) { return sup.indexOf(f) >= 0; });
          var det = new window.BarcodeDetector({ formats: fmts.length ? fmts : ["code_128"] });
          return {
            fonte: "nativo",
            detectar: async function (canvas) { return (await det.detect(canvas)).map(function (c) { return String((c && c.rawValue) || ""); }); }
          };
        }
      }
    } catch { /* cai no WASM */ }
    // 2) zxing-wasm DIRETO (IIFE) com ReaderOptions rápidos (defaults do ponyfill são lentos no iPhone)
    configurarZxing();
    var Z = window.ZXingWASM;
    if (!Z || !Z.readBarcodes) throw new Error("Leitor indisponível (ZXingWASM não carregou).");
    var rapido = {
      formats: FORMATOS.map(function (f) { return FORMATOS_ZXING[f]; }),
      tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: true,
      binarizer: "LocalAverage", maxNumberOfSymbols: 2, minLineCount: 2
    };
    var caprichado = Object.assign({}, rapido, { tryHarder: true, tryRotate: true, tryInvert: true });
    return {
      fonte: "wasm",
      detectar: async function (_canvas, img, modo) {
        return (await Z.readBarcodes(img, modo === "caprichado" ? caprichado : rapido)).map(function (r) { return r.text || ""; });
      }
    };
  }

  /* ==================================================================== */
  /* UI / CÂMERA / LOOP (port de BarcodeScanner.tsx)                      */
  /* ==================================================================== */
  var vibrar = function (p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch {} };
  var capsDe = function (t) { try { return t.getCapabilities ? t.getCapabilities() : {}; } catch { return {}; } };
  var aplicarAv = function (t) { var c = [].slice.call(arguments, 1); return t.applyConstraints({ advanced: c }); };

  var _aberto = null;   // handle do modal aberto (só um por vez)

  function abrir(opts) {
    opts = opts || {};
    if (_aberto) return;                    // já tem um scanner aberto
    var onLeu = typeof opts.onLeu === "function" ? opts.onLeu : function () { return "ok"; };
    var titulo = opts.titulo || "Bipar máquina";

    /* ---- DOM (dialog + câmera + mira + lista) ---- */
    var dlg = document.createElement("dialog");
    dlg.className = "dialog scan-dialog";
    dlg.style.setProperty("--scan-top", (BANDA_TOPO * 100) + "%");
    dlg.style.setProperty("--scan-h", (BANDA_ALTURA * 100) + "%");
    dlg.innerHTML =
      '<div class="scan-head">' +
        '<div><div class="scan-title"></div><div class="scan-sub">alinhe o código na linha</div></div>' +
        '<button type="button" class="scan-x" aria-label="Fechar">&times;</button>' +
      '</div>' +
      '<div class="scan-view">' +
        '<video muted playsinline autoplay></video>' +
        '<div class="scan-band"></div>' +
        '<div class="aimer"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>' +
        '<div class="scan-line"></div>' +
        '<button type="button" class="scan-torch" hidden>Luz</button>' +
        '<div class="scan-toast" hidden></div>' +
        '<div class="scan-erro" hidden></div>' +
        '<div class="scan-debug" hidden></div>' +
      '</div>' +
      '<div class="scan-ctl" hidden><span>Zoom</span><input type="range" class="scan-zoom" aria-label="Zoom"></div>' +
      '<div class="scan-seq"><div class="scan-seq-head">Bipadas <b class="scan-seq-n">0</b></div><div class="scan-seq-list"></div></div>' +
      '<div class="scan-foot"><button type="button" class="btn btn-primary scan-usar">Concluir</button></div>';
    document.body.appendChild(dlg);

    var $ = function (sel) { return dlg.querySelector(sel); };
    $(".scan-title").textContent = titulo;
    var video = $("video");
    var elTorch = $(".scan-torch"), elToast = $(".scan-toast"), elErro = $(".scan-erro"), elDebug = $(".scan-debug");
    // HUD de medição (só no celular, onde não há console): ?scandebug=1 na URL ou localStorage scan_debug=1
    var debugAtivo = false;
    try { debugAtivo = /[?&]scandebug=1/.test(location.search) || localStorage.getItem("scan_debug") === "1"; } catch {}
    var elCtl = $(".scan-ctl"), elZoom = $(".scan-zoom"), elSeqN = $(".scan-seq-n"), elSeqList = $(".scan-seq-list");
    var bipadas = 0;

    /* ---- áudio (Web Audio; nasce suspenso → resume num gesto) ---- */
    var audio = null;
    function destravarAudio() {
      try {
        if (!audio || audio.state === "closed") { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); }
        if (audio && audio.resume) audio.resume();
      } catch {}
    }
    function tom(tipo) {
      if (!audio) return;
      try {
        if (audio.state === "suspended" && audio.resume) audio.resume();
        var t = audio.currentTime;
        var nota = function (freq, dt, dur, wave, gain) {
          var o = audio.createOscillator(), g = audio.createGain();
          o.type = wave; o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
          g.gain.setValueAtTime(gain, t + dt); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
          o.start(t + dt); o.stop(t + dt + dur + 0.01);
        };
        if (tipo === "ok") nota(1180, 0, 0.12, "square", 0.08);
        else if (tipo === "dup") nota(360, 0, 0.18, "sine", 0.07);
        else { nota(660, 0, 0.13, "sawtooth", 0.07); nota(440, 0.14, 0.13, "sawtooth", 0.07); }
      } catch {}
    }
    var toastTimer = null;
    function toast(tipo, msg) {
      elToast.textContent = msg; elToast.className = "scan-toast " + tipo; elToast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { elToast.hidden = true; }, 1500);
    }
    function flash() { video.classList.remove("scan-flash"); void video.offsetWidth; video.classList.add("scan-flash"); }

    /* ---- estado do loop ---- */
    var parar = false, timer = null, rvfcId = 0, inFlight = false;
    var stream = null, track = null, reabrindo = false, det = null;
    var consenso = criarConsenso(), gate = criarGateNitidez(), escal = criarEscalonador(), lumaMedia = criarMediaMovel(10);
    var msDecode = criarMediaMovel(30), frames = 0, decodes = 0, ultimoHud = 0;   // instrumentação do HUD
    var expo = { caps: null, atual: 0, ultimo: 0 };
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });

    /* ---- código aceito (pós-consenso) → decide feedback ---- */
    function aceitar(code) {
      var norm = String(code || "").trim();
      if (!ehSerialDeMaquina(norm)) { tom("alerta"); vibrar([70, 50, 130]); toast("erro", "não parece serial: " + norm); return; }
      var res;
      try { res = onLeu(norm); } catch { res = "ok"; }
      if (res === "dup") { tom("dup"); vibrar([35, 45, 35]); toast("warn", norm + " já na lista"); return; }
      if (res === "notfound") { tom("alerta"); vibrar([70, 50, 130]); toast("erro", norm + " não cadastrado"); return; }
      // ok
      tom("ok"); vibrar(60); flash();
      bipadas++; elSeqN.textContent = String(bipadas);
      var row = document.createElement("div"); row.className = "scan-seq-item"; row.textContent = norm;
      elSeqList.appendChild(row); elSeqList.scrollTop = elSeqList.scrollHeight;
      toast("ok", norm + " ✓");
    }

    /* ---- foco ---- */
    async function reKickFoco(poi) {
      if (!track) return;
      try {
        var caps = capsDe(track);
        if (Array.isArray(caps.focusMode) && caps.focusMode.indexOf("single-shot") >= 0) {
          var adv = { focusMode: "single-shot" };
          if (poi && caps.pointsOfInterest) adv.pointsOfInterest = [poi];
          await aplicarAv(track, adv);
          setTimeout(function () { aplicarAv(track, { focusMode: "continuous" }).catch(function () {}); }, 900);
        } else if (Array.isArray(caps.focusMode) && caps.focusMode.indexOf("continuous") >= 0) {
          await aplicarAv(track, { focusMode: "manual" }).catch(function () {});
          await aplicarAv(track, { focusMode: "continuous" });
        }
      } catch {}
    }
    function aoTocarVideo(e) {
      destravarAudio(); flash();
      var r = video.getBoundingClientRect();
      reKickFoco(pontoRelativo(e.clientX, e.clientY, r));
    }

    /* ---- câmera ---- */
    function pararStream() {
      var tr = stream ? stream.getTracks() : [];
      try { tr.forEach(function (t) { t.stop(); }); } catch {}
      if (track && tr.indexOf(track) >= 0) track = null;
      stream = null;
    }
    async function configurarTrack(tk) {
      try {
        var caps = capsDe(tk), adv = [];
        if (Array.isArray(caps.focusMode) && caps.focusMode.indexOf("continuous") >= 0) adv.push({ focusMode: "continuous" });
        if (Array.isArray(caps.exposureMode) && caps.exposureMode.indexOf("continuous") >= 0) adv.push({ exposureMode: "continuous" });
        if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.indexOf("continuous") >= 0) adv.push({ whiteBalanceMode: "continuous" });
        if (adv.length) { try { await tk.applyConstraints({ advanced: adv }); } catch {} }
        if (caps.torch) { elTorch.hidden = false; elTorch.textContent = "Luz"; }
        var ec = caps.exposureCompensation;
        if (ec && typeof ec.min === "number" && typeof ec.max === "number") {
          expo.caps = { min: ec.min, max: ec.max, step: typeof ec.step === "number" ? ec.step : 0 };
          var s = tk.getSettings ? tk.getSettings() : {};
          expo.atual = typeof s.exposureCompensation === "number" ? s.exposureCompensation : 0;
        } else expo.caps = null;
        if (caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max) {
          var z0 = Math.max(caps.zoom.min || 1, Math.min(2, caps.zoom.max));
          elCtl.hidden = false; elZoom.min = caps.zoom.min || 1; elZoom.max = caps.zoom.max; elZoom.step = caps.zoom.step || 0.1; elZoom.value = z0;
          try { await aplicarAv(tk, { zoom: z0 }); } catch {}
        }
      } catch {}
    }
    async function abrirCamera() {
      try {
        var s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
        if (parar) { s.getTracks().forEach(function (t) { t.stop(); }); return false; }
        pararStream(); stream = s; video.srcObject = s;
        try { await video.play(); } catch {}
        var tk = s.getVideoTracks()[0];
        if (tk) { track = tk; tk.onended = onTrackEnded; await configurarTrack(tk); }
        elErro.hidden = true; return true;
      } catch (e) {
        var m = String((e && (e.name + " " + e.message)) || e);
        elErro.textContent = /permission|denied|notallowed|notfound|notreadable/i.test(m)
          ? "Câmera bloqueada ou indisponível — libere a permissão de câmera e tente de novo."
          : "Não consegui abrir a câmera: " + ((e && e.message) || m);
        elErro.hidden = false; return false;
      }
    }
    function onTrackEnded() {
      if (parar || reabrindo) return;
      reabrindo = true;
      abrirCamera().then(function (ok) { reabrindo = false; if (!ok && !parar) { elErro.textContent = "A câmera parou — feche e abra de novo."; elErro.hidden = false; } });
    }
    function onVisibilidade() {
      if (parar || document.visibilityState !== "visible") return;
      try { if (audio && audio.resume) audio.resume(); } catch {}
      if (!track || track.readyState === "ended") { onTrackEnded(); return; }
      if (video.paused) video.play().catch(function () {});
    }
    document.addEventListener("visibilitychange", onVisibilidade);

    function ajustarExposicao(media) {
      if (!track || !expo.caps) return;
      var agora = Date.now();
      if (agora - expo.ultimo < 800) return;
      var alvo = decidirExposicao(media, expo.atual, expo.caps);
      if (alvo === null) return;
      expo.ultimo = agora; expo.atual = alvo;
      aplicarAv(track, { exposureCompensation: alvo }).catch(function () { expo.caps = null; });
    }

    /* ---- loop de decodificação ---- */
    async function processar() {
      if (parar || inFlight || !det) return;
      if (!video.videoWidth || video.paused || video.readyState < 2) return;
      inFlight = true;
      try {
        var crop = calcularCrop(video.videoWidth, video.videoHeight, video.clientWidth || video.videoWidth, video.clientHeight || video.videoHeight);
        if (crop && crop.sw > 0 && crop.sh > 0) {
          frames++;
          var modo = det.fonte === "wasm" ? escal.modo() : "rapido";
          var larguraMax = det.fonte === "nativo" || modo === "caprichado" ? 1024 : 720;
          var destW = Math.min(Math.round(crop.sw), larguraMax);
          var destH = Math.max(2, Math.round(crop.sh * destW / crop.sw));
          if (canvas.width !== destW || canvas.height !== destH) { canvas.width = destW; canvas.height = destH; }
          ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, destW, destH);
          var img = ctx.getImageData(0, 0, destW, destH);
          var m = medirFrame(img.data, destW, destH);
          lumaMedia.add(m.media);
          var gd = gate.decidir(m.nitidez);
          if (gd.refocar) reKickFoco();
          if (gd.decodificar) {
            decodes++;
            var t0 = performance.now();
            var codes = [];
            try { codes = await det.detectar(canvas, img, modo); } catch { codes = []; }
            msDecode.add(performance.now() - t0);
            if (det.fonte === "wasm") escal.registrar(codes.some(Boolean));
            if (!parar) {
              var aceitos = consenso.registrar(codes, Date.now());
              for (var i = 0; i < aceitos.length; i++) aceitar(aceitos[i]);
            }
          }
          ajustarExposicao(lumaMedia.media());
          if (debugAtivo) {
            var ag = performance.now();
            if (ag - ultimoHud > 500) {
              ultimoHud = ag;
              var pulados = frames ? Math.round(100 * (frames - decodes) / frames) : 0;
              elDebug.hidden = false;
              elDebug.textContent = det.fonte + (modo === "caprichado" ? "+" : "") + " " + msDecode.media().toFixed(0) + "ms · nit " + m.nitidez.toFixed(0) + " · luz " + m.media.toFixed(0) + " · gate " + pulados + "%";
            }
          }
        }
      } catch {}
      inFlight = false;
    }
    var usarRVFC = typeof video.requestVideoFrameCallback === "function";
    function loop() {
      if (parar) return;
      processar();
      if (usarRVFC) rvfcId = video.requestVideoFrameCallback(loop);
      else timer = setTimeout(loop, 55);
    }

    /* ---- torch/zoom ---- */
    var torchOn = false;
    elTorch.addEventListener("click", function () {
      if (!track) return; var v = !torchOn;
      aplicarAv(track, { torch: v }).then(function () { torchOn = v; elTorch.textContent = v ? "Luz on" : "Luz"; elTorch.classList.toggle("on", v); }).catch(function () {});
    });
    elZoom.addEventListener("input", function () { if (track) aplicarAv(track, { zoom: Number(elZoom.value) }).catch(function () {}); });

    /* ---- teardown (fonte única: evento close do dialog) ---- */
    function teardown() {
      parar = true;
      document.removeEventListener("visibilitychange", onVisibilidade);
      if (timer) clearTimeout(timer);
      try { if (rvfcId && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rvfcId); } catch {}
      pararStream();
      try { video.srcObject = null; } catch {}
      try { if (audio) audio.close(); } catch {}
      audio = null;
      if (toastTimer) clearTimeout(toastTimer);
    }
    dlg.addEventListener("close", function () { teardown(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); _aberto = null; });
    function fechar() { try { dlg.close(); } catch { teardown(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); _aberto = null; } }

    $(".scan-x").addEventListener("click", fechar);
    $(".scan-usar").addEventListener("click", fechar);
    dlg.addEventListener("pointerdown", destravarAudio, { once: false });
    video.addEventListener("pointerdown", aoTocarVideo);

    _aberto = { fechar: fechar };
    dlg.showModal();
    destravarAudio();

    /* ---- boot: detector + câmera em paralelo, depois o loop ---- */
    Promise.all([criarDetector().catch(function (e) { elErro.textContent = String(e.message || e); elErro.hidden = false; return null; }), abrirCamera()])
      .then(function (r) {
        if (parar) { pararStream(); return; }
        det = r[0];
        if (det) $(".scan-sub").textContent = "alinhe na linha · " + det.fonte;
        if (!det || !r[1]) return;
        loop();
      });
  }

  function fechar() { if (_aberto) _aberto.fechar(); }

  window.ScannerBipe = {
    abrir: abrir,
    fechar: fechar,
    ehSerialDeMaquina: ehSerialDeMaquina,
    disponivel: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  };
})();
