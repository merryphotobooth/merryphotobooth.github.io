/* Merry Photo Booth — Christmas edition.
   Everything runs locally. Photos live only in memory (canvases) and are never uploaded or stored. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const C = { cherry: '#8B1A1A', oxblood: '#3F0F12', cream: '#EFE9DC', silver: '#B8B8B8', pine: '#2F5B45' };
  const DATE_TEXT = '12.25.2026';
  const SCRIPT = '"Pinyon Script", "Snell Roundhand", cursive';
  const SANS = 'Jost, Futura, "Helvetica Neue", Arial, sans-serif';

  const screens = {
    start: $('#screen-start'), shoot: $('#screen-shoot'),
    delivery: $('#screen-delivery'), custom: $('#screen-custom'),
  };
  const video = $('#video');
  const demoCanvas = $('#demo-canvas');

  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('active', k === name);
  }

  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------------- sound (generated, soft) ---------------- */
  let ac = null;
  function initAudio() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
    } catch { ac = null; }
  }
  function tone(freq, dur, vol, type = 'sine', at = 0) {
    if (!ac) return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(at, dur, freq, vol, type = 'bandpass') {
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = 0.7; g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(ac.currentTime + at);
  }
  const tick = (last) => tone(last ? 880 : 660, 0.18, 0.08);
  function shutter() { noise(0, 0.05, 3000, 0.7); noise(0.07, 0.08, 1700, 0.5); noise(0.09, 0.3, 500, 0.18); }
  function motor(dur) {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55;
    f.type = 'lowpass'; f.frequency.value = 300;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.4);
    g.gain.setValueAtTime(0.035, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const drop = () => { tone(110, 0.25, 0.12); noise(0, 0.12, 700, 0.15, 'lowpass'); };

  /* ---------------- camera ---------------- */
  let stream = null, demo = false, demoPose = 0, demoRAF = 0;

  function cameraErrorMessage(e) {
    if (!window.isSecureContext) return 'The camera needs a secure connection. Open this page over https or on localhost.';
    switch (e && e.name) {
      case 'NotAllowedError':
      case 'SecurityError': return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.';
      case 'NotFoundError':
      case 'OverconstrainedError': return 'No camera was found on this device.';
      case 'NotReadableError': return 'Your camera is busy in another app. Close it and try again.';
      default: return "We couldn't open the camera.";
    }
  }
  function showCameraError(msg) { $('#error-msg').textContent = msg; $('#camera-error').hidden = false; }

  async function startCamera() {
    $('#camera-error').hidden = true;
    video.hidden = demo;
    demoCanvas.hidden = !demo;
    if (demo) { startDemo(); return true; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showCameraError(cameraErrorMessage()); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } }, audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      await new Promise((res) => {
        if (video.readyState >= 2 && video.videoWidth) return res();
        video.addEventListener('loadeddata', res, { once: true });
        setTimeout(res, 3000);
      });
      return true;
    } catch (e) {
      showCameraError(cameraErrorMessage(e));
      return false;
    }
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    cancelAnimationFrame(demoRAF);
  }

  // A drawn stand-in so the booth can be tried without a camera (?demo or the error screen).
  function startDemo() {
    const x = demoCanvas.getContext('2d');
    const w = demoCanvas.width, h = demoCanvas.height;
    const draw = (t) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#2a2222'); g.addColorStop(0.5, '#4a3c3a'); g.addColorStop(1, '#2a2222');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 32) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i, 0, 12, h); }
      const tilt = [0, -0.12, 0.08, 0.16][demoPose];
      const cx = w / 2 + Math.sin(t / 900) * 10 + [0, -40, 30, 10][demoPose];
      const cy = h * 0.62 + Math.cos(t / 1100) * 5;
      x.save(); x.translate(cx, cy); x.rotate(tilt);
      x.fillStyle = '#e9e2d6'; x.beginPath(); x.ellipse(0, 230, 190, 120, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#d8b394'; x.beginPath(); x.arc(0, 0, 108, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a1512'; x.beginPath(); x.ellipse(0, -70, 118, 60, 0, Math.PI, Math.PI * 2); x.fill();
      x.strokeStyle = '#2a1512'; x.lineWidth = 7; x.lineCap = 'round';
      if (demoPose === 1) { x.beginPath(); x.arc(-38, -6, 10, 0, 7); x.fill(); x.beginPath(); x.moveTo(26, -6); x.lineTo(52, -6); x.stroke(); }
      else { x.beginPath(); x.arc(-38, -6, 10, 0, 7); x.arc(38, -6, 10, 0, 7); x.fill(); }
      x.beginPath();
      if (demoPose === 2) { x.ellipse(0, 44, 16, 22, 0, 0, 7); x.fill(); }
      else { x.arc(0, 26, demoPose === 3 ? 48 : 38, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); }
      x.restore();
      x.fillStyle = 'rgba(255,255,255,.6)'; x.font = `500 16px ${SANS}`; x.fillText('DEMO', 16, 30);
      demoRAF = requestAnimationFrame(draw);
    };
    cancelAnimationFrame(demoRAF);
    demoRAF = requestAnimationFrame(draw);
  }

  /* ---------------- capture ---------------- */
  const PW = 1200, PH = 960; // 5:4, 2.5x of the 480x384 layout size (matches EXPORT_SCALE)
  let shots = [];

  function capture() {
    const c = mk(PW, PH), x = c.getContext('2d');
    const src = demo ? demoCanvas : video;
    const vw = demo ? demoCanvas.width : video.videoWidth;
    const vh = demo ? demoCanvas.height : video.videoHeight;
    const ar = PW / PH;
    let sw, sh;
    if (vw / vh > ar) { sh = vh; sw = vh * ar; } else { sw = vw; sh = vw / ar; }
    x.fillStyle = '#000'; x.fillRect(0, 0, PW, PH);
    x.imageSmoothingQuality = 'high';
    if (!demo) { x.translate(PW, 0); x.scale(-1, 1); } // match the mirrored preview
    if (vw && vh) x.drawImage(src, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, PW, PH);
    x.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  /* ---------------- session ---------------- */
  let session = 0;
  const countdownEl = $('#countdown');
  const poseEl = $('#pose');
  const lens = $('#lens-light');
  const progress = () => $$('#progress li');

  const showPose = (t) => { poseEl.textContent = t; poseEl.classList.add('show'); };
  const hidePose = () => poseEl.classList.remove('show');
  function flash() { const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  function resetProgress() {
    progress().forEach((li, i) => { li.className = i === 0 ? 'current' : ''; li.style.backgroundImage = ''; });
    $('#shot-label').textContent = `Pose 1 of ${SHOTS}`;
    setCue(-1);
  }

  /* 8 poses, one per line of the song trend. Each pose: a "Pose!" pause to
     read the cue, a 3-2-1 countdown, then the shutter. */
  const SHOTS = 8;
  const COUNT_MS = 1000; // per countdown number
  const BREAK_MS = 1700; // "Pose!" pause before each shot (after the first)
  const AFTER_MS = 1100; // hold after the shutter
  const POSES = [
    'Fake a little bite — chomp!',
    'Hide behind your hands, peek out shyly',
    'Lean away, palm up like “stop”',
    'Glance back over your shoulder',
    'Point straight at the camera',
    'Tilt your head, squint — “do I know you?”',
    'Hold up one finger — one year',
    'Shrug with a knowing smirk',
  ];
  function setCue(i) {
    const cue = $('#cue');
    if (i < 0) { cue.innerHTML = '<span>8 poses · 2 strips</span>Follow the cue for each pose'; return; }
    cue.innerHTML = `<span>Pose ${i + 1}</span>${POSES[i]}`;
    cue.classList.remove('pop'); void cue.offsetWidth; cue.classList.add('pop');
  }

  async function stepInside() {
    initAudio();
    const token = ++session;
    shots = []; photoCache.clear();
    resetProgress(); hidePose();
    const opening = $('#opening');
    opening.classList.add('open');
    const camReady = startCamera(); // permission prompt appears while the curtain parts
    await sleep(2300); if (token !== session) return;
    show('shoot');
    const ok = await camReady;
    if (!ok || token !== session) return;
    await runSession(token);
  }

  async function retake() {
    initAudio();
    const token = ++session;
    shots = []; photoCache.clear();
    resetProgress(); hidePose();
    show('shoot');
    const ok = await startCamera();
    if (!ok || token !== session) return;
    await runSession(token);
  }

  async function runSession(token) {
    const alive = () => token === session;
    showPose('Ready?');
    await sleep(1800); if (!alive()) return;
    hidePose();
    await sleep(500); if (!alive()) return;

    countdownEl.style.animationDuration = COUNT_MS + 'ms';
    for (let i = 0; i < SHOTS; i++) {
      demoPose = i % 4;
      $('#shot-label').textContent = `Pose ${i + 1} of ${SHOTS}`;
      progress().forEach((li, k) => li.classList.toggle('current', k === i));
      setCue(i);
      if (i > 0) {
        showPose('Pose!');
        await sleep(BREAK_MS); if (!alive()) return;
        hidePose();
        await sleep(500); if (!alive()) return;
      }
      for (const n of [3, 2, 1]) {
        countdownEl.textContent = n;
        countdownEl.classList.remove('show'); void countdownEl.offsetWidth; countdownEl.classList.add('show');
        lens.classList.toggle('on', true);
        tick(n === 1);
        await sleep(COUNT_MS * 0.45); lens.classList.toggle('on', false);
        await sleep(COUNT_MS * 0.55); if (!alive()) return;
      }
      countdownEl.classList.remove('show');
      const shot = capture();
      shots.push(shot);
      shutter(); flash();
      const li = progress()[i];
      li.classList.remove('current'); li.classList.add('taken');
      li.style.backgroundImage = `url(${shot.toDataURL('image/jpeg', 0.5)})`;
      await sleep(AFTER_MS); if (!alive()) return;
    }
    $('#cue').innerHTML = '<span>That’s a wrap</span>Developing your two strips';
    stopCamera();
    showPose('Developing…');
    await sleep(1400); if (!alive()) return;
    hidePose();
    await showDelivery();
  }

  function leave() {
    session++;
    stopCamera(); hidePose();
    $('#opening').classList.remove('open');
    show('start');
  }

  /* ---------------- photo processing ---------------- */
  const photoCache = new Map();

  // B&W = a 1960s European booth print (silver gelatin on warm fibre paper):
  // S-curve with lifted blacks and a soft shoulder, creamy highlights,
  // clumped silver grain, a faint highlight glow and burned-in edges.
  const BW_LUT = (() => {
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let t = i / 255;
      t += (t * t * (3 - 2 * t) - t) * 0.7;
      lut[i] = 18 + t * 220; // ink black ~18, paper white ~238
    }
    return lut;
  })();
  function finishBW(c, x) {
    if (typeof x.filter === 'string') { // soft halation around highlights
      const b = mk(PW, PH), bx = b.getContext('2d');
      bx.filter = 'blur(12px)';
      bx.drawImage(c, 0, 0);
      x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.14;
      x.drawImage(b, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    }
    const e = PW * 0.04; // edge burn from the booth's print mask
    [[0, 0, e, 0], [PW, 0, PW - e, 0], [0, 0, 0, e], [0, PH, 0, PH - e]].forEach(([x0, y0, x1, y1]) => {
      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(14,10,8,.55)'); g.addColorStop(1, 'rgba(14,10,8,0)');
      x.fillStyle = g; x.fillRect(0, 0, PW, PH);
    });
  }

  function processPhoto(i, filter) {
    const key = `${i}|${filter}`;
    if (photoCache.has(key)) return photoCache.get(key);
    const c = mk(PW, PH), x = c.getContext('2d');
    x.drawImage(shots[i], 0, 0);
    const img = x.getImageData(0, 0, PW, PH), d = img.data;
    const r = rng(500 + i * 17);
    const bw = filter === 'bw';
    let clump = null, CW = 0, lo = 0, span = 255;
    if (bw) {
      // half-res noise field so the grain clumps like silver, not digital noise
      CW = Math.ceil(PW / 2);
      clump = new Float32Array(CW * Math.ceil(PH / 2));
      for (let k = 0; k < clump.length; k++) clump[k] = r() - 0.5;
      // auto-levels: webcams shoot flat, a print has real blacks and whites
      const hist = new Uint32Array(256);
      for (let p = 0; p < d.length; p += 16) hist[(0.42 * d[p] + 0.46 * d[p + 1] + 0.12 * d[p + 2]) | 0]++;
      const total = d.length / 16;
      let acc = 0, hi = 255;
      for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc > total * 0.006) { lo = k; break; } }
      acc = 0;
      for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc > total * 0.004) { hi = k; break; } }
      lo = Math.min(lo, 60); hi = Math.max(hi, 190); // never stretch a dim scene into noise
      span = Math.max(120, hi - lo);
    }
    for (let p = 0; p < d.length; p += 4) {
      let R = d[p], G = d[p + 1], B = d[p + 2];
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      if (bw) {
        // warm-filtered panchromatic mix: smooth skin, deep darks
        const m = ((0.42 * R + 0.46 * G + 0.12 * B) - lo) * 255 / span;
        const v = BW_LUT[Math.min(255, Math.max(0, Math.round(m)))];
        const t = v / 255, q = p >> 2;
        const mid = 0.55 + 0.45 * (1 - Math.abs(2 * t - 1)); // grain shows most in the mids
        const n = ((r() - 0.5) * 0.6 + clump[((q / PW / 2) | 0) * CW + (((q % PW) / 2) | 0)]) * 24 * mid;
        d[p] = v + 4 * t + n; d[p + 1] = v - 1 + n; d[p + 2] = v - 3 - 6 * t + n; // cream paper tone
        continue;
      } else if (filter === 'sepia') {
        const v = (L - 128) * 1.1 + 128;
        R = v * 1.07 + 18; G = v * 0.9 + 12; B = v * 0.68 + 6;
      } else {
        R = L + (R - L) * 0.6; G = L + (G - L) * 0.6; B = L + (B - L) * 0.6;
        R = R * 0.82 + 40; G = G * 0.8 + 34; B = B * 0.76 + 36;
      }
      const n = (r() - 0.5) * 16; // fine film grain
      d[p] = R + n; d[p + 1] = G + n; d[p + 2] = B + n;
    }
    x.putImageData(img, 0, 0);
    const v = x.createRadialGradient(PW / 2, PH / 2, PH * 0.38, PW / 2, PH / 2, PW * 0.7);
    v.addColorStop(0, 'rgba(10,5,4,0)'); v.addColorStop(1, `rgba(10,5,4,${bw ? 0.3 : 0.5})`);
    x.fillStyle = v; x.fillRect(0, 0, PW, PH);
    if (bw) finishBW(c, x);
    photoCache.set(key, c);
    return c;
  }

  /* ---------------- strip layout ---------------- */
  const W = 600, X0 = 60, PWb = 480, PHb = 384, GAP = 18;
  const FRAMES = {
    black: { top: 60, foot: 250, ink: C.cream, sub: 'rgba(239,233,220,.78)', star: C.cream, mark: 'rgba(239,233,220,.45)' },
    red:   { top: 64, foot: 250, ink: C.cherry, sub: C.cherry, star: '#9c1f1f', mark: 'rgba(139,26,26,.55)', panel: true },
    green: { top: 64, foot: 250, ink: C.cherry, sub: C.pine, star: '#9c1f1f', mark: 'rgba(47,91,69,.6)', panel: true },
    water: { top: 64, foot: 250, ink: C.cherry, sub: C.cherry, star: '#9c1f1f', mark: 'rgba(139,26,26,.55)', panel: true },
    arch:  { top: 200, foot: 296, ink: C.cherry, sub: C.cherry, star: '#9c1f1f', mark: 'rgba(139,26,26,.55)' },
  };
  const footTop = (f) => f.top + 4 * PHb + 3 * GAP;
  const stripH = (f) => footTop(f) + f.foot;

  function spaced(x, text, cx, y, spacing) {
    const chars = [...text];
    const ws = chars.map((ch) => x.measureText(ch).width);
    let px = cx - (ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1)) / 2;
    x.textAlign = 'left';
    chars.forEach((ch, i) => { x.fillText(ch, px, y); px += ws[i] + spacing; });
  }
  function rrect(x, rx, ry, w, h, r) {
    x.beginPath();
    x.moveTo(rx + r, ry);
    x.arcTo(rx + w, ry, rx + w, ry + h, r);
    x.arcTo(rx + w, ry + h, rx, ry + h, r);
    x.arcTo(rx, ry + h, rx, ry, r);
    x.arcTo(rx, ry, rx + w, ry, r);
    x.closePath();
  }
  function archPath(x, H) {
    const r = 260, cx = W / 2, top = 40, bottom = H - 40;
    x.beginPath();
    x.moveTo(cx - r, top + r);
    x.arc(cx, top + r, r, Math.PI, 0);
    x.lineTo(cx + r, bottom - r);
    x.arc(cx, bottom - r, r, 0, Math.PI);
    x.closePath();
  }
  function paperSpecks(x, H, seed, dark, n) {
    const r = rng(seed);
    for (let k = 0; k < n; k++) {
      const a = r() * 0.09;
      x.fillStyle = (r() < 0.6) === dark ? `rgba(255,250,240,${a})` : `rgba(60,30,20,${a})`;
      x.fillRect(r() * W, r() * H, 0.5 + r() * 1.4, 0.5 + r() * 1.4);
    }
  }

  const bgCache = new Map();
  function background(fk, scale) {
    const key = `${fk}|${scale}`;
    if (bgCache.has(key)) return bgCache.get(key);
    const f = FRAMES[fk], H = stripH(f);
    const c = mk(W * scale, H * scale), x = c.getContext('2d');
    x.scale(scale, scale);
    const r = rng(41);

    if (fk === 'black') {
      x.fillStyle = '#100d0c'; x.fillRect(0, 0, W, H);
      paperSpecks(x, H, 3, true, 3000);
    } else {
      x.fillStyle = C.cream; x.fillRect(0, 0, W, H);
      if (fk === 'red') {
        for (let sx = 0; sx < W; sx += 28) { x.fillStyle = '#b3282d'; x.fillRect(sx, 0, 14, H); }
      } else if (fk === 'green') {
        for (let sx = 0; sx < W; sx += 30) {
          x.fillStyle = C.pine; x.fillRect(sx, 0, 11, H);
          x.fillStyle = '#b3282d'; x.fillRect(sx + 19, 0, 2.5, H);
        }
      } else if (fk === 'water') {
        let k = 0;
        for (let sx = -2; sx < W; sx += 24, k++) {
          const col = k % 3 === 2 ? '62,138,110' : '196,58,62';
          const baseW = k % 3 === 2 ? 5 : 10;
          for (let pass = 0; pass < 5; pass++) {
            const jx = sx + (r() - 0.5) * 3, w = baseW + r() * 5;
            for (let y = 0; y < H; y += 36) {
              x.fillStyle = `rgba(${col},${0.12 + r() * 0.16})`;
              x.fillRect(jx + (r() - 0.5) * 1.5, y, w, 40);
            }
          }
        }
      }
      if (f.panel) {
        x.save();
        x.shadowColor = 'rgba(0,0,0,.18)'; x.shadowBlur = 8; x.shadowOffsetY = 1;
        rrect(x, 40, 42, W - 80, H - 84, 22);
        x.fillStyle = C.cream; x.fill();
        x.restore();
      }
      if (fk === 'arch') {
        archPath(x, H);
        x.strokeStyle = C.cherry; x.lineWidth = 2.5; x.stroke();
        archPath(x, H);
        x.save(); x.translate(0, 0); x.lineWidth = 0.8; x.globalAlpha = 0.4;
        x.setTransform(scale, 0, 0, scale, 0, 0);
        x.beginPath();
        const r2 = 268, top = 32, bottom = H - 32;
        x.moveTo(W / 2 - r2, top + r2);
        x.arc(W / 2, top + r2, r2, Math.PI, 0);
        x.lineTo(W / 2 + r2, bottom - r2);
        x.arc(W / 2, bottom - r2, r2, 0, Math.PI);
        x.closePath();
        x.stroke();
        x.restore();
      }
      paperSpecks(x, H, 9, false, 4000);
    }
    bgCache.set(key, c);
    return c;
  }

  function starPath(x, cx, cy, r, rot) {
    x.beginPath();
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 ? r * 0.42 : r;
      const a = rot - Math.PI / 2 + k * Math.PI / 5;
      x.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    x.closePath();
  }

  // hand-drawn line bow
  function bow(x, cx, cy, s, color) {
    x.save();
    x.translate(cx, cy); x.scale(s, s);
    x.strokeStyle = color; x.lineCap = 'round'; x.lineJoin = 'round';
    const path = () => {
      x.beginPath();
      x.moveTo(-4, -1); x.bezierCurveTo(-18, -24, -50, -22, -46, -4); x.bezierCurveTo(-43, 10, -18, 6, -4, 2);
      x.moveTo(-12, -3); x.quadraticCurveTo(-26, -12, -36, -8);
      x.moveTo(4, -1); x.bezierCurveTo(18, -24, 50, -22, 46, -4); x.bezierCurveTo(43, 10, 18, 6, 4, 2);
      x.moveTo(12, -3); x.quadraticCurveTo(26, -12, 36, -8);
      x.moveTo(-5, -5); x.quadraticCurveTo(0, -9, 5, -5); x.quadraticCurveTo(8, 1, 4, 6);
      x.quadraticCurveTo(0, 8, -4, 6); x.quadraticCurveTo(-8, 1, -5, -5);
      x.moveTo(-3, 6); x.bezierCurveTo(-10, 18, -18, 32, -28, 46); x.lineTo(-20, 42); x.lineTo(-15, 50);
      x.moveTo(-1, 7); x.bezierCurveTo(-4, 22, -9, 34, -15, 50);
      x.moveTo(3, 6); x.bezierCurveTo(10, 18, 18, 32, 28, 46); x.lineTo(20, 42); x.lineTo(15, 50);
      x.moveTo(1, 7); x.bezierCurveTo(4, 22, 9, 34, 15, 50);
    };
    x.lineWidth = 1.8; path(); x.stroke();
    x.globalAlpha = 0.45; x.lineWidth = 0.8; x.translate(0.7, 0.5); path(); x.stroke();
    x.restore();
  }

  /** Draw a strip for the given options into canvas at the given scale. */
  // set 0 = poses 1–4, set 1 = poses 5–8
  function renderStrip(canvas, o, scale, set = 0) {
    const f = FRAMES[o.frame], H = stripH(f), FT = footTop(f);
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const x = canvas.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.imageSmoothingQuality = 'high';
    x.drawImage(background(o.frame, scale), 0, 0);
    x.setTransform(scale, 0, 0, scale, 0, 0);

    for (let i = 0; i < 4; i++) {
      const y = f.top + i * (PHb + GAP);
      const idx = set * 4 + i;
      if (shots[idx]) x.drawImage(processPhoto(idx, o.filter), X0, y, PWb, PHb);
      else { x.fillStyle = '#222'; x.fillRect(X0, y, PWb, PHb); }
      if (o.frame !== 'black') { x.strokeStyle = 'rgba(30,10,10,.3)'; x.lineWidth = 1; x.strokeRect(X0 + 0.5, y + 0.5, PWb - 1, PHb - 1); }
    }

    if (o.stars) {
      const r = rng(1225 + set * 31);
      x.fillStyle = f.star;
      for (let k = 0; k < 16; k++) {
        const sx = 40 + r() * (W - 80), sy = f.top + 10 + r() * (FT - f.top - 30);
        starPath(x, sx, sy, 7 + r() * 10, r() * 1.2);
        x.globalAlpha = 0.92; x.fill(); x.globalAlpha = 1;
      }
    }

    // arch header
    if (o.frame === 'arch') {
      x.fillStyle = f.sub;
      x.font = `500 15px ${SANS}`;
      spaced(x, 'SMILE FOR THE CAMERA', W / 2, 150, 4.5);
    }

    // footer
    let y = FT + 98;
    if (o.frame === 'arch') { bow(x, W / 2, FT + 42, 0.8, C.cherry); y = FT + 142; }
    const cap = (o.caption || '').trim();
    if (cap) {
      const maxW = o.frame === 'arch' ? 390 : 470;
      let size = 58;
      x.font = `${size}px ${SCRIPT}`;
      while (x.measureText(cap).width > maxW && size > 26) { size -= 2; x.font = `${size}px ${SCRIPT}`; }
      x.textAlign = 'center';
      x.fillStyle = f.ink;
      x.fillText(cap, W / 2, y);
    }
    if (o.date) {
      x.fillStyle = f.sub;
      x.font = `500 17px ${SANS}`;
      spaced(x, DATE_TEXT, W / 2, y + (cap ? 54 : 0), 6);
    }
    // watermark
    x.fillStyle = f.mark;
    x.font = `400 10px ${SANS}`;
    spaced(x, 'MERRY PHOTO BOOTH', W / 2, H - (o.frame === 'arch' ? 16 : f.panel ? 58 : 22), 3.5);
    return canvas;
  }

  /* ---------------- story card 1080x1920 ---------------- */
  let grainPattern = null;
  function grainTile() {
    if (grainPattern) return grainPattern;
    const t = mk(200, 200), x = t.getContext('2d'), img = x.createImageData(200, 200), r = rng(8);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = r() * 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 22;
    }
    x.putImageData(img, 0, 0);
    grainPattern = t;
    return t;
  }

  function renderStory(canvas, strips, o) {
    const SW = 1080, SH = 1920, SS = 4 / 3; // laid out at 1080x1920, exported at 1440x2560
    canvas.width = SW * SS; canvas.height = SH * SS;
    const x = canvas.getContext('2d');
    x.setTransform(SS, 0, 0, SS, 0, 0);
    x.imageSmoothingQuality = 'high';
    const bg = x.createRadialGradient(SW / 2, SH * 0.42, 100, SW / 2, SH / 2, SH * 0.75);
    bg.addColorStop(0, '#7a1719'); bg.addColorStop(0.55, '#551214'); bg.addColorStop(1, '#2a0809');
    x.fillStyle = bg; x.fillRect(0, 0, SW, SH);
    x.fillStyle = x.createPattern(grainTile(), 'repeat'); x.fillRect(0, 0, SW, SH);

    if (o.stars) {
      const r = rng(77);
      x.fillStyle = 'rgba(239,233,220,.55)';
      for (let k = 0; k < 18; k++) {
        const left = k % 2 === 0;
        const sx = left ? 30 + r() * 130 : SW - 30 - r() * 130;
        starPath(x, sx, 640 + r() * 1100, 6 + r() * 12, r());
        x.fill();
      }
    }

    x.fillStyle = C.cream;
    x.textAlign = 'center';
    x.shadowColor = 'rgba(0,0,0,.3)'; x.shadowBlur = 20;
    x.font = `220px ${SCRIPT}`;
    x.fillText('Merry', SW / 2 - 70, 330);
    x.font = `176px ${SCRIPT}`;
    x.fillText('Christmas', SW / 2 + 60, 530);
    x.shadowBlur = 0;

    const th = 1120;
    const place = [[-1, -0.05, 1190], [1, 0.04, 1212]]; // side, tilt, center y
    strips.forEach((strip, k) => {
      const tw = th * strip.width / strip.height;
      const [side, rot, cy] = place[k];
      x.save();
      x.translate(SW / 2 + side * (tw / 2 + 16), cy);
      x.rotate(rot);
      x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 40; x.shadowOffsetX = 10; x.shadowOffsetY = 22;
      x.drawImage(strip, -tw / 2, -th / 2, tw, th);
      x.restore();
    });

    x.fillStyle = 'rgba(239,233,220,.85)';
    if (o.date) { x.font = `500 26px ${SANS}`; spaced(x, DATE_TEXT, SW / 2, 1842, 10); }
    x.fillStyle = 'rgba(239,233,220,.4)';
    x.font = `400 16px ${SANS}`;
    spaced(x, 'MERRY PHOTO BOOTH', SW / 2, 1886, 6);
    return canvas;
  }

  /* ---------------- state + rendering ---------------- */
  const state = { frame: 'black', filter: 'bw', stars: false, date: true, caption: 'Merry & Bright', format: 'strip' };
  const EXPORT_SCALE = 2.5; // strip PNG is 1500px wide, each photo 1200x960
  const stripOuts = [mk(1, 1), mk(1, 1)];
  const storyOut = mk(1080, 1920);
  const pairOut = mk(1, 1); // both strips side by side, for the on-screen preview
  let lastBlobs = null, blobToken = 0;

  function renderStrips() {
    stripOuts.forEach((c, set) => renderStrip(c, state, EXPORT_SCALE, set));
  }
  function renderAll() {
    renderStrips();
    if (state.format === 'story') renderStory(storyOut, stripOuts, state);
    drawPreview();
    prepareBlobs();
  }
  const exportCanvases = () => state.format === 'story' ? [storyOut] : stripOuts;
  const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
  function prepareBlobs() {
    lastBlobs = null;
    const t = ++blobToken;
    Promise.all(exportCanvases().map(toBlob)).then((b) => { if (t === blobToken) lastBlobs = b; });
  }
  function composePair() {
    const [a, b] = stripOuts, gap = Math.round(a.width * 0.12);
    pairOut.width = a.width + b.width + gap;
    pairOut.height = Math.max(a.height, b.height);
    const x = pairOut.getContext('2d');
    x.drawImage(a, 0, 0);
    x.drawImage(b, a.width + gap, 0);
    return pairOut;
  }

  function fitInto(canvas, src, maxW, maxH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const s = Math.min(maxW / src.width, maxH / src.height);
    const w = Math.max(1, Math.floor(src.width * s)), h = Math.max(1, Math.floor(src.height * s));
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const x = canvas.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, canvas.width, canvas.height);
  }

  function drawPreview() {
    if (!screens.custom.classList.contains('active')) return;
    const area = $('#preview-area'), pv = $('#preview');
    const cs = getComputedStyle(area);
    const aw = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const story = state.format === 'story';
    fitInto(pv, story ? storyOut : composePair(), aw, ah - (story ? 0 : 10));
    pv.classList.toggle('tilt', !story);
    pv.classList.toggle('story', story);
  }

  function renderThumbs() {
    $$('[data-group="frame"] .card').forEach((card) => {
      const c = card.querySelector('canvas');
      renderStrip(c, { ...state, frame: card.dataset.value, caption: '' }, 0.22);
      c.style.height = ''; c.style.width = '';
    });
  }
  function renderFilterThumbs() {
    $$('[data-group="filter"] .card').forEach((card) => {
      const c = card.querySelector('canvas');
      c.width = 160; c.height = 128;
      c.getContext('2d').drawImage(processPhoto(0, card.dataset.value), 0, 0, 160, 128);
    });
  }

  function syncControls() {
    $$('[data-group="frame"] .card').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === state.frame)));
    $$('[data-group="filter"] .card').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === state.filter)));
    $$('[data-group="format"] button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === state.format)));
    $('#toggle-stars').setAttribute('aria-pressed', String(state.stars));
    $('#toggle-date').setAttribute('aria-pressed', String(state.date));
    $('#caption').value = state.caption;
  }

  const fontsReady = () => Promise.race([
    Promise.all([
      document.fonts.load(`58px "Pinyon Script"`),
      document.fonts.load(`500 17px Jost`),
      document.fonts.load(`400 10px Jost`),
    ]),
    sleep(2500),
  ]).catch(() => {});

  /* ---------------- delivery ---------------- */
  let delivering = false;
  async function showDelivery() {
    await fontsReady();
    renderStrips();
    $('#delivery-actions').classList.remove('in');
    const mover = $('#mover');
    mover.classList.remove('delivering', 'delivered');
    show('delivery');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    $$('.delivery-strip').forEach((dc, k) => {
      const src = stripOuts[k];
      const cssW = dc.getBoundingClientRect().width || 100;
      dc.width = Math.round(cssW * dpr);
      dc.height = Math.round(cssW * dpr * src.height / src.width);
      dc.getContext('2d').drawImage(src, 0, 0, dc.width, dc.height);
    });
    await sleep(700);
    void mover.offsetWidth;
    delivering = true;
    mover.classList.add('delivering');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    motor(reduced ? 1.2 : 3.1);
  }
  function finishDelivery() {
    if (!delivering) return;
    delivering = false;
    const mover = $('#mover');
    mover.classList.remove('delivering');
    mover.classList.add('delivered');
    drop();
    $('#delivery-actions').classList.add('in');
  }

  async function openCustomize() {
    await fontsReady();
    show('custom');
    syncControls();
    renderFilterThumbs();
    renderThumbs();
    renderAll();
  }

  /* ---------------- save / share ---------------- */
  const fileNames = () => state.format === 'story'
    ? ['merry-photo-booth-story.png']
    : ['merry-photo-booth-strip-1.png', 'merry-photo-booth-strip-2.png'];
  function getBlobs() {
    if (lastBlobs) return Promise.resolve(lastBlobs);
    return Promise.all(exportCanvases().map(toBlob));
  }
  async function saveImage(silent) {
    const blobs = await getBlobs();
    if (!blobs.every(Boolean)) { toast("Couldn't create the image"); return; }
    const names = fileNames();
    for (let k = 0; k < blobs.length; k++) {
      const url = URL.createObjectURL(blobs[k]);
      const a = document.createElement('a');
      a.href = url; a.download = names[k];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (k < blobs.length - 1) await sleep(450); // browsers drop back-to-back downloads
    }
    if (!silent) toast(blobs.length > 1 ? 'Both strips saved' : 'Saved to your device');
  }
  async function shareImage() {
    const blobs = lastBlobs || await getBlobs();
    if (!blobs.every(Boolean)) { toast("Couldn't create the image"); return; }
    const names = fileNames();
    const files = blobs.map((b, k) => new File([b], names[k], { type: 'image/png' }));
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: 'Merry Photo Booth', text: 'Merry Christmas from the photo booth' }); }
      catch (e) { if (e && e.name !== 'AbortError') toast('Sharing failed. Try Save instead.'); }
    } else {
      await saveImage(true);
      toast('Sharing not supported here. Saved instead.', 3200);
    }
  }

  /* ---------------- wiring ---------------- */
  function selectTab(id) {
    $$('.tabs [role="tab"]').forEach((t) => {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  $('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) selectTab(t.id); });
  $('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = $$('.tabs [role="tab"]'), i = tabs.indexOf(document.activeElement);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); selectTab(next.id); e.preventDefault();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group] [role="radio"]');
    if (!btn) return;
    const group = btn.closest('[data-group]').dataset.group;
    if (state[group] === btn.dataset.value) return;
    state[group] = btn.dataset.value;
    syncControls();
    renderAll();
    if (group === 'filter') renderThumbs();
  });
  document.addEventListener('keydown', (e) => {
    const btn = e.target.closest && e.target.closest('[data-group] [role="radio"]');
    if (!btn || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const list = [...btn.closest('[data-group]').querySelectorAll('[role="radio"]')];
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = list[(list.indexOf(btn) + dir + list.length) % list.length];
    next.focus(); next.click(); e.preventDefault();
  });

  $('#toggle-stars').addEventListener('click', () => { state.stars = !state.stars; syncControls(); renderAll(); renderThumbs(); });
  $('#toggle-date').addEventListener('click', () => { state.date = !state.date; syncControls(); renderAll(); });
  let capTimer = 0;
  $('#caption').addEventListener('input', (e) => {
    state.caption = e.target.value;
    clearTimeout(capTimer);
    capTimer = setTimeout(renderAll, 120);
  });
  $('#caption').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $('#btn-start').addEventListener('click', stepInside);
  $('#btn-leave').addEventListener('click', leave);
  $('#btn-retry').addEventListener('click', () => { demo = false; retake(); });
  $('#btn-demo').addEventListener('click', () => { demo = true; retake(); });
  $('#btn-retake-1').addEventListener('click', retake);
  $('#btn-retake-2').addEventListener('click', retake);
  $('#btn-restart').addEventListener('click', leave);
  $('#btn-customize').addEventListener('click', openCustomize);
  $('#btn-save').addEventListener('click', () => saveImage(false));
  $('#btn-share').addEventListener('click', shareImage);
  $('#mover').addEventListener('animationend', finishDelivery);
  $('#tray-window').addEventListener('click', finishDelivery); // tap to skip

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawPreview, 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screens.shoot.classList.contains('active')) leave();
  });

  fontsReady();
  if (new URLSearchParams(location.search).has('demo')) demo = true;})();
