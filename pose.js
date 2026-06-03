/**
 * pose.js
 * Bertugas: inisialisasi MediaPipe Pose dan analisis postur dari landmark tubuh.
 * Dipanggil oleh app.js
 */

// ─── Konstanta threshold ────────────────────────────────────────────────────
const THRESHOLD = {
  headForward:    0.07,   // selisih x hidung vs tengah bahu (normalized)
  tooClose:       0.25,   // lebar wajah (jarak telinga) — semakin besar = semakin dekat
  shoulderMinDeg: 170,    // sudut bahu minimal agar dianggap sejajar (170–180° = baik)
  neckTiltDeg:    12,     // sudut kemiringan kepala (telinga ke bahu) dalam derajat
  minVisibility:  0.55,   // minimum confidence landmark bahu agar analisis valid
};

// ─── Helper: hitung sudut dalam derajat dari dua titik ──────────────────────
function angleDeg(ax, ay, bx, by) {
  return Math.abs(Math.atan2(by - ay, bx - ax) * (180 / Math.PI));
}

// Tips teks untuk setiap kondisi
const TIPS = {
  good:            'Postur kamu bagus! Pertahankan dan istirahat setiap 30 menit.',
  head_forward:    'Kepala terlalu maju. Tarik kepala ke belakang agar telinga sejajar bahu.',
  too_close:       'Terlalu dekat ke layar. Mundurkan kursi, jarak ideal 50–70 cm.',
  tilted:          'Badan miring. Pastikan duduk seimbang dan punggung tegak.',
  shoulder_hidden: 'Mundur sedikit dari kamera agar bahu kelihatan di frame.',
};

// ─── Inisialisasi MediaPipe Pose ────────────────────────────────────────────
function initPose(onResultsCallback) {
  const pose = new Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity:         1,
    smoothLandmarks:         true,
    enableSegmentation:      false,
    minDetectionConfidence:  0.55,
    minTrackingConfidence:   0.55,
  });

  pose.onResults(onResultsCallback);
  return pose;
}

// ─── Fungsi analisis postur ─────────────────────────────────────────────────
function analyzePosture(landmarks) {
  const nose      = landmarks[0];
  const lEar      = landmarks[7];
  const rEar      = landmarks[8];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];

  // Validasi: bahu harus terdeteksi dengan cukup yakin
  // Kalau pengguna terlalu dekat ke kamera, bahu tidak masuk frame
  // dan visibility-nya akan rendah → skip analisis, tampilkan pesan.
  const lVis = lShoulder.visibility ?? 1;
  const rVis = rShoulder.visibility ?? 1;
  if (lVis < THRESHOLD.minVisibility || rVis < THRESHOLD.minVisibility) {
    console.debug({ lShoulderVis: lVis.toFixed(2), rShoulderVis: rVis.toFixed(2), msg: 'bahu tidak terlihat' });
    return { notVisible: true };
  }

  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const earMidX      = (lEar.x + rEar.x) / 2;
  const earMidY      = (lEar.y + rEar.y) / 2;

  // Cek 1: Kepala terlalu maju
  const shoulderWidth = Math.abs(lShoulder.x - rShoulder.x) || 0.1;
  const headOffset    = Math.abs(nose.x - shoulderMidX) / shoulderWidth;
  const isHeadOk      = headOffset < THRESHOLD.headForward;

  // Cek 2: Bahu miring (sudut garis bahu kiri→kanan)
  // atan2 menghasilkan sudut 0–180°. Bahu sejajar sempurna = ~180° (garis horizontal).
  // Kita hitung sudut penuh dengan memastikan selalu ambil sisi yang mendekati 180°.
  const rawAngle      = angleDeg(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
  const shoulderAngle = rawAngle < 90 ? 180 - rawAngle : rawAngle;
  // Baik: 170–180°, Miring: < 170°
  const isShoulderOk  = shoulderAngle >= THRESHOLD.shoulderMinDeg;

  // Cek 3: Jarak terlalu dekat
  const faceWidth = Math.abs(lEar.x - rEar.x);
  const isDistOk  = faceWidth < THRESHOLD.tooClose;

  // Cek 4: Kepala/leher miring ke samping
  const neckAngle     = angleDeg(earMidX, earMidY, shoulderMidX, shoulderMidY);
  const neckDeviation = Math.abs(neckAngle - 90);
  const isNeckOk      = neckDeviation < THRESHOLD.neckTiltDeg;

  // Skor 0–100
  let score = 0;
  if (isHeadOk)     score += 25;
  if (isShoulderOk) score += 25;
  if (isDistOk)     score += 25;
  if (isNeckOk)     score += 25;

  // Kondisi utama
  let condition = 'good';
  if (!isShoulderOk)  condition = 'tilted';
  else if (!isNeckOk) condition = 'tilted';
  else if (!isHeadOk) condition = 'head_forward';
  else if (!isDistOk) condition = 'too_close';

  console.debug({
    headOffset: headOffset.toFixed(3),
    shoulderAngle: shoulderAngle.toFixed(1) + '° (baik jika >=170)',
    faceWidth: faceWidth.toFixed(3),
    neckDeviation: neckDeviation.toFixed(1) + '°',
    lVis: lVis.toFixed(2), rVis: rVis.toFixed(2),
    score,
  });

  return {
    score,
    isGood: score >= 75,
    condition,
    tip: TIPS[condition],
    metrics: {
      head:     { ok: isHeadOk,     label: isHeadOk     ? 'Baik'       : 'Terlalu maju'  },
      shoulder: { ok: isShoulderOk, label: isShoulderOk ? 'Sejajar (' + shoulderAngle.toFixed(0) + '°)' : 'Miring (' + shoulderAngle.toFixed(0) + '°)' },
      distance: { ok: isDistOk,     label: isDistOk     ? 'Normal'     : 'Terlalu dekat' },
      tilt:     { ok: isNeckOk,     label: isNeckOk     ? 'Lurus'      : 'Miring ' + neckDeviation.toFixed(0) + '°' },
    },
  };
}