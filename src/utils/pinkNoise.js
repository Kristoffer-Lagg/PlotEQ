// Stereo random pink noise generator for Web Audio.
//
// Pink noise = white noise shaped at −3 dB/octave. Each octave carries equal
// power, which matches how the ear hears "flat" — a pink-noise-excited room
// gives a long-term spectrum that you can directly compare to a target curve.
//
// Algorithm: Paul Kellet's 6-pole IIR filter on white noise. Accurate to
// ±0.5 dB from ~10 Hz to 22 kHz — indistinguishable from ideal pink noise
// for any room-acoustics purpose.
//
// Implementation: we pre-generate a 10-second stereo buffer and loop it via
// AudioBufferSourceNode. Strictly speaking this makes the noise "periodic"
// with a 10 s period, but by definition pink noise has no tonal content that
// could give the seam away, and 10 s is much longer than any room's ring-
// down, so the statistics over any useful averaging window are identical to
// truly random pink noise. Trade: ~4 MB of buffer memory in exchange for
// zero runtime CPU and no AudioWorklet plumbing.
//
// Each channel gets an independent white-noise seed so the output is truly
// stereo (decorrelated L/R), which helps excite the room more uniformly than
// a mono signal played through both speakers.

function fillPinkChannel(data) {
  // Paul Kellet coefficients
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616  * b5 - white * 0.0168980;
    // 0.11 scales the raw filter output to roughly unit RMS
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

export function createPinkNoisePlayer(audioCtx, durationSec = 10) {
  const sampleRate = audioCtx.sampleRate;
  const frames    = Math.round(sampleRate * durationSec);
  const buffer    = audioCtx.createBuffer(2, frames, sampleRate);
  fillPinkChannel(buffer.getChannelData(0));
  fillPinkChannel(buffer.getChannelData(1));

  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  gain.connect(audioCtx.destination);

  let source = null;

  return {
    start() {
      if (source) return;
      source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.loop   = true;
      source.connect(gain);
      source.start();
    },
    stop() {
      if (!source) return;
      try { source.stop(); } catch {}
      source.disconnect();
      source = null;
    },
    setVolumeDb(db) {
      // Short ramp to avoid clicks when dragging the slider
      const target = Math.pow(10, db / 20);
      const t      = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(target, t + 0.04);
    },
    isRunning() { return !!source; },
    dispose() {
      this.stop();
      try { gain.disconnect(); } catch {}
    },
  };
}
