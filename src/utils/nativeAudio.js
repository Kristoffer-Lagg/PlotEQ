import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the AudioInputs Capacitor plugin (android/app/src/main/java/.../AudioInputsPlugin.java).
// Returns an empty list on web / iOS / when the plugin isn't present so
// callers can use this unconditionally without runtime checks.
const AudioInputs = registerPlugin('AudioInputs');

/**
 * Returns the list of input audio devices the *Android* system knows
 * about, with their real product names — bypassing the WebView's
 * `enumerateDevices()` which returns generic "Default" labels.
 *
 * Each item: { id: number, name: string, type: number, typeName: 'builtin' | 'usb' | 'usb_headset' | 'bluetooth' | 'wired' | 'other' }
 */
export async function listNativeInputs() {
  if (!Capacitor?.isNativePlatform?.()) return [];
  try {
    const result = await AudioInputs.list();
    return result?.devices ?? [];
  } catch (err) {
    console.warn('listNativeInputs failed:', err);
    return [];
  }
}

/**
 * Picks the "best" external mic name from the native input list, or
 * null if only the built-in mic is connected. Used to decorate the
 * mic-picker UI with the actual hardware name.
 *
 * Priority: usb_headset > usb > bluetooth > wired > builtin.
 */
export function pickPreferredInputName(devices) {
  if (!devices?.length) return null;
  const order = ['usb_headset', 'usb', 'bluetooth', 'wired'];
  for (const tag of order) {
    const hit = devices.find((d) => d.typeName === tag && d.name);
    if (hit) return hit.name;
  }
  return null;
}
