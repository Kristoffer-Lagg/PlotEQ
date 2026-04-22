// Parses UMIK-style microphone calibration files.
//
// Expected format:
//   Line 1 (header): "Sens Factor =-.0125dB, SERNO: 7048506"
//   Lines 2+: <Hz> <dB>  (space or tab separated)
//
// The calibration correction applied is:
//   corrected_db = measured_db - interpolated_cal_db - sens_factor_db
//
// Frequencies outside the cal file's range receive 0 dB correction.

export function parseCalFile(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let sensFactorDb = 0;
  let serialNo = '';
  const points = [];

  for (const line of lines) {
    // Header line contains "Sens Factor" keyword
    if (/sens/i.test(line)) {
      const sensMatch = line.match(/Sens\s+Factor\s*=\s*([-\d.]+)\s*dB/i);
      if (sensMatch) sensFactorDb = parseFloat(sensMatch[1]);
      const sernoMatch = line.match(/SERNO[:\s]+(\w+)/i);
      if (sernoMatch) serialNo = sernoMatch[1];
      continue;
    }
    const parts = line.split(/[\s,]+/);
    if (parts.length >= 2) {
      const freq = parseFloat(parts[0]);
      const db = parseFloat(parts[1]);
      if (isFinite(freq) && isFinite(db)) {
        points.push({ freq, db });
      }
    }
  }

  points.sort((a, b) => a.freq - b.freq);
  return { sensFactorDb, serialNo, points };
}

// Linear interpolation of the cal correction dB at a given frequency.
// Returns 0 dB (no correction) for frequencies outside the cal file range.
export function interpolateCal(calData, freq) {
  const { points } = calData;
  if (!points.length) return 0;
  if (freq <= points[0].freq || freq >= points[points.length - 1].freq) return 0;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].freq <= freq) lo = mid;
    else hi = mid;
  }
  const t = (freq - points[lo].freq) / (points[hi].freq - points[lo].freq);
  return points[lo].db + t * (points[hi].db - points[lo].db);
}

// Apply calibration to a curve [{freq, db}].
// corrected = measured - cal_correction - sens_factor
export function applyCalibration(curve, calData) {
  return curve.map(({ freq, db }) => {
    const correction = interpolateCal(calData, freq) + calData.sensFactorDb;
    return { freq, db: +(db - correction).toFixed(2) };
  });
}
