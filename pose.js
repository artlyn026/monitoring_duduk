/**
 * pose.js
 * Bertugas: inisialisasi MediaPipe Pose dan analisis postur dari landmark tubuh.
 * Dipanggil oleh app.js
 */

// ─── Konstanta threshold ────────────────────────────────────────────────────
const THRESHOLD = {
  headOffsetRatio: 0.15,
  tooClose: 0.28,
  shoulderMinDeg: 170,
  neckTiltDeg: 12,
  trunkTiltDeg: 10,
  minVisibility: 0.55
};

// ─── Helper: hitung sudut dalam derajat dari dua titik ──────────────────────
function angleDeg(ax, ay, bx, by) {
  return Math.abs(Math.atan2(by - ay, bx - ax) * (180 / Math.PI));
}

// Tips teks untuk setiap kondisi
const TIPS = {
  good:
    'Postur kamu bagus! Pertahankan dan istirahat setiap 30 menit.',

  head_forward:
    'Kepala terlalu maju. Tarik kepala ke belakang hingga sejajar dengan bahu.',

  shoulder_tilt:
    'Bahu terlihat miring. Duduklah lebih seimbang.',

  neck_tilt:
    'Leher terlihat miring. Kembalikan posisi kepala agar tegak.',

  too_close:
    'Terlalu dekat ke layar. Mundurkan kursi, jarak ideal 50–70 cm.',

  shoulder_hidden:
    'Mundur sedikit dari kamera agar bahu kelihatan di frame.',
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

  const lEar      = landmarks[7];
  const rEar      = landmarks[8];

  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];

  const lVis = lShoulder.visibility ?? 1;
  const rVis = rShoulder.visibility ?? 1;

  if (
    lVis < THRESHOLD.minVisibility ||
    rVis < THRESHOLD.minVisibility
  ) {
    return { notVisible: true };
  }

  // =====================================
  // MIDPOINT
  // =====================================

  const shoulderMidX =
    (lShoulder.x + rShoulder.x) / 2;

  const shoulderMidY =
    (lShoulder.y + rShoulder.y) / 2;

  const earMidX =
    (lEar.x + rEar.x) / 2;

  const earMidY =
    (lEar.y + rEar.y) / 2;

  // =====================================
  // HEAD ALIGNMENT
  // =====================================

  const shoulderWidth =
    Math.abs(lShoulder.x - rShoulder.x) || 0.1;

  const headOffsetRatio =
    Math.abs(earMidX - shoulderMidX) /
    shoulderWidth;

  const isHeadOk =
    headOffsetRatio <
    THRESHOLD.headOffsetRatio;

  // =====================================
  // SHOULDER ALIGNMENT
  // =====================================

  const rawAngle =
    angleDeg(
      lShoulder.x,
      lShoulder.y,
      rShoulder.x,
      rShoulder.y
    );

  const shoulderAngle =
    rawAngle < 90
      ? 180 - rawAngle
      : rawAngle;

  const isShoulderOk =
    shoulderAngle >= 170;

  // =====================================
  // NECK TILT
  // =====================================

  const neckAngle =
    angleDeg(
      earMidX,
      earMidY,
      shoulderMidX,
      shoulderMidY
    );

  const neckDeviation =
    Math.abs(neckAngle - 90);

  const isNeckOk =
    neckDeviation < 12;

  // =====================================
  // CAMERA PROXIMITY
  // =====================================

  const faceWidth =
    Math.abs(lEar.x - rEar.x);

  const isProximityOk =
    faceWidth < 0.28;

  // =====================================
  // SCORE
  // =====================================

  let score = 0;

  if (isHeadOk)      score += 30;
  if (isShoulderOk)  score += 30;
  if (isNeckOk)      score += 25;
  if (isProximityOk) score += 15;

  // =====================================
  // CONDITION
  // =====================================

  let condition = 'good';

  if (!isHeadOk)
    condition = 'head_forward';

  else if (!isShoulderOk)
    condition = 'shoulder_tilt';

  else if (!isNeckOk)
    condition = 'neck_tilt';

  else if (!isProximityOk)
    condition = 'too_close';

  return {
    score,
    isGood: score >= 75,
    condition,
    tip: TIPS[condition],

    metrics: {

      head: {
        ok: isHeadOk,
        label: isHeadOk
          ? `Selaras (${headOffsetRatio.toFixed(2)})`
          : `Maju (${headOffsetRatio.toFixed(2)})`
    },

      shoulder: {
        ok: isShoulderOk,
        label: isShoulderOk
          ? `Sejajar (${shoulderAngle.toFixed(0)}°)`
          : `Miring (${shoulderAngle.toFixed(0)}°)`
      },

      distance: {
        ok: isProximityOk,
        label: isProximityOk
          ? `Normal (${faceWidth.toFixed(2)})`
          : `Terlalu dekat (${faceWidth.toFixed(2)})`
      },

      tilt: {
        ok: isNeckOk,
        label: isNeckOk
          ? `Lurus ${neckDeviation.toFixed(0)}°`
          : `Miring ${neckDeviation.toFixed(0)}°`
      },
    }
  };
}