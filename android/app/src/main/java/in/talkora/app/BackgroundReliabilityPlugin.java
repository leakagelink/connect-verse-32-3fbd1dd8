package in.talkora.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges OEM-specific "Autostart" and battery-optimization settings to JS so
 * Talkora can pop full-screen incoming calls when the app is killed.
 *
 * Android stock gives us REQUEST_IGNORE_BATTERY_OPTIMIZATIONS; Chinese OEMs
 * (Xiaomi/MIUI, Vivo/FunTouch, Oppo/ColorOS, Realme, Honor, Huawei) layer
 * extra "Autostart" + "Background activity" toggles on top, without which our
 * FCM message either never wakes the process or can't launch the ringer
 * Activity. The user must enable these manually — there is no API — but we
 * can deep-link them straight to the right OEM screen.
 *
 * JS calls:
 *   BackgroundReliability.status() →
 *     { batteryOptIgnored, vendor, autostartSupported, recommended }
 *   BackgroundReliability.requestIgnoreBatteryOptimizations()
 *   BackgroundReliability.openAutostartSettings() → { opened }
 *   BackgroundReliability.openBatterySettings()   → { opened }
 */
@CapacitorPlugin(name = "BackgroundReliability")
public class BackgroundReliabilityPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("vendor", detectVendor());
        ret.put("autostartSupported", autostartIntent(ctx) != null);
        ret.put("batteryOptIgnored", isIgnoringBatteryOptimizations(ctx));
        // True whenever there's still something the user can flip to improve
        // background reliability. JS uses this to decide if the banner shows.
        boolean recommended =
            !isIgnoringBatteryOptimizations(ctx) || autostartIntent(ctx) != null;
        ret.put("recommended", recommended);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        try {
            if (isIgnoringBatteryOptimizations(ctx)) {
                ret.put("granted", true);
                call.resolve(ret);
                return;
            }
            // System dialog: "Allow Talkora to ignore battery optimizations?"
            // This is the supported, Play-Store-safe entry point.
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            ret.put("granted", false); // user still needs to confirm
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            // Some OEMs hide the request dialog — fall back to the list screen.
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                ret.put("granted", false);
                ret.put("opened", true);
                call.resolve(ret);
            } catch (Exception inner) {
                call.reject("could not open battery optimization settings", inner);
            }
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("opened", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        Intent intent = autostartIntent(ctx);
        if (intent == null) {
            ret.put("opened", false);
            ret.put("vendor", detectVendor());
            call.resolve(ret);
            return;
        }
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            ret.put("opened", true);
            ret.put("vendor", detectVendor());
            call.resolve(ret);
        } catch (Exception e) {
            // Deep link not present on this firmware version — fall back to
            // the app's own details page where Autostart usually sits.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + ctx.getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                ret.put("opened", true);
                ret.put("fallback", true);
                ret.put("vendor", detectVendor());
                call.resolve(ret);
            } catch (Exception inner) {
                call.reject("could not open autostart settings", inner);
            }
        }
    }

    /* ------------------------------ helpers ------------------------------ */

    private boolean isIgnoringBatteryOptimizations(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    private String detectVendor() {
        String m = (Build.MANUFACTURER == null ? "" : Build.MANUFACTURER).toLowerCase();
        String b = (Build.BRAND == null ? "" : Build.BRAND).toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || b.contains("xiaomi") || b.contains("poco")) return "xiaomi";
        if (m.contains("vivo") || b.contains("vivo") || b.contains("iqoo")) return "vivo";
        if (m.contains("oppo") || b.contains("oppo")) return "oppo";
        if (m.contains("realme") || b.contains("realme")) return "realme";
        if (m.contains("oneplus") || b.contains("oneplus")) return "oneplus";
        if (m.contains("honor") || b.contains("honor")) return "honor";
        if (m.contains("huawei") || b.contains("huawei")) return "huawei";
        if (m.contains("samsung") || b.contains("samsung")) return "samsung";
        if (m.contains("asus") || b.contains("asus")) return "asus";
        if (m.contains("letv") || b.contains("letv")) return "letv";
        if (m.contains("nokia") || b.contains("nokia")) return "nokia";
        return "stock";
    }

    /**
     * Returns a vendor-specific Intent that opens the Autostart manager, or
     * null if this device has no known deep link. We don't verify
     * resolveActivity here because some OEMs hide these components from
     * queryIntentActivities even though startActivity works.
     */
    private Intent autostartIntent(Context ctx) {
        String vendor = detectVendor();
        Intent intent = new Intent();
        switch (vendor) {
            case "xiaomi":
                intent.setComponent(new ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                break;
            case "oppo":
                intent.setComponent(new ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
                break;
            case "realme":
                intent.setComponent(new ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"));
                break;
            case "vivo":
                intent.setComponent(new ComponentName(
                    "com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"));
                break;
            case "honor":
                intent.setComponent(new ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"));
                break;
            case "huawei":
                intent.setComponent(new ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                break;
            case "oneplus":
                intent.setComponent(new ComponentName(
                    "com.oneplus.security",
                    "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
                break;
            case "letv":
                intent.setComponent(new ComponentName(
                    "com.letv.android.letvsafe",
                    "com.letv.android.letvsafe.AutobootManageActivity"));
                break;
            case "asus":
                intent.setComponent(new ComponentName(
                    "com.asus.mobilemanager",
                    "com.asus.mobilemanager.entry.FunctionActivity"));
                break;
            default:
                return null;
        }
        return intent;
    }
}
