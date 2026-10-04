package io.github.withoutcheatscsgocz_tech.timemoves;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

/**
 * A full-screen WebView running the web game from assets/web/.
 *
 * Files are served from https://appassets.androidplatform.net/ (the host Android reserves
 * for exactly this), which gives the page a stable secure origin for saved progress.
 * Every other request is refused: the game needs no network.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int PAPER = 0xFFECEEF1;

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // planning a move can take a while
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        drawEdgeToEdge();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(PAPER);
        // Keep the game clear of camera cutouts; the padding shows the page colour.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l = 0, t = 0, r = 0, b = 0;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.displayCutout() | WindowInsets.Type.systemBars());
                l = i.left;
                t = i.top;
                r = i.right;
                b = i.bottom;
            } else if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout c = insets.getDisplayCutout();
                if (c != null) {
                    l = c.getSafeInsetLeft();
                    t = c.getSafeInsetTop();
                    r = c.getSafeInsetRight();
                    b = c.getSafeInsetBottom();
                }
            }
            v.setPadding(l, t, r, b);
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(PAPER);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true); // no text selection or context menu while drawing

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // stars and best times
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // the layout is sized in CSS px; system font scaling would break the HUD
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect
        }

        web.setWebViewClient(new AssetClient());
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemBars();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        web.loadUrl(START_URL);
    }

    /** Back leaves a heist for the heist list; on the list it closes the app. */
    private void handleBack() {
        web.evaluateJavascript("window.TMWYD && TMWYD.back ? TMWYD.back() : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack(); // Android 12L and older; newer versions use the callback above
    }

    @Override
    protected void onPause() {
        // Stop the clock if the app is left mid-drag, and silence the drone.
        web.evaluateJavascript("window.TMWYD && TMWYD.pause && TMWYD.pause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Android 15+ always draws edge to edge; 11-14 need to be asked. */
    @SuppressWarnings("deprecation")
    private void drawEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= 30 && Build.VERSION.SDK_INT < 35) getWindow().setDecorFitsSystemWindows(false);
    }

    /** Immersive: status and navigation bars stay hidden until swiped in. */
    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    /** Serves assets/web/ at https://appassets.androidplatform.net/ and blocks everything else. */
    private final class AssetClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!"https".equals(url.getScheme()) || !HOST.equals(url.getHost())) {
                return error(403, "Forbidden");
            }
            String path = url.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.contains("..")) return error(404, "Not Found");
            try {
                InputStream in = getAssets().open("web" + path);
                String mime = mimeType(path);
                WebResourceResponse res = new WebResourceResponse(
                        mime, mime.startsWith("text/") || mime.endsWith("javascript") ? "utf-8" : null, in);
                res.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return res;
            } catch (IOException e) {
                return error(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false;
            // Anything outside the game opens in the browser instead of inside the app.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
                // nothing can open it; stay in the game
            }
            return true;
        }

        private WebResourceResponse error(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason,
                    Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
        }

        private String mimeType(String path) {
            int dot = path.lastIndexOf('.');
            String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
            switch (ext) {
                case "html": return "text/html";
                case "js": return "text/javascript";
                case "css": return "text/css";
                case "json": return "application/json";
                case "svg": return "image/svg+xml";
                case "png": return "image/png";
                case "woff2": return "font/woff2";
                case "txt": return "text/plain";
                default: return "application/octet-stream";
            }
        }
    }
}
