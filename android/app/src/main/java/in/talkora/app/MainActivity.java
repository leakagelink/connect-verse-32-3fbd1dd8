package in.talkora.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallPermissionsPlugin.class);
        registerPlugin(SpeakerModePlugin.class);
        registerPlugin(FullScreenIntentPlugin.class);
        registerPlugin(BackgroundReliabilityPlugin.class);
        registerPlugin(RingerStatusPlugin.class);
        registerPlugin(PlayBillingPlugin.class);
        super.onCreate(savedInstanceState);
        // Register every notification channel up-front so FCM messages that
        // arrive with a `channel_id` (incoming_calls, missed_calls, messages,
        // general) route to the right importance/sound. Cheap + idempotent.
        NotificationChannels.ensureAll(getApplicationContext());
        prepareTalkoraWebView();
    }

    private void prepareTalkoraWebView() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;

            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // Talkora loads the live app in the Capacitor shell. We deliberately
            // do NOT clear the WebView cache/history on every launch: doing so
            // forced a full re-download of the app on each start and could make
            // the WebView renderer die (which closes the app) on slower devices.
            // Normal HTTP caching already keeps the shell up to date.

            // WebRTC/Agora/100ms need camera/mic capture from the WebView. Keep
            // media APIs available and let the explicit pre-call gate request the
            // Android runtime permissions before a call starts.
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

        } catch (Exception ignored) {
            // Never crash the app because of optional WebView hardening.
        }
    }
}
