import { Capacitor, registerPlugin } from '@capacitor/core';

// Bridge to the FileSaver Capacitor plugin (android/app/src/main/java/.../FileSaverPlugin.java).
// Opens Android's Storage Access Framework "Create document" picker
// so the user can choose a folder on the phone (Documents, Downloads,
// custom subfolder, …) and save the file there.
const FileSaver = registerPlugin('FileSaver');

/**
 * Save a string to a user-chosen location via the Android SAF picker.
 *
 * @param {Object} opts
 * @param {string} opts.suggestedName - default file name shown in the picker
 * @param {string} opts.mimeType      - MIME type to register against
 * @param {string} opts.data          - file contents (plain text)
 * @returns {Promise<{ uri: string } | null>}
 *   Resolves with the chosen URI, or null if the user cancelled.
 *   Throws on unexpected I/O errors.
 */
export async function saveFileWithPicker({ suggestedName, mimeType, data }) {
  if (!Capacitor?.isNativePlatform?.()) {
    throw new Error('saveFileWithPicker is only available in the native app');
  }
  try {
    return await FileSaver.save({ suggestedName, mimeType, data });
  } catch (err) {
    if (err?.message === 'cancelled') return null;
    throw err;
  }
}
