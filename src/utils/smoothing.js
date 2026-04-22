// Frequency-response smoothing — aligned with REW's algorithms.
//
// Reference: https://www.roomeqwizard.com/help/help_en-GB/html/graph.html
//
// Modes:
//   * Fractional-octave (1/48 ... 1/1, plus 1/2):
//       Gaussian kernel in log-frequency whose FWHM equals the chosen
//       octave fraction.
//   * Var (Variable) — recommended for EQ work:
//       1/48 oct below 100 Hz
//       1/6 oct at 1 kHz
//       1/3 oct above 10 kHz
//       log-interpolated between anchors.
//   * Psy (Psychoacoustic) — perceptual listening correlation:
//       1/3 below 100 Hz
//       1/6 above 1 kHz
//       log-interpolated between.
//       Uses *cubic mean* (cube root of weighted mean of cubed values)
//       so peaks carry slightly more weight than the arithmetic mean
//       would give — matches the ear's tendency to latch onto peaks.
//   * ERB (Equivalent Rectangular Bandwidth) — critical-band match:
//       Bandwidth B(f) = 107.77·f_kHz + 24.673 Hz, converted to a
//       per-point octave fraction. Heavy LF smoothing (≈1 oct at 50 Hz),
//       tightening to ≈1/6 oct above 1 kHz.
//
// Implementation note:
//   REW uses multiple forward/backward IIR passes (Alvarez-Mazorra) for
//   O(n) cost. We do direct Gaussian convolution — simpler to verify,
//   and at 2048 output points with radius ~3σ (max ~260 samples for the
//   1/1-oct kernel) this is well under a millisecond per curve.
//
//   The output grid is log-spaced in frequency, so sample indices map
//   linearly to log-frequency. The Gaussian kernel operates on indices
//   directly, giving a true log-frequency Gaussian.

// FWHM → sigma conversion for a Gaussian: sigma = FWHM / (2·√(2·ln 2)).
const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.log(2))); // ≈ 0.4246609

function gridInfo(curve) {
  const n = curve.length;
  if (n < 2) return { n, pointsPerOct: 0 };
  const totalOct = Math.log2(curve[n - 1].freq / curve[0].freq);
  const pointsPerOct = (n - 1) / totalOct;
  return { n, pointsPerOct };
}

function sigmaForFraction(N, pointsPerOct) {
  // FWHM in *samples* is (points/oct) / N. Convert FWHM to sigma.
  return (pointsPerOct / N) * FWHM_TO_SIGMA;
}

// Constant-fraction Gaussian smoothing (arithmetic mean).
function smoothConstantFraction(curve, N) {
  const { n, pointsPerOct } = gridInfo(curve);
  if (n < 2) return curve;
  const sigma = sigmaForFraction(N, pointsPerOct);
  if (sigma < 0.25) return curve; // sub-sample width → no-op
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const twoSigmaSq = 2 * sigma * sigma;

  // Precompute kernel (constant width → reuse per point)
  const kernel = new Float64Array(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-(k * k) / twoSigmaSq);
  }

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    const kLo = Math.max(-radius, -i);
    const kHi = Math.min(radius, n - 1 - i);
    for (let k = kLo; k <= kHi; k++) {
      const w = kernel[k + radius];
      sum  += w * curve[i + k].db;
      wsum += w;
    }
    out[i] = { freq: curve[i].freq, db: +(sum / wsum).toFixed(2) };
  }
  return out;
}

// Variable-fraction Gaussian smoothing. `fractionAt(f)` returns the 1/N
// value at a given frequency. If `cubic`, use cubic mean instead of arith.
function smoothVariableFraction(curve, fractionAt, cubic = false) {
  const { n, pointsPerOct } = gridInfo(curve);
  if (n < 2) return curve;
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    const f = curve[i].freq;
    const N = fractionAt(f);
    const sigma = sigmaForFraction(N, pointsPerOct);
    if (sigma < 0.25) {
      // Kernel narrower than one sample → effectively no smoothing here.
      out[i] = { freq: f, db: curve[i].db };
      continue;
    }
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const twoSigmaSq = 2 * sigma * sigma;

    let sum = 0, wsum = 0;
    const kLo = Math.max(-radius, -i);
    const kHi = Math.min(radius, n - 1 - i);
    for (let k = kLo; k <= kHi; k++) {
      const w = Math.exp(-(k * k) / twoSigmaSq);
      const d = curve[i + k].db;
      sum  += cubic ? w * d * d * d : w * d;
      wsum += w;
    }
    const v = cubic ? Math.cbrt(sum / wsum) : sum / wsum;
    out[i] = { freq: f, db: +v.toFixed(2) };
  }
  return out;
}

// REW Var: 1/48 <100Hz → 1/6 at 1kHz → 1/3 >10kHz, log-interpolated.
function varFractionAt(f) {
  if (f <= 100)    return 48;
  if (f <= 1000)   return 48 * Math.pow(6 / 48, Math.log10(f) - 2);
  if (f <= 10000)  return 6  * Math.pow(3 / 6,  Math.log10(f) - 3);
                    return 3;
}

// REW Psy: 1/3 <100Hz → 1/6 >1kHz, log-interpolated.
function psyFractionAt(f) {
  if (f <= 100)  return 3;
  if (f <= 1000) return 3 * Math.pow(6 / 3, Math.log10(f) - 2);
                  return 6;
}

// ERB: bandwidth B(f) = 107.77·f_kHz + 24.673 Hz → octave fraction.
function erbFractionAt(f) {
  const fKHz = f / 1000;
  const bw   = 107.77 * fKHz + 24.673;
  const fHi  = f + bw / 2;
  const fLo  = Math.max(1, f - bw / 2); // guard against very LF div-zero
  const oct  = Math.log2(fHi / fLo);
  return 1 / Math.max(oct, 0.005);
}

export const SMOOTHING_MODES = [
  { value: 'none', label: 'None' },
  { value: '48',   label: '1/48' },
  { value: '24',   label: '1/24' },
  { value: '12',   label: '1/12' },
  { value: '6',    label: '1/6'  },
  { value: '3',    label: '1/3'  },
  { value: '2',    label: '1/2'  },
  { value: '1',    label: '1/1'  },
  { value: 'var',  label: 'Var'  },
  { value: 'psy',  label: 'Psy'  },
  { value: 'erb',  label: 'ERB'  },
];

export function applySmoothing(curve, mode) {
  if (!curve || !Array.isArray(curve) || curve.length === 0) return curve;
  if (!mode || mode === 'none') return curve;
  if (mode === 'var')                       return smoothVariableFraction(curve, varFractionAt, false);
  if (mode === 'psy' || mode === 'psycho')  return smoothVariableFraction(curve, psyFractionAt, true);
  if (mode === 'erb')                       return smoothVariableFraction(curve, erbFractionAt, false);
  const fraction = parseInt(mode, 10);
  if (!fraction || Number.isNaN(fraction)) return curve;
  return smoothConstantFraction(curve, fraction);
}
