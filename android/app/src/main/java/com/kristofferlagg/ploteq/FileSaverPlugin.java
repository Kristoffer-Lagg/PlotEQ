package com.kristofferlagg.ploteq;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * FileSaver — exposes Android's Storage Access Framework (SAF)
 * "Create document" picker to JS, so the user can choose a folder
 * on the phone (Documents, Downloads, custom subfolder, …) and save
 * a file there. This replaces the `@capacitor/share` flow which only
 * lets the user *share* the file with another app.
 *
 * Method:
 *   save({ suggestedName: string, mimeType: string, data: string })
 *     -> { uri: string }       on success (data is plain text)
 *     -> rejects with 'cancelled' if the user dismisses the picker
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String suggested = call.getString("suggestedName", "file.txt");
        String mimeType  = call.getString("mimeType", "application/octet-stream");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, suggested);

        // Stash the call so handleSaveResult can resolve it later.
        bridge.saveCall(call);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("no_uri");
            return;
        }

        String data = call.getString("data", "");
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
            if (os == null) {
                call.reject("open_failed");
                return;
            }
            os.write(data.getBytes("UTF-8"));
            os.flush();
        } catch (Exception e) {
            call.reject("write_failed: " + e.getMessage(), e);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }
}
