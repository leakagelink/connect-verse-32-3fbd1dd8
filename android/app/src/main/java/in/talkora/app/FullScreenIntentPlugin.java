package in.talkora.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges Android 14+ (API 34) USE_FULL_SCREEN_INTENT runtime permission
 * to JS. Without this granted, the OS demotes our incoming-call
 * full-screen intent to a normal heads-up notification — which means a
 * killed/backgrounded Talkora app will NOT auto-pop the ringer screen
 * even though FCM was delivered.
 *
 * JS calls:
 *   FullScreenIntent.check()         → { granted: boolean, required: boolean }
 *   FullScreenIntent.openSettings()  → opens system settings page
 */
@CapacitorPlugin(name = "FullScreenIntent")
public class FullScreenIntentPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        JSObject ret = new JSObject();
        // Pre-Android 14 the permission is implicitly granted via manifest.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ret.put("granted", true);
            ret.put("required", false);
            call.resolve(ret);
            return;
        }
        try {
            NotificationManager nm = (NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            boolean granted = nm != null && nm.canUseFullScreenIntent();
            ret.put("granted", granted);
            ret.put("required", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("granted", false);
            ret.put("required", true);
            ret.put("error", String.valueOf(e.getMessage()));
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                // Fallback — open the app's notification settings.
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not open full-screen-intent settings", e);
        }
    }
}
