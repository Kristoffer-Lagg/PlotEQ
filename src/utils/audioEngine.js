// Real sine-sweep measurement engine.
//
// APPROACH: Farina log-sweep deconvolution.
//   1. Play a known exponential sine sweep x(t).
//   2. Record the system response y(t) = x(t) ⊗ h(t).
//   3. Deconvolve by convolving y with the Farina inverse sweep x⁻¹(t) → h(t).
//   4. Find the direct-sound peak of |h|, time-align it to t=0.
//   5. Window the IR to exclude late reflections.
//   6. FFT the windowed IR → |H(f)|; sample at log-spaced output bins.
//
// Returns raw dBFS values. Caller is responsible for display mapping and
// calibration correction.

import { fft, ifft, nextPow2 } from './fft.js';

const QUALITY_MAP = {
  '128k': { duration: 3 },
  '256k': { duration: 5 },
  '512k': { duration: 8 },
  '1M':   { duration: 12 },
  '2M':   { duration: 18 },
  '4M':   { duration: 25 },
};

// 2048 log-spaced output bins ≈ 205 points/octave. With 16× FFT zero-pad
// the native bin spacing is ~0.09 Hz at 48 kHz / 400 ms window, so every
// output point lands on distinct interpolated bins across the whole band.
// Recharts handles this point count per curve without perf issues.
const NUM_POINTS = 2048;
const SWEEP_DELAY = 0.05; // seconds of AudioContext warmup before sweep starts

// Generate Farina's inverse sweep: time-reversed forward exponential sweep,
// amplitude-modulated by exp(-t·L/T) to impose a 6 dB/octave attenuation.
// The modulation compensates for the fact that the forward log-sweep has a
// pink (-3 dB/oct) magnitude spectrum, so x(t) ⊗ x_inv(t) ≈ δ(t).
function generateInverseSweep(startHz, stopHz, duration, sampleRate) {
  const N   = Math.round(duration * sampleRate);
  const L   = Math.log(stopHz / startHz);
  const T   = duration;
  const inv = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t    = n / sampleRate;
    // Sample the forward sweep at mirrored time (T - t):
    const tFwd = T - t;
    const phase = 2 * Math.PI * startHz * T / L * (Math.exp(tFwd * L / T) - 1);
    // 6 dB/octave amplitude modulation (white/flat deconvolution result):
    const amp = Math.exp(-t * L / T);
    inv[n] = Math.sin(phase) * amp;
  }
  return inv;
}

// Linear convolution of two real-valued signals via FFT.
// Returns a Float64Array of length a.length + b.length - 1.
function fftConvolve(a, b) {
  const outLen = a.length + b.length - 1;
  const N      = nextPow2(outLen);
  const aRe = new Float64Array(N);
  const aIm = new Float64Array(N);
  const bRe = new Float64Array(N);
  const bIm = new Float64Array(N);
  for (let i = 0; i < a.length; i++) aRe[i] = a[i];
  for (let i = 0; i < b.length; i++) bRe[i] = b[i];
  fft(aRe, aIm);
  fft(bRe, bIm);
  // Element-wise complex multiply → store back in a
  for (let i = 0; i < N; i++) {
    const re = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    const im = aRe[i] * bIm[i] + aIm[i] * bRe[i];
    aRe[i] = re;
    aIm[i] = im;
  }
  ifft(aRe, aIm);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = aRe[i];
  return out;
}

// Find the direct-sound arrival in the impulse response.
//
// Naive "global max of |ir|" fails in lively rooms: a strong early floor or
// wall reflection 3-8 ms after the direct sound can exceed the direct
// arrival itself, and windowing centered on the reflection is wrong.
//
// REW-style detection instead:
//   1. Find the global max in the causal half (still our starting point —
//      deconvolution HD products are at negative time and are skipped).
//   2. Walk backwards up to 20 ms from the global max. The *earliest* local
//      maximum whose absolute value exceeds 20% of the global max is the
//      true direct arrival; anything larger in the 20 ms after it is a
//      reflection bouncing back into the mic.
//   3. Parabolic interpolation on the three samples around the peak gives
//      a sub-sample center for diagnostics and window alignment.
//
// Returns { peakIdx, subSample, globalIdx } — integer `peakIdx` is used for
// windowing (magnitude response is insensitive to sub-sample shifts, which
// only rotate phase). `subSample` is reported for diagnostics so we can see
// whether two sweeps center on the same sub-sample position.
function findDirectSoundPeak(ir, sampleRate) {
  const startScan = Math.floor(ir.length / 2);

  // 1. Global max in causal half.
  let globalIdx = startScan;
  let globalAbs = 0;
  for (let i = startScan; i < ir.length; i++) {
    const a = Math.abs(ir[i]);
    if (a > globalAbs) { globalAbs = a; globalIdx = i; }
  }

  // 2. Walk back up to 20 ms, earliest local peak above threshold wins.
  const threshold   = globalAbs * 0.2;
  const backSamples = Math.round(0.02 * sampleRate);
  const searchStart = Math.max(startScan + 1, globalIdx - backSamples);

  let peakIdx = globalIdx; // fallback if no earlier candidate qualifies
  for (let i = searchStart; i < globalIdx; i++) {
    const a  = Math.abs(ir[i]);
    const aL = Math.abs(ir[i - 1]);
    const aR = Math.abs(ir[i + 1]);
    if (a >= threshold && a >= aL && a >= aR) {
      peakIdx = i;
      break;
    }
  }

  // 3. Parabolic sub-sample refinement on |ir| around peakIdx.
  let subSample = peakIdx;
  if (peakIdx > 0 && peakIdx < ir.length - 1) {
    const y0 = Math.abs(ir[peakIdx - 1]);
    const y1 = Math.abs(ir[peakIdx]);
    const y2 = Math.abs(ir[peakIdx + 1]);
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const delta = 0.5 * (y0 - y2) / denom;
      if (Math.abs(delta) < 1) subSample = peakIdx + delta;
    }
  }

  return { peakIdx, subSample, globalIdx };
}

// Extract a time-windowed impulse response centered on the direct sound.
//
// Window shape (REW-style Tukey):
//
//   [ cos ramp-in | ---- peak ---- flat @ 1.0 ---- | cos fade-out ]
//     0 → 1 over      |                           |   1 → 0 over
//     `preSec`        |   `flatFrac` of tailSec   |  (1-flatFrac)
//                     |                           |   of tailSec
//
// Why a Tukey (flat middle, cosine edges) and not a half-Hann tail:
//
//   A half-Hann starting at 1.0 at the peak and falling to 0 at end-of-
//   tail is already at 0.5 (−6 dB) halfway through the tail. That's a
//   big attenuation applied to the reverberant decay of the IR — exactly
//   where room-mode energy lives. A 150 Hz mode with a typical 200–300 ms
//   RT60 still has substantial energy 100+ ms after the direct arrival;
//   the half-Hann quietly knocks 6+ dB off that, and the measured mode
//   peak under-reports the real mode peak by the same amount.
//
//   A Tukey with 75% flat preserves the first 300 ms of the tail (of a
//   400 ms window) at full amplitude and only cosine-tapers the last
//   100 ms. Room modes render at their true level; the cosine edge still
//   kills the spectral sidelobes a rectangular window would produce.
//
// Pre-peak: a cosine ramp-in (not linear) — same reasoning. Linear ramps
// have sinc-shaped spectral sidelobes that add subtle HF garbage; cosine
// ramps taper off cleanly.
function windowImpulseResponse(ir, peakIdx, sampleRate, tailSec = 1.5, flatFrac = 0.95) {
  const preSec      = 0.005;
  const preSamples  = Math.round(preSec * sampleRate);
  const tailSamples = Math.round(tailSec * sampleRate);
  const flatSamples = Math.round(tailSamples * flatFrac);
  const fadeSamples = Math.max(1, tailSamples - flatSamples);
  const outLen      = preSamples + tailSamples;
  const out         = new Float64Array(outLen);
  const startIdx    = peakIdx - preSamples;
  for (let i = 0; i < outLen; i++) {
    const srcIdx = startIdx + i;
    if (srcIdx < 0 || srcIdx >= ir.length) continue;
    let w;
    if (i < preSamples) {
      // Cosine ramp-in: 0 → 1 over the pre-peak region
      const k = i / preSamples;
      w = 0.5 * (1 - Math.cos(Math.PI * k));
    } else if (i < preSamples + flatSamples) {
      // Flat top — full-amplitude pass-through of the IR's reverberant decay
      w = 1;
    } else {
      // Cosine fade-out: 1 → 0 over the last (1 - flatFrac) of the tail
      const k = (i - preSamples - flatSamples) / (fadeSamples - 1 || 1);
      w = 0.5 * (1 + Math.cos(Math.PI * k));
    }
    out[i] = ir[srcIdx] * w;
  }
  return out;
}

// FFT the windowed IR, then sample |H(f)| at `numPoints` log-spaced output
// bins. Returns [{ freq, db }] in raw dBFS.
//
// Why the FFT is zero-padded by 8×:
//
//   Native-length FFT bin spacing = sampleRate / N_fft. For a 400 ms
//   window at 48 kHz that's ~2.5 Hz — fine at 10 kHz (0.025% of the
//   center frequency) but coarse at 25 Hz (10% of center). With 1024
//   log-spaced output points, the lowest points cluster within a single
//   native bin, producing a staircase that hides real LF structure.
//
//   Zero-padding the IR in time is mathematically equivalent to ideal
//   sinc (bandlimited) interpolation between FFT bins in frequency —
//   no new information is invented, but every continuous frequency
//   value we sample gets the correct interpolated result instead of a
//   linear blend across coarse bins. 8× pad takes bin spacing down to
//   ~0.3 Hz, fine enough that linear interpolation between adjacent
//   padded bins is visually indistinguishable from sinc-exact.
//
// Interpolation is now done on the complex bins (Re / Im separately,
// magnitude last). Interpolating magnitude directly was the old bug: it
// discards phase, so when two adjacent bins had similar |H| but opposite
// phases the interpolated magnitude under-reported the true value.
function magnitudeResponse(windowedIR, numPoints, startHz, stopHz, sampleRate) {
  const PAD = 16;
  const N   = nextPow2(windowedIR.length * PAD);
  const re  = new Float64Array(N);
  const im  = new Float64Array(N);
  for (let i = 0; i < windowedIR.length; i++) re[i] = windowedIR[i];
  fft(re, im);

  const logStart = Math.log10(startHz);
  const logStop  = Math.log10(stopHz);
  const binHz    = sampleRate / N;
  const curve = [];
  for (let p = 0; p < numPoints; p++) {
    const t    = p / (numPoints - 1);
    const freq = Math.pow(10, logStart + (logStop - logStart) * t);
    const bin  = freq / binHz;
    const k0   = Math.max(0, Math.min(Math.floor(bin), N / 2 - 2));
    const k1   = k0 + 1;
    const frac = bin - k0;
    // Complex-domain linear interpolation, then magnitude.
    const reI  = re[k0] + frac * (re[k1] - re[k0]);
    const imI  = im[k0] + frac * (im[k1] - im[k0]);
    const mag  = Math.sqrt(reI * reI + imI * imI);
    const db   = 20 * Math.log10(Math.max(mag, 1e-20));
    curve.push({ freq: +freq.toFixed(2), db: +db.toFixed(2) });
  }
  return curve;
}

export function createSweep({ startHz, stopHz, volumeDb, quality, deviceId, onProgress }) {
  const controller = { cancelled: false };
  let cleanupFn = () => {};

  const promise = (async () => {
    const { duration } = QUALITY_MAP[quality] || QUALITY_MAP['512k'];
    const safeStart = Math.max(1, startHz);
    const safeStop  = Math.max(safeStart + 1, stopHz);

    // ── Mic permission ──────────────────────────────────────────────────────
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });

    if (controller.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('cancelled');
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtor();
    if (ctx.state === 'suspended') await ctx.resume();
    const sampleRate = ctx.sampleRate;

    // ── Mic → recorder (ScriptProcessorNode) ────────────────────────────────
    const micSource = ctx.createMediaStreamSource(stream);
    const recorder  = ctx.createScriptProcessor(2048, 1, 1);
    const chunks    = [];
    recorder.onaudioprocess = (e) => {
      if (!controller.cancelled) {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
    };
    // Route recorder through a silenced gain so it fires without sending
    // mic audio back to the speakers (which would cause feedback).
    const silencer = ctx.createGain();
    silencer.gain.value = 0;
    micSource.connect(recorder);
    recorder.connect(silencer);
    silencer.connect(ctx.destination);

    // ── Sweep oscillator → speakers ──────────────────────────────────────────
    const osc  = ctx.createOscillator();
    osc.type   = 'sine';
    const gain = ctx.createGain();
    const linearGain = Math.pow(10, (volumeDb - 20) / 20);
    osc.connect(gain);
    gain.connect(ctx.destination);

    const sweepStart = ctx.currentTime + SWEEP_DELAY;
    osc.frequency.setValueAtTime(safeStart, sweepStart);
    osc.frequency.exponentialRampToValueAtTime(safeStop, sweepStart + duration);
    gain.gain.setValueAtTime(0, sweepStart);
    gain.gain.linearRampToValueAtTime(linearGain, sweepStart + 0.05);
    gain.gain.setValueAtTime(linearGain, sweepStart + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, sweepStart + duration);
    osc.start(sweepStart);
    osc.stop(sweepStart + duration + 0.1);

    cleanupFn = () => {
      try { osc.stop(); }    catch {}
      try { osc.disconnect(); }      catch {}
      try { gain.disconnect(); }     catch {}
      try { recorder.disconnect(); } catch {}
      try { micSource.disconnect(); }catch {}
      try { silencer.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };

    // ── Wait for sweep to finish (report progress 0–95%) ───────────────────
    const totalWait = SWEEP_DELAY + duration + 0.2;
    await new Promise((resolve, reject) => {
      const wallStart = performance.now();
      let raf;
      const tick = () => {
        if (controller.cancelled) { reject(new Error('cancelled')); return; }
        const elapsed = (performance.now() - wallStart) / 1000;
        onProgress?.(Math.min(94, (elapsed / totalWait) * 94));
        if (elapsed >= totalWait) { resolve(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      controller._cancelRaf = () => cancelAnimationFrame(raf);
    });

    if (controller.cancelled) throw new Error('cancelled');

    // ── Flatten recording buffer ─────────────────────────────────────────────
    const totalSamples = Math.ceil(totalWait * sampleRate);
    const recording = new Float32Array(totalSamples);
    let filled = 0;
    for (const chunk of chunks) {
      const n = Math.min(chunk.length, totalSamples - filled);
      if (n <= 0) break;
      recording.set(chunk.subarray(0, n), filled);
      filled += n;
    }

    // Diagnostic
    let peak = 0;
    for (let i = 0; i < filled; i++) if (Math.abs(recording[i]) > peak) peak = Math.abs(recording[i]);
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    // eslint-disable-next-line no-console
    console.log(`[PlotEQ] volume=${volumeDb}dB  peak=${peakDb.toFixed(1)} dBFS  recorded=${filled} samples`);

    // ── Farina deconvolution pipeline (progress 95–100%) ───────────────────
    // Each step yields to the event loop so the progress bar updates.
    const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

    onProgress?.(95);
    await yieldToUI();
    if (controller.cancelled) throw new Error('cancelled');

    // 1. Generate Farina's inverse sweep x⁻¹(t)
    const invSweep = generateInverseSweep(safeStart, safeStop, duration, sampleRate);

    onProgress?.(96);
    await yieldToUI();
    if (controller.cancelled) throw new Error('cancelled');

    // 2. Deconvolve: y ⊗ x⁻¹ = h  (linear convolution via FFT)
    const rec = recording.subarray(0, filled);
    const ir  = fftConvolve(rec, invSweep);

    // Farina normalization: (x ⊗ x⁻¹) for our sweep has a theoretical delta
    // peak of fs·T/(2L). Dividing through rescales the IR so that a unity-
    // gain system (y = x) would yield |h(peak)| = 1, i.e. |H(f)| = 0 dBFS.
    // Real speaker+room+mic chains sit well below 0 dBFS, landing naturally
    // in the display range.
    const farinaDelta = sampleRate * duration / (2 * Math.log(safeStop / safeStart));
    for (let i = 0; i < ir.length; i++) ir[i] /= farinaDelta;

    onProgress?.(98);
    await yieldToUI();
    if (controller.cancelled) throw new Error('cancelled');

    // 3. Find direct-sound arrival, 4. window out late reflections
    const { peakIdx, subSample, globalIdx } = findDirectSoundPeak(ir, sampleRate);
    const windowedIR = windowImpulseResponse(ir, peakIdx, sampleRate);

    // Diagnostic: IR peak level, direct-arrival time, and how far the
    // strongest sample in the IR lies beyond the chosen direct peak.
    // If globalIdx is many ms after peakIdx, that "stronger" sample is a
    // reflection — the robust detector correctly preferred the earlier
    // true direct arrival.
    const irPeakAbs = Math.abs(ir[peakIdx]);
    const irPeakDb  = irPeakAbs > 0 ? 20 * Math.log10(irPeakAbs) : -Infinity;
    const reflMs    = ((globalIdx - peakIdx) / sampleRate) * 1000;
    // eslint-disable-next-line no-console
    console.log(
      `[PlotEQ] IR direct=${irPeakDb.toFixed(1)} dB at sample ${peakIdx} ` +
      `(sub=${subSample.toFixed(2)}, t=${(peakIdx / sampleRate).toFixed(3)}s) ` +
      `· strongest sample is ${reflMs >= 0 ? '+' : ''}${reflMs.toFixed(1)} ms ` +
      `later at ${globalIdx}`
    );

    onProgress?.(99);
    await yieldToUI();
    if (controller.cancelled) throw new Error('cancelled');

    // 5. FFT the windowed IR, 6. sample |H(f)| at log-spaced output bins
    const curve = magnitudeResponse(windowedIR, NUM_POINTS, safeStart, safeStop, sampleRate);

    cleanupFn();
    onProgress?.(100);
    return curve; // raw dBFS — caller applies calibration + display mapping
  })();

  return {
    promise,
    cancel: () => {
      controller.cancelled = true;
      controller._cancelRaf?.();
      cleanupFn();
    },
  };
}
