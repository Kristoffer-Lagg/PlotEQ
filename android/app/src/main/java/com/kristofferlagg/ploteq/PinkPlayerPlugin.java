package com.kristofferlagg.ploteq;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Random;

/**
 * PinkPlayer — native pink-noise generator + AudioTrack output.
 *
 * Bypasses Web Audio so Samsung's WebView doesn't attenuate output
 * when the mic is open concurrently. The AudioTrack is configured
 * with USAGE_MEDIA + CONTENT_TYPE_MUSIC, which makes the OS treat
 * it as music playback (not voice / call), routing it through A2DP
 * and respecting the media volume slider.
 *
 * Methods:
 *   start()                — begin playback
 *   stop()                 — stop and release the track
 *   setVolume({volume:f})  — linear gain, 0..1
 */
@CapacitorPlugin(name = "PinkPlayer")
public class PinkPlayerPlugin extends Plugin {
    private AudioTrack track;
    private Thread feeder;
    private volatile boolean playing = false;
    private volatile float volume = 1.0f;

    @PluginMethod
    public void start(PluginCall call) {
        if (playing) { call.resolve(); return; }

        final int sampleRate = 48000;
        final int channelMask = AudioFormat.CHANNEL_OUT_STEREO;
        final int encoding   = AudioFormat.ENCODING_PCM_FLOAT;

        int minBuf = AudioTrack.getMinBufferSize(sampleRate, channelMask, encoding);
        if (minBuf <= 0) minBuf = 8192;
        final int bufferBytes = Math.max(minBuf * 4, 32768);

        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();

        AudioFormat format = new AudioFormat.Builder()
            .setSampleRate(sampleRate)
            .setEncoding(encoding)
            .setChannelMask(channelMask)
            .build();

        try {
            track = new AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
        } catch (Exception e) {
            call.reject("AudioTrack init failed: " + e.getMessage(), e);
            return;
        }

        try { track.setVolume(volume); } catch (Exception ignored) {}
        try { track.play(); } catch (Exception e) {
            call.reject("AudioTrack play failed: " + e.getMessage(), e);
            return;
        }

        playing = true;
        // Frame count per write: keep small enough to update volume
        // changes promptly, big enough to avoid underruns.
        final int framesPerWrite = 1024;
        final float[] buf = new float[framesPerWrite * 2];

        feeder = new Thread(() -> {
            // Two independent Paul-Kellet pink-noise filter chains for
            // stereo decorrelation (matches the JS implementation).
            float[] L = new float[7];
            float[] R = new float[7];
            Random rand = new Random();
            while (playing) {
                for (int i = 0; i < framesPerWrite; i++) {
                    buf[i * 2]     = pink(L, rand);
                    buf[i * 2 + 1] = pink(R, rand);
                }
                if (track == null) break;
                int n = track.write(buf, 0, buf.length, AudioTrack.WRITE_BLOCKING);
                if (n < 0) break;
            }
        }, "PlotEQ-PinkPlayer");
        feeder.setPriority(Thread.MAX_PRIORITY - 1);
        feeder.start();
        call.resolve();
    }

    private static float pink(float[] s, Random r) {
        float white = r.nextFloat() * 2.0f - 1.0f;
        s[0] = 0.99886f * s[0] + white * 0.0555179f;
        s[1] = 0.99332f * s[1] + white * 0.0750759f;
        s[2] = 0.96900f * s[2] + white * 0.1538520f;
        s[3] = 0.86650f * s[3] + white * 0.3104856f;
        s[4] = 0.55000f * s[4] + white * 0.5329522f;
        s[5] = -0.7616f * s[5] - white * 0.0168980f;
        // Same 0.11 scaling as the JS implementation (Paul Kellet,
        // unit-RMS-ish output). Native AudioTrack volume control
        // (track.setVolume) handles user-facing loudness — this
        // factor is just the generator's natural amplitude.
        float pinkVal = (s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + white * 0.5362f) * 0.11f;
        s[6] = white * 0.115926f;
        return pinkVal;
    }

    @PluginMethod
    public void stop(PluginCall call) {
        playing = false;
        Thread t = feeder;
        feeder = null;
        if (t != null) {
            try { t.join(500); } catch (InterruptedException ignored) {}
        }
        if (track != null) {
            try { track.stop(); } catch (Exception ignored) {}
            try { track.release(); } catch (Exception ignored) {}
            track = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Float v = call.getFloat("volume");
        if (v == null) { call.reject("missing volume"); return; }
        volume = Math.max(0f, Math.min(1f, v));
        if (track != null) {
            try { track.setVolume(volume); } catch (Exception ignored) {}
        }
        call.resolve();
    }
}
