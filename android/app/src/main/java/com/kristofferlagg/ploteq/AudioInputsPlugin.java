package com.kristofferlagg.ploteq;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AudioInputs — bridges Android's AudioManager to JS so the app can
 * report the actual product name of a connected USB / Bluetooth /
 * wired microphone, which `navigator.mediaDevices.enumerateDevices()`
 * doesn't expose on Android (it just returns "Default").
 *
 * Method:
 *   list() -> { devices: [{ id, name, type, typeName }, ...] }
 */
@CapacitorPlugin(name = "AudioInputs")
public class AudioInputsPlugin extends Plugin {
    @PluginMethod
    public void list(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        JSArray arr = new JSArray();

        if (am != null) {
            AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_INPUTS);
            for (AudioDeviceInfo d : devices) {
                JSObject o = new JSObject();
                o.put("id", d.getId());
                CharSequence pn = d.getProductName();
                o.put("name", pn != null ? pn.toString() : "");
                o.put("type", d.getType());
                o.put("typeName", typeName(d.getType()));
                arr.put(o);
            }
        }

        JSObject ret = new JSObject();
        ret.put("devices", arr);
        call.resolve(ret);
    }

    /**
     * Force the audio system back to MODE_NORMAL after the WebView's
     * getUserMedia put it into MODE_IN_COMMUNICATION. Without this,
     * Bluetooth headphones get switched from A2DP (high-quality stereo)
     * to SCO (mono, voice-call quality), pink noise output sounds
     * "far away" and tinny, and the audio routing flickers between
     * speaker / headphones / earpiece.
     *
     * Also explicitly disables speakerphone routing and clears the
     * "communication device" hint introduced in API 31 — both can be
     * left set by Chrome when the app first acquired the mic.
     *
     * Safe to call repeatedly; the policy state is idempotent.
     */
    @PluginMethod
    public void setMediaMode(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            try {
                am.setMode(AudioManager.MODE_NORMAL);
            } catch (Exception ignored) {}

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try { am.clearCommunicationDevice(); } catch (Exception ignored) {}
            } else {
                try {
                    am.stopBluetoothSco();
                    am.setBluetoothScoOn(false);
                } catch (Exception ignored) {}
            }

            try { am.setSpeakerphoneOn(false); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    private String typeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC:        return "builtin";
            case AudioDeviceInfo.TYPE_USB_DEVICE:         return "usb";
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:      return "usb";
            case AudioDeviceInfo.TYPE_USB_HEADSET:        return "usb_headset";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:      return "bluetooth";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:      return "wired";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:   return "wired";
            default:                                      return "other";
        }
    }
}
