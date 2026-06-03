/**
 * app.js
 * Bertugas: kontrol kamera, update UI, hitung statistik sesi.
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
let mediapipeCamera = null;   // instance Camera dari MediaPipe
let sessionStart   = null;
let sessionTimer   = null;
let frameCount     = 0;
let goodFrames     = 0;

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

    // Analisis postur & update UI
    const result = analyzePosture(results.poseLandmarks);

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
}

// ─── Mulai kamera ────────────────────────────────────────────────────────────
async function startCamera() {
  btnStart.disabled = true;
  btnStart.querySelector('.btn-icon').textContent = '...';

  try {
    // Init MediaPipe Pose
    const pose = initPose(onPoseResults);

    // Buat Camera dari MediaPipe (bungkus getUserMedia + loop frame)
    mediapipeCamera = new Camera(videoEl, {
      onFrame: async () => {
        await pose.send({ image: videoEl });
      },
      width:       640,
      height:      480,
      facingMode: 'user',
    });

    await mediapipeCamera.start();

    // Update state & UI
    cameraRunning = true;
    cameraPlaceholder.style.display = 'none';
    btnStart.disabled = true;
    btnStop.disabled  = false;
    btnStart.querySelector('.btn-icon').textContent = '▶';

    startSessionTimer();

  } catch (err) {
    console.error('Gagal membuka kamera:', err);
    alert('Tidak bisa mengakses kamera.\n\nPastikan:\n• Kamu mengizinkan akses kamera di browser\n• Tidak ada aplikasi lain yang menggunakan kamera');
    btnStart.disabled = false;
    btnStart.querySelector('.btn-icon').textContent = '▶';
  }
}

// ─── Hentikan kamera ──────────────────────────────────────────────────────────
function stopCamera() {
  if (mediapipeCamera) {
    mediapipeCamera.stop();
    mediapipeCamera = null;
  }

  // Matikan stream video secara manual juga
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  // Bersihkan canvas
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  cameraRunning = false;
  cameraPlaceholder.style.display = 'flex';
  btnStart.disabled = false;
  btnStop.disabled  = true;

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