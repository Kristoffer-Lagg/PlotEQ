package com.kristofferlagg.ploteq;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * PlotEQ host activity.
 *
 * Forces persistent immersive fullscreen — both the status bar and the
 * navigation bar are hidden, the WebView occupies the entire display
 * including any display cutout area (notches, punch-holes, rounded
 * corners). The user can swipe from an edge to *temporarily* peek at
 * the system bars (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE) without ever
 * leaving immersive mode. There is no in-app toggle — this is the only
 * mode the app runs in.
 *
 * Immersive flags are applied in onCreate AND re-applied in onResume +
 * onWindowFocusChanged, because Samsung One UI in particular drops the
 * flags after returning from background or after a system dialog
 * (mic permission prompt, share sheet, etc.).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep the screen on while a measurement / RTA is running. Cheap
        // and matches the user expectation for an audio analyzer that's
        // actively capturing.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        applyImmersive();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    private void applyImmersive() {
        // Draw behind system bars so the WebView fills the cutout area.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
