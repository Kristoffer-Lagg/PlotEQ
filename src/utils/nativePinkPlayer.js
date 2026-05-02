import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the PinkPlayer Capacitor plugin (android/app/src/main/java/.../PinkPlayerPlugin.java).
// Generates pink noise on a native AudioTrack with USAGE_MEDIA so
// Samsung's WebView can't attenuate output when the mic is concurrently
// open — that attenuation was ducking pink noise to inaudible levels.
const PinkPlayer = registerPlugin('PinkPlayer');

/**
 * Returns true if the native pink-noise player is available (i.e.
 * we're running inside a Capacitor APK with the PinkPlayer plugin
 * registered).
 */
export function nativePinkPlayerAvailable() {
  return Capacitor?.isNativePlatform?.() ?? false;
}

/**
 * Same surface as createPinkNoisePlayer() in pinkNoise.js so the RTA
 * code can swap it in transparently:
 *   start(), stop(), setVolumeDb(db), isRunning(), dispose()
 *
 * The audioCtx argument is accepted but ignored — native output
 * doesn't go through Web Audio at all (which is the whole point).
 */
export function createNativePinkPlayer() {
  let running = false;
  return {
    async start() {
      if (running) return;
      try {
        await PinkPlayer.start();
        running = true;
      } catch (err) {
        console.error('PinkPlayer.start failed:', err);
      }
    },
    async stop() {
      if (!running) return;
      try { await PinkPlayer.stop(); } catch {}
      running = false;
    },
    async setVolumeDb(db) {
      // Convert dB to linear (0..1). AudioTrack.setVolume clamps anyway.
      const linear = Math.min(1, Math.max(0, Math.pow(10, db / 20)));
      try {
        await PinkPlayer.setVolume({ volume: linear });
      } catch {}
    },
    isRunning() { return running; },
    async dispose() {
      await this.stop();
    },
  };
}
