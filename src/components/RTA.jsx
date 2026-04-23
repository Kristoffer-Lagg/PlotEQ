import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { createPinkNoisePlayer } from '../utils/pinkNoise.js';
import { applySmoothing } from '../utils/smoothing.js';
import { parseCalFile, applyCalibration } from '../utils/calParser.js';

// Axis ticks identical to PlotArea so the two views look interchangeable.
const TICKS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const fmtHz = (v) => {
  if (v === 20000) return '20k Hz';
  if (v >= 1000)   return `${v / 1000}k`;
  return `${v}`;
};

// AnalyserNode FFT size. 16384 @ 48 kHz → ~3 Hz linear bin spacing;
// the log-spaced 512 display points are resampled from these bins.
const FFT_SIZE    = 16384;
const NUM_POINTS  = 512;
const UPDATE_HZ   = 10;  // redraws per second

const STORAGE_MIC_KEY = 'ploteq:mic:last';
const calStorageKey   = (label) => `ploteq:cal:${label}`;

// Standard IEC A / C weighting curves (dB). Used only for the SPL readouts.
function aWeighting(f) {
  const f2  = f * f;
  const num = 12194 ** 2 * f2 * f2;
  const den = (f2 + 20.6 ** 2)
            * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2))
            * (f2 + 12194 ** 2);
  return 20 * Math.log10(num / den) + 2.0;
}
function cWeighting(f) {
  const f2  = f * f;
  const num = 12194 ** 2 * f2;
  const den = (f2 + 20.6 ** 2) * (f2 + 12194 ** 2);
  return 20 * Math.log10(num / den) + 0.06;
}

export default function RTA({ smoothing, onSaveMeasurement }) {
  const [running, setRunning] = useState(false);
  const [mode, setMode]       = useState('live');   // 'live' | 'rec' | 'stopped'
  const [genOn, setGenOn]     = useState(false);
  const [genVol, setGenVol]   = useState(-20);
  const [curve, setCurve]     = useState([]);
  const [spl, setSpl]         = useState({ z: 0, a: 0, c: 0 });
  const [recTime, setRecTime] = useState(0);
  const [error, setError]     = useState(null);

  // Refs for audio resources so we can tear them down cleanly.
  const audioCtxRef   = useRef(null);
  const analyserRef   = useRef(null);
  const streamRef     = useRef(null);
  const genRef        = useRef(null);
  const rafRef        = useRef(null);
  const calRef        = useRef(null);

  // Forever-average accumulator. Summing LINEAR POWER (|H|²), not dB values —
  // matches REW's RMS-power averaging and is what's physically correct.
  const accumRef      = useRef(null);    // Float64Array(NUM_POINTS)
  const accumCountRef = useRef(0);
  const recStartRef   = useRef(0);

  // Mirror mode into a ref so the rAF loop reads the current value without
  // requiring the loop to be re-created on every mode flip.
  const modeRef = useRef('live');
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Log-spaced display frequency grid — built once.
  const freqGrid = useMemo(() => {
    const arr = new Float64Array(NUM_POINTS);
    const a   = Math.log10(20);
    const b   = Math.log10(20000);
    for (let i = 0; i < NUM_POINTS; i++) {
      arr[i] = Math.pow(10, a + (b - a) * (i / (NUM_POINTS - 1)));
    }
    return arr;
  }, []);

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    genRef.current?.dispose();
    genRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    calRef.current      = null;
    setRunning(false);
    setGenOn(false);
    setMode('live');
    setRecTime(0);
    setCurve([]);
    setSpl({ z: 0, a: 0, c: 0 });
  }, []);

  // Release mic when component unmounts (tab switch away).
  useEffect(() => teardown, [teardown]);

  const startEngine = useCallback(async () => {
    if (running) return true;
    setError(null);
    try {
      const lastMic = localStorage.getItem(STORAGE_MIC_KEY) || undefined;
      const stream  = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: lastMic ? { exact: lastMic } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
        },
      });
      streamRef.current = stream;

      // Look up saved cal for this mic.
      try {
        const all   = await navigator.mediaDevices.enumerateDevices();
        const track = stream.getAudioTracks()[0];
        const id    = track?.getSettings().deviceId;
        const mic   = all.find((d) => d.kind === 'audioinput' && d.deviceId === id);
        const label = mic?.label;
        if (label) {
          const raw = localStorage.getItem(calStorageKey(label));
          if (raw) {
            const { content } = JSON.parse(raw);
            calRef.current = parseCalFile(content);
          }
        }
      } catch {}

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;

      const src      = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize               = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      src.connect(analyser);
      analyserRef.current = analyser;

      genRef.current = createPinkNoisePlayer(ctx);
      genRef.current.setVolumeDb(genVol);

      accumRef.current      = new Float64Array(NUM_POINTS);
      accumCountRef.current = 0;
      setRunning(true);
      startLoop();
      return true;
    } catch (err) {
      setError(err?.message || 'Could not access microphone.');
      return false;
    }
  }, [genVol, running]);

  const startLoop = useCallback(() => {
    let lastTick  = 0;
    const frameMs = 1000 / UPDATE_HZ;
    const fftBins = new Float32Array(FFT_SIZE / 2);

    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastTick < frameMs) return;
      lastTick = now;

      // In stopped (held) mode we don't touch the curve or SPL — the user is
      // inspecting the frozen average and deciding whether to Save.
      if (modeRef.current === 'stopped') return;

      const analyser = analyserRef.current;
      const ctx      = audioCtxRef.current;
      if (!analyser || !ctx) return;

      analyser.getFloatFrequencyData(fftBins); // dBFS per linear bin

      // Resample linear bins → log-spaced display points.
      //
      // POWER SUM (not max, not mean): convert each bin's dB to linear power,
      // sum all bins that fall inside the display cell's band, convert back
      // to dB. This is the physically correct operation for noise-like
      // signals and matches REW's RTA semantics.
      //
      // Why sum (and why not max): at high frequencies a log-spaced display
      // cell can span 50+ linear bins, each carrying a tiny slice of a
      // broadband signal. Max-of-bins would report a much lower value than
      // the total power actually in the band. Sum gets it right — pink noise
      // into a flat system produces a flat line on the log display, which is
      // the whole point of using pink noise for RTA.
      //
      // For narrowband peaks (room modes), sum still works: the peak bin
      // dominates the sum, so room modes remain visible at their true level.
      //
      // For cells narrower than one FFT bin (low frequencies), we fall back
      // to picking the single bin nearest the center frequency — avoids
      // divide-by-zero from empty bin ranges.
      const binHz   = ctx.sampleRate / FFT_SIZE;
      const display = new Float64Array(NUM_POINTS);
      for (let i = 0; i < NUM_POINTS; i++) {
        const f   = freqGrid[i];
        const fLo = i === 0 ? f : Math.sqrt(f * freqGrid[i - 1]);
        const fHi = i === NUM_POINTS - 1 ? f : Math.sqrt(f * freqGrid[i + 1]);
        const kLo = Math.max(0, Math.floor(fLo / binHz));
        const kHi = Math.min(fftBins.length - 1, Math.ceil(fHi / binHz));
        if (kHi < kLo) {
          // Cell narrower than one bin — nearest-bin fallback.
          const k = Math.max(0, Math.min(fftBins.length - 1, Math.round(f / binHz)));
          display[i] = fftBins[k];
        } else {
          let sumP = 0;
          for (let k = kLo; k <= kHi; k++) {
            sumP += Math.pow(10, fftBins[k] / 10);
          }
          display[i] = 10 * Math.log10(Math.max(sumP, 1e-30));
        }
      }

      // Forever-average: accumulate linear power, divide by count at readout.
      let out;
      if (modeRef.current === 'rec' && accumRef.current) {
        const accum = accumRef.current;
        accumCountRef.current++;
        for (let i = 0; i < NUM_POINTS; i++) {
          accum[i] += Math.pow(10, display[i] / 10);
        }
        out = new Array(NUM_POINTS);
        for (let i = 0; i < NUM_POINTS; i++) {
          const avgP = accum[i] / accumCountRef.current;
          out[i] = { freq: +freqGrid[i].toFixed(2), db: 10 * Math.log10(Math.max(avgP, 1e-30)) };
        }
        setRecTime((performance.now() - recStartRef.current) / 1000);
      } else {
        out = new Array(NUM_POINTS);
        for (let i = 0; i < NUM_POINTS; i++) {
          out[i] = { freq: +freqGrid[i].toFixed(2), db: display[i] };
        }
      }

      // Apply mic calibration in raw dBFS space, then map to plot's [20, 100]
      // display range.
      //
      // Sweep measurements use +120. RTA uses +140 — a 20 dB bump that
      // compensates for the reference-level mismatch between a deconvolved
      // transfer function (sweep) and a per-bin windowed FFT magnitude (RTA):
      //   * FFT bins are normalized by N (FFT length) — ~13 dB loss vs IR FFT
      //   * AnalyserNode's Blackman window costs ~2.5 dB of noise bandwidth
      //   * Power is distributed across multiple bins per display cell in RTA
      //     but concentrated in the IR magnitude for sweep
      // The empirical gap observed on a matching-room measurement is ~20 dB,
      // so +140 brings pink-noise-through-speaker RTA onto the same scale as
      // the sweep of that same speaker.
      if (calRef.current) out = applyCalibration(out, calRef.current);
      out = out.map(({ freq, db }) => ({
        freq,
        db: +Math.max(20, Math.min(100, db + 140)).toFixed(2),
      }));
      setCurve(out);

      // SPL readout — power-integrate the full FFT within 20 Hz–20 kHz.
      let zP = 0, aP = 0, cP = 0;
      for (let k = 1; k < fftBins.length; k++) {
        const f = k * binHz;
        if (f < 20 || f > 20000) continue;
        const p = Math.pow(10, fftBins[k] / 10);
        zP += p;
        aP += p * Math.pow(10, aWeighting(f) / 10);
        cP += p * Math.pow(10, cWeighting(f) / 10);
      }
      // Same +120 dB offset as the curve display so the numbers agree.
      const toSpl = (p) => 10 * Math.log10(Math.max(p, 1e-30)) + 120;
      setSpl({ z: +toSpl(zP).toFixed(1), a: +toSpl(aP).toFixed(1), c: +toSpl(cP).toFixed(1) });
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [freqGrid]);

  // Button handlers ---------------------------------------------------------
  const onLive = async () => {
    if (!running) { await startEngine(); return; }
    // Leaving stopped/held state back to live — discard the frozen average.
    setMode('live');
  };

  // Rec button state machine:
  //   live      → rec       (start fresh recording)
  //   rec       → stopped   (freeze the current average on screen)
  //   stopped   → rec       (start a NEW recording, old frozen data discarded)
  //
  // This lets the user record, inspect the result, then decide to Save it
  // OR start a fresh recording by tapping Rec again, all without touching
  // the Live or Save buttons.
  const onRec = async () => {
    const ok = running || (await startEngine());
    if (!ok) return;
    if (modeRef.current === 'rec') {
      // Stop and hold the current average on screen.
      setMode('stopped');
      return;
    }
    // Start (or re-start) a recording — reset accumulator.
    accumRef.current      = new Float64Array(NUM_POINTS);
    accumCountRef.current = 0;
    recStartRef.current   = performance.now();
    setRecTime(0);
    setMode('rec');
  };

  const onSave = () => {
    if (!curve.length) return;
    onSaveMeasurement(curve);
  };

  const onToggleGen = async () => {
    const ok = running || (await startEngine());
    if (!ok) return;
    if (genOn) genRef.current?.stop();
    else       genRef.current?.start();
    setGenOn(!genOn);
  };

  const onGenVol = (v) => {
    setGenVol(v);
    genRef.current?.setVolumeDb(v);
  };

  // Post-process with the same smoothing mode selected for the main plot.
  const displayCurve = useMemo(
    () => (smoothing && smoothing !== 'none' ? applySmoothing(curve, smoothing) : curve),
    [curve, smoothing]
  );

  // Render ------------------------------------------------------------------
  const btnBase = 'px-4 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase rounded-sm transition-all';
  const btnActive = 'bg-sky-500 text-zinc-950 shadow-[0_0_20px_-6px_rgba(56,189,248,0.85)] hover:bg-sky-400';
  const btnIdle   = 'bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-300';
  const recActive = 'bg-red-500 text-zinc-950 shadow-[0_0_20px_-6px_rgba(248,113,113,0.85)] hover:bg-red-400';
  const recHeld   = 'bg-red-900/40 border border-red-500/40 text-red-300 hover:bg-red-900/60';

  // Rec button label tracks the state machine:
  //   rec:     "● STOP 12.3s"   (active red — tap to freeze)
  //   stopped: "■ HELD 12.3s"   (dim red — tap to start fresh)
  //   live:    "Rec"            (idle gray — tap to start)
  const recLabel = mode === 'rec'
    ? `● STOP ${recTime.toFixed(1)}s`
    : mode === 'stopped'
    ? `■ HELD ${recTime.toFixed(1)}s`
    : 'Rec';

  return (
    <div className="flex-1 min-w-0 h-full bg-zinc-950 flex flex-col">

      {/* Live plot */}
      <div className="relative flex-1 min-h-0">
        {running && curve.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayCurve} margin={{ top: 10, right: 20, left: -10, bottom: 6 }}>
                <CartesianGrid stroke="#18181b" strokeDasharray="2 4" />
                <XAxis
                  dataKey="freq"
                  type="number"
                  scale="log"
                  domain={[20, 20000]}
                  allowDataOverflow={true}
                  ticks={TICKS}
                  tickFormatter={fmtHz}
                  stroke="#3f3f46"
                  tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                />
                <YAxis
                  dataKey="db"
                  domain={[20, 100]}
                  allowDataOverflow={true}
                  ticks={[20, 30, 40, 50, 60, 70, 80, 90, 100]}
                  tickFormatter={(v) => (v === 100 ? '100 dB' : `${v}`)}
                  stroke="#3f3f46"
                  tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                />
                <Tooltip
                  isAnimationActive={false}
                  contentStyle={{
                    background: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: '2px',
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    color: '#f4f4f5',
                  }}
                  labelStyle={{ color: '#71717a', fontSize: 10, letterSpacing: '0.15em' }}
                  labelFormatter={(v) => `${fmtHz(v)} HZ`}
                />
                <Line
                  type="linear"
                  dataKey="db"
                  name={
                    mode === 'rec' ? 'Recording' :
                    mode === 'stopped' ? 'Held' : 'Live'
                  }
                  stroke={mode === 'live' ? '#38bdf8' : '#f87171'}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* SPL readout overlay, top-right */}
            <div className="absolute top-2 right-4 text-right font-mono pointer-events-none">
              <div className="text-[18px] leading-tight text-sky-400 tracking-tight">
                {spl.z.toFixed(1)} <span className="text-[10px] text-zinc-500">dB SPL</span>
              </div>
              <div className="text-[10px] text-zinc-500 tracking-tight">
                A {spl.a.toFixed(1)} · C {spl.c.toFixed(1)}
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] tracking-[0.2em] uppercase text-center px-8">
            {error ? (
              <span className="text-red-400">{error}</span>
            ) : (
              <>Tap <span className="text-sky-400 mx-1">Live</span> to start the real-time analyzer</>
            )}
          </div>
        )}
      </div>

      {/* Controls strip */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-5 py-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={onLive}
          className={`${btnBase} ${mode === 'live' && running ? btnActive : btnIdle}`}
        >
          Live
        </button>
        <button
          onClick={onRec}
          className={`${btnBase} ${
            mode === 'rec' ? recActive : mode === 'stopped' ? recHeld : btnIdle
          }`}
        >
          {recLabel}
        </button>
        <button
          onClick={onSave}
          disabled={!curve.length}
          className={`${btnBase} ${btnIdle} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Save
        </button>

        {/* Generator */}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={onToggleGen}
            className={`${btnBase} ${genOn ? btnActive : btnIdle}`}
            title="Stereo random pink noise"
          >
            {genOn ? '♪ Pink ON' : '♪ Pink'}
          </button>
          <div className="flex items-center gap-2 min-w-[180px]">
            <span className="text-[9px] font-bold tracking-[0.25em] uppercase text-zinc-600 shrink-0">Vol</span>
            <input
              type="range"
              min={-40}
              max={0}
              value={genVol}
              onChange={(e) => onGenVol(+e.target.value)}
              className="flex-1 accent-sky-500"
            />
            <span className="text-[11px] font-mono text-sky-400 tabular-nums w-10 text-right">
              {genVol} dB
            </span>
          </div>

          {running && (
            <button
              onClick={teardown}
              className="text-zinc-600 hover:text-red-400 text-xs px-2 transition-colors"
              title="Release microphone"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
