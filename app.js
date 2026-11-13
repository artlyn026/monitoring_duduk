/**
 * app.js
 * Bertugas: kontrol kamera, loop deteksi, update UI, statistik sesi,
 * dan jendela mengambang (Document Picture-in-Picture).
 * Bergantung pada: pose.js (initPose, analyzePosture)
 */

// ─── Referensi elemen DOM ────────────────────────────────────────────────────
const videoEl         = document.getElementById('videoEl');
const canvasEl        = document.getElementById('canvasEl');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const cameraBadge     = document.getElementById('cameraBadge');
const badgeDot        = document.getElementById('badgeDot');
const badgeText       = document.getElementById('badgeText');
const btnStart        = document.getElementById('btnStart');
const btnStop         = document.getElementById('btnStop');
const btnFloat        = document.getElementById('btnFloat');
const btnFloatLabel   = document.getElementById('btnFloatLabel');
const floatHint       = document.getElementById('floatHint');

const scoreNumber     = document.getElementById('scoreNumber');
const scoreBarFill    = document.getElementById('scoreBarFill');
const scoreStatus     = document.getElementById('scoreStatus');
const mHead           = document.getElementById('mHead');
const mShoulder       = document.getElementById('mShoulder');
const mDist           = document.getElementById('mDist');
const mTilt           = document.getElementById('mTilt');
const tipText         = document.getElementById('tipText');
const statDuration    = document.getElementById('statDuration');
const statGood        = document.getElementById('statGood');
const statBad         = document.getElementById('statBad');

// ─── State aplikasi ──────────────────────────────────────────────────────────
let cameraRunning  = false;
let poseInstance   = null;    // model MediaPipe Pose (dibuat sekali, dipakai ulang)
let camStream      = null;    // MediaStream dari kamera
let sessionStart   = null;
let sessionTimer   = null;
let frameCount     = 0;
let goodFrames     = 0;

// Jendela mengambang (Document Picture-in-Picture, Chrome/Edge 116+)
const FLOAT_SUPPORTED = 'documentPictureInPicture' in window;
let floatWin  = null;   // objek window jendela mengambang
let floatEls  = null;   // referensi elemen di dalam jendela itu

// ─── Update UI metric badge ───────────────────────────────────────────────────
function setMetricBadge(el, label, isOk) {
  el.textContent  = label;
  el.className    = 'metric-badge ' + (isOk ? 'ok' : 'warn');
}

// ─── Update seluruh panel status ─────────────────────────────────────────────
function updateStatusPanel(result) {
  const { score, isGood, condition, tip, metrics } = result;

  // Skor
  scoreNumber.textContent = score;
  scoreBarFill.style.width = score + '%';

  if (score >= 75) {
    scoreBarFill.style.background = '#4ade80';
    scoreNumber.style.color       = '#4ade80';
    scoreStatus.textContent       = 'Postur baik — pertahankan!';
  } else if (score >= 50) {
    scoreBarFill.style.background = '#fb923c';
    scoreNumber.style.color       = '#fb923c';
    scoreStatus.textContent       = 'Perlu sedikit perbaikan';
  } else {
    scoreBarFill.style.background = '#f87171';
    scoreNumber.style.color       = '#f87171';
    scoreStatus.textContent       = 'Postur perlu diperbaiki segera';
  }

  // Badge kamera
  cameraBadge.style.display = 'flex';
  badgeText.textContent = isGood ? 'Postur baik' : 'Perbaiki postur';
  badgeDot.className = 'badge-dot ' + (isGood ? 'good' : (score >= 50 ? 'warn' : 'bad'));

  // Detail metrik
  setMetricBadge(mHead,     metrics.head.label,     metrics.head.ok);
  setMetricBadge(mShoulder, metrics.shoulder.label, metrics.shoulder.ok);
  setMetricBadge(mDist,     metrics.distance.label, metrics.distance.ok);
  setMetricBadge(mTilt,     metrics.tilt.label,     metrics.tilt.ok);

  // Tips
  tipText.textContent = tip;

  // Statistik sesi
  frameCount++;
  if (isGood) goodFrames++;
  const pctGood = Math.round((goodFrames / frameCount) * 100);
  const pctBad  = 100 - pctGood;
  statGood.textContent = pctGood + '%';
  statBad.textContent  = pctBad  + '%';
}

// ─── Reset UI ke kondisi awal ─────────────────────────────────────────────────
function resetUI() {
  scoreNumber.textContent       = '—';
  scoreNumber.style.color       = '';
  scoreBarFill.style.width      = '0%';
  scoreStatus.textContent       = 'Aktifkan kamera untuk mulai';
  cameraBadge.style.display     = 'none';
  tipText.textContent           = 'Aktifkan kamera, lalu duduk dalam posisi normal. Pastikan kepala dan bahu terlihat kamera.';
  [mHead, mShoulder, mDist, mTilt].forEach(el => {
    el.textContent = '—';
    el.className   = 'metric-badge';
  });
  statDuration.textContent = '0:00';
  statGood.textContent     = '0%';
  statBad.textContent      = '0%';
  frameCount = 0;
  goodFrames = 0;
}

// ─── Timer durasi sesi ────────────────────────────────────────────────────────
function startSessionTimer() {
  sessionStart = Date.now();
  sessionTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    statDuration.textContent = m + ':' + String(s).padStart(2, '0');
    syncFloatingStats();
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(sessionTimer);
  sessionTimer = null;
  sessionStart = null;
}

// ─── Handler hasil MediaPipe ──────────────────────────────────────────────────
function onPoseResults(results) {
  // Sesuaikan ukuran canvas dengan video
  canvasEl.width  = videoEl.videoWidth  || 640;
  canvasEl.height = videoEl.videoHeight || 480;

  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  let result = null;   // hasil analisis (null kalau tidak ada orang)

  if (results.poseLandmarks) {
    // Gambar koneksi tulang (skeleton)
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: 'rgba(74,222,128,0.5)',
      lineWidth: 2,
    });

    // Gambar titik landmark
    drawLandmarks(ctx, results.poseLandmarks, {
      color: '#4ade80',
      lineWidth: 1,
      radius: 3,
    });

    // Analisis postur & update UI (dihitung sekali, dipakai semua tampilan)
    result = analyzePosture(results.poseLandmarks);

    if (result.notVisible) {
      // Bahu tidak masuk frame — minta pengguna mundur dari kamera
      cameraBadge.style.display = 'flex';
      badgeText.textContent = 'Bahu tidak terlihat';
      badgeDot.className = 'badge-dot warn';
      tipText.textContent = 'Mundur sedikit dari kamera agar bahu kelihatan di frame. Framing ideal: kepala + bahu semua terlihat.';
    } else {
      updateStatusPanel(result);
    }

  } else {
    // Tidak ada orang terdeteksi sama sekali
    cameraBadge.style.display = 'flex';
    badgeText.textContent = 'Tidak terdeteksi';
    badgeDot.className = 'badge-dot';
    tipText.textContent = 'Pastikan kepala dan bahu terlihat di kamera.';
  }

  // Kirim hasil yang sama ke jendela mengambang (kalau sedang terbuka)
  updateFloating(results, result);
}

// ─── Loop deteksi ────────────────────────────────────────────────────────────
// Camera Utils bawaan MediaPipe memakai requestAnimationFrame, yang DIJEDA
// browser saat tab tidak terlihat. Akibatnya deteksi berhenti begitu kamu
// pindah tab. Karena itu kita pakai timer di Web Worker (tidak ikut dijeda).
const TICK_MS = 66;            // ~15 frame per detik, cukup untuk postur
let tickWorker   = null;
let tickWorkerUrl = null;
let tickTimer    = null;       // cadangan kalau Worker tidak bisa dibuat
let detectBusy   = false;

async function detectTick() {
  // Lewati tick kalau frame sebelumnya belum selesai diproses
  if (detectBusy || !camStream || !poseInstance || videoEl.readyState < 2) return;
  detectBusy = true;
  try {
    await poseInstance.send({ image: videoEl });
  } catch (err) {
    console.error('Gagal memproses frame:', err);
  } finally {
    detectBusy = false;
  }
}

function startDetectLoop() {
  stopDetectLoop();
  try {
    const code = 'let t=null;onmessage=function(e){clearInterval(t);' +
                 'if(e.data==="start"){t=setInterval(function(){postMessage(0)},' + TICK_MS + ');}};';
    tickWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    tickWorker = new Worker(tickWorkerUrl);
    tickWorker.onmessage = detectTick;
    tickWorker.postMessage('start');
  } catch (err) {
    // Cadangan: setInterval biasa (akan melambat ke ~1 fps kalau tab tersembunyi)
    console.warn('Worker tidak tersedia, pakai setInterval:', err);
    tickTimer = setInterval(detectTick, TICK_MS);
  }
}

function stopDetectLoop() {
  if (tickWorker) {
    tickWorker.postMessage('stop');
    tickWorker.terminate();
    tickWorker = null;
  }
  if (tickWorkerUrl) {
    URL.revokeObjectURL(tickWorkerUrl);
    tickWorkerUrl = null;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  detectBusy = false;
}

// ─── Pesan error sesuai penyebabnya ──────────────────────────────────────────
function cameraErrorMessage(err) {
  const name = (err && err.name) || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Izin kamera ditolak. Klik ikon kamera/gembok di address bar, izinkan kamera untuk halaman ini, lalu muat ulang.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Kamera tidak ditemukan. Pastikan kamera terpasang dan tidak dinonaktifkan di pengaturan perangkat.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Kamera sedang dipakai aplikasi atau tab lain. Tutup yang lain lalu coba lagi.';
  }
  // Bukan masalah kamera: kemungkinan file belum lengkap/versi campur atau library gagal dimuat
  return 'Terjadi kesalahan di aplikasi: ' + (err && err.message ? err.message : err) +
         '\n\nPastikan index.html, style.css, pose.js, dan app.js semuanya versi terbaru ' +
         'dan koneksi internet aktif (library MediaPipe dimuat dari internet), lalu tekan Ctrl+Shift+R.';
}

// ─── Mulai kamera ────────────────────────────────────────────────────────────
async function startCamera() {
  btnStart.disabled = true;
  btnStart.querySelector('.btn-icon').textContent = '...';

  try {
    // Init MediaPipe Pose sekali saja
    if (!poseInstance) poseInstance = initPose(onPoseResults);

    // Minta akses kamera lalu sambungkan ke elemen <video>
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = camStream;
    await videoEl.play();

    // Update state & UI
    cameraRunning = true;
    cameraPlaceholder.style.display = 'none';
    btnStart.disabled = true;
    btnStop.disabled  = false;
    btnStart.querySelector('.btn-icon').textContent = '▶';
    if (FLOAT_SUPPORTED && btnFloat) btnFloat.disabled = false;

    startDetectLoop();
    startSessionTimer();
    registerAutoFloat();

  } catch (err) {
    console.error('Gagal membuka kamera:', err);
    alert('Tidak bisa memulai kamera.\n\n' + cameraErrorMessage(err));
    if (camStream) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }
    btnStart.disabled = false;
    btnStart.querySelector('.btn-icon').textContent = '▶';
  }
}

// ─── Hentikan kamera ──────────────────────────────────────────────────────────
function stopCamera() {
  stopDetectLoop();
  unregisterAutoFloat();
  if (floatWin) floatWin.close();

  // Matikan stream kamera (supaya lampu kamera laptop benar-benar mati)
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  videoEl.srcObject = null;

  // Bersihkan canvas
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  cameraRunning = false;
  cameraPlaceholder.style.display = 'flex';
  btnStart.disabled = false;
  btnStop.disabled  = true;
  if (btnFloat) btnFloat.disabled = true;

  stopSessionTimer();
  resetUI();
}

// ─── Event listener tombol ────────────────────────────────────────────────────
btnStart.addEventListener('click', () => {
  if (!cameraRunning) startCamera();
});

btnStop.addEventListener('click', () => {
  if (cameraRunning) stopCamera();
});

if (btnFloat) {
  btnFloat.addEventListener('click', () => {
    openFloatingWindow(false);
  });
} else {
  console.warn('Tombol jendela mengambang tidak ada: index.html masih versi lama.');
}

// ═════════════════════════════════════════════════════════════════════════════
// JENDELA MENGAMBANG (Document Picture-in-Picture)
// Jendela kecil yang selalu di atas aplikasi lain, berisi video + skeleton,
// skor, detail deteksi, dan statistik sesi. Hanya ada di Chrome/Edge 116+.
// ═════════════════════════════════════════════════════════════════════════════


// CSS khusus isi jendela (dokumen terpisah, tidak memakai style.css)
const FLOAT_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:#0e0f11;color:#e8eaf0;
    font-family:system-ui,-apple-system,sans-serif;font-size:13px}
  body{display:flex;flex-direction:column;gap:8px;padding:8px}
  .status{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12px}
  .dot{width:8px;height:8px;border-radius:50%;background:#555a66}
  .cam{position:relative;aspect-ratio:4/3;background:#000;border-radius:10px;
    overflow:hidden;border:1px solid #2a2d35}
  .cam video,.cam canvas{position:absolute;inset:0;width:100%;height:100%;
    object-fit:cover;transform:scaleX(-1)}
  .score{display:flex;align-items:baseline;gap:4px;color:#8a8f9e}
  .score b{font:bold 28px 'Courier New',monospace;line-height:1;color:#e8eaf0}
  .bar{height:5px;background:#23272f;border-radius:99px;overflow:hidden}
  .bar i{display:block;height:100%;width:0;background:#555a66;
    transition:width .3s,background .3s}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .chip{display:flex;justify-content:space-between;gap:6px;background:#1c1f25;
    border:1px solid #2a2d35;border-radius:8px;padding:4px 8px;font-size:11px}
  .chip span:first-child{color:#8a8f9e}
  .chip span:last-child{font-weight:600;color:#8a8f9e}
  .chip span.ok{color:#4ade80}
  .chip span.warn{color:#fb923c}
  .stats{display:flex;justify-content:space-between;color:#8a8f9e;font-size:11px}
  .stats b{color:#e8eaf0}
`;

const FLOAT_HTML = `
  <div class="status"><span class="dot" id="fDot"></span><span id="fStatus">Menunggu deteksi...</span></div>
  <div class="cam">
    <video id="fVideo" autoplay muted playsinline></video>
    <canvas id="fCanvas" width="640" height="480"></canvas>
  </div>
  <div class="score"><b id="fScore">—</b><span>/100</span></div>
  <div class="bar"><i id="fBar"></i></div>
  <div class="grid">
    <div class="chip"><span>Kepala</span><span id="fHead">—</span></div>
    <div class="chip"><span>Bahu</span><span id="fShoulder">—</span></div>
    <div class="chip"><span>Jarak</span><span id="fDist">—</span></div>
    <div class="chip"><span>Badan</span><span id="fTilt">—</span></div>
  </div>
  <div class="stats">
    <span>Durasi <b id="fDur">0:00</b></span>
    <span>Baik <b id="fGood">0%</b></span>
    <span>Buruk <b id="fBad">0%</b></span>
  </div>
`;

function scoreColor(score) {
  return score >= 75 ? '#4ade80' : (score >= 50 ? '#fb923c' : '#f87171');
}

function setFloatButton(isOpen) {
  if (btnFloatLabel) btnFloatLabel.textContent = isOpen ? 'Tutup Jendela Mengambang' : 'Jendela Mengambang';
}

// Isi dokumen jendela mengambang
function buildFloatingDocument(win) {
  const doc = win.document;
  doc.title = 'PostureCheck';

  const style = doc.createElement('style');
  style.textContent = FLOAT_CSS;
  doc.head.appendChild(style);

  doc.body.innerHTML = FLOAT_HTML;

  const $ = (id) => doc.getElementById(id);
  floatEls = {
    dot: $('fDot'),       status: $('fStatus'),
    video: $('fVideo'),   canvas: $('fCanvas'),
    score: $('fScore'),   bar: $('fBar'),
    head: $('fHead'),     shoulder: $('fShoulder'),
    dist: $('fDist'),     tilt: $('fTilt'),
    dur: $('fDur'),       good: $('fGood'),   bad: $('fBad'),
  };

  // Pakai stream kamera yang sama, tanpa membuka kamera kedua
  floatEls.video.srcObject = camStream;
  floatEls.video.play().catch(() => {});

  syncFloatingStats();
}

async function openFloatingWindow(auto) {
  if (!FLOAT_SUPPORTED || !cameraRunning) return;

  // Sudah terbuka: tombol = tutup, pemicu otomatis = abaikan
  if (floatWin) {
    if (!auto) floatWin.close();
    return;
  }

  try {
    const win = await documentPictureInPicture.requestWindow({ width: 320, height: 440 });
    floatWin = win;
    buildFloatingDocument(win);
    setFloatButton(true);

    // Dipanggil saat jendela ditutup (lewat tombol X-nya atau lewat kode)
    win.addEventListener('pagehide', () => {
      if (floatWin === win) {
        floatWin = null;
        floatEls = null;
        setFloatButton(false);
      }
    });
  } catch (err) {
    console.error('Gagal membuka jendela mengambang:', err);
    if (!auto) {
      alert('Jendela mengambang gagal dibuka.\n\nPakai Chrome atau Edge versi 116 ke atas, dan buka halaman lewat HTTPS atau localhost.');
    }
  }
}

// Update isi jendela di setiap frame
function updateFloating(results, result) {
  if (!floatWin || !floatEls) return;
  const e = floatEls;

  // Skeleton di atas video
  const ctx = e.canvas.getContext('2d');
  const w = videoEl.videoWidth  || 640;
  const h = videoEl.videoHeight || 480;
  if (e.canvas.width !== w || e.canvas.height !== h) {
    e.canvas.width  = w;
    e.canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  if (results && results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: 'rgba(74,222,128,0.5)',
      lineWidth: 2,
    });
    drawLandmarks(ctx, results.poseLandmarks, {
      color: '#4ade80',
      lineWidth: 1,
      radius: 3,
    });
  }

  // Tidak ada orang di frame
  if (!result) {
    e.dot.style.background = '#555a66';
    e.status.textContent   = 'Tidak terdeteksi';
    return;
  }

  // Bahu tidak terlihat
  if (result.notVisible) {
    e.dot.style.background = '#fb923c';
    e.status.textContent   = 'Bahu tidak terlihat';
    return;
  }

  // Hasil normal
  const color = scoreColor(result.score);
  e.dot.style.background = color;
  e.status.textContent   = result.isGood ? 'Postur baik' : 'Perbaiki postur';
  e.score.textContent    = result.score;
  e.score.style.color    = color;
  e.bar.style.width      = result.score + '%';
  e.bar.style.background = color;

  const m = result.metrics;
  [[e.head, m.head], [e.shoulder, m.shoulder], [e.dist, m.distance], [e.tilt, m.tilt]]
    .forEach(([el, metric]) => {
      el.textContent = metric.label;
      el.className   = metric.ok ? 'ok' : 'warn';
    });

  syncFloatingStats();
}

// Salin angka statistik dari panel utama ke jendela
function syncFloatingStats() {
  if (!floatWin || !floatEls) return;
  floatEls.dur.textContent  = statDuration.textContent;
  floatEls.good.textContent = statGood.textContent;
  floatEls.bad.textContent  = statBad.textContent;
}

// Buka otomatis saat pengguna pindah tab (Chrome 120+, syaratnya kamera sedang
// aktif). Kalau tidak muncul sendiri, tombol manual tetap bisa dipakai.
function registerAutoFloat() {
  if (!FLOAT_SUPPORTED || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
      openFloatingWindow(true);
    });
  } catch (err) {
    // Browser belum mendukung aksi ini — abaikan
  }
}

function unregisterAutoFloat() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
  } catch (err) {
    // abaikan
  }
}

// Kondisi awal tombol sesuai dukungan browser
if (!FLOAT_SUPPORTED && btnFloat) {
  btnFloat.disabled = true;
  btnFloat.title = 'Perlu Chrome atau Edge versi 116 ke atas';
  if (floatHint) floatHint.textContent = 'Jendela mengambang hanya tersedia di Chrome/Edge 116+.';
}
