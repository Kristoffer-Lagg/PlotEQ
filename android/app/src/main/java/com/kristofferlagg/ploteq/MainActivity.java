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
 * navigation bar are hidden, the WebView occupies the entire display,
 * and the user can swipe from an edge to *temporarily* peek at the
 * system bars (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE) without ever
 * leaving immersive mode. There is no in-app toggle — this is the only
 * mode the app runs in.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Draw behind system bars so the WebView fills the cutout area too.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Keep the screen on while a measurement / RTA is running. Cheap
        // and matches the user expectation for an audio analyzer that's
        // actively capturing.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
