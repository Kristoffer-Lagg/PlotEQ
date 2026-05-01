package com.kristofferlagg.ploteq;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

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
 *
 * Where `type` is the raw AudioDeviceInfo.TYPE_* int and `typeName`
 * is a friendly tag the JS side can match on (builtin / usb /
 * bluetooth / wired / other).
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
