package in.talkora.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges system ringer / volume / Do-Not-Disturb / per-channel state to JS so
 * we can show the user clear, actionable readiness for incoming Talkora calls.
 *
 * JS calls:
 *   RingerStatus.status() → {
 *     ringerMode: "silent" | "vibrate" | "normal",
 *     ringVolume: int,        // current STREAM_RING level
 *     ringVolumeMax: int,     // device max for STREAM_RING
 *     dndActive: boolean,     // current interruption filter ≠ ALL
 *     dndFilter: "all" | "priority" | "alarms" | "none" | "unknown",
 *     channelImportance: int,        // NotificationChannel.IMPORTANCE_*
 *     channelSoundSet: boolean,      // ringtone configured on the channel
 *     channelBypassDnd: boolean,     // channel allowed past DND
 *     channelBlocked: boolean        // user disabled the incoming-calls channel
 *   }
 *
 *   RingerStatus.openChannelSettings() → opens Incoming-calls channel page
 *   RingerStatus.openDndSettings()     → opens system Do-Not-Disturb page
 *   RingerStatus.openVolumeSettings()  → opens system Sound settings
 */
@CapacitorPlugin(name = "RingerStatus")
public class RingerStatusPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        Context ctx = getContext();

        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            String mode = "normal";
            int vol = 0, max = 0;
            if (am != null) {
                int m = am.getRingerMode();
                if (m == AudioManager.RINGER_MODE_SILENT) mode = "silent";
                else if (m == AudioManager.RINGER_MODE_VIBRATE) mode = "vibrate";
                else mode = "normal";
                vol = am.getStreamVolume(AudioManager.STREAM_RING);
                max = am.getStreamMaxVolume(AudioManager.STREAM_RING);
            }
            ret.put("ringerMode", mode);
            ret.put("ringVolume", vol);
            ret.put("ringVolumeMax", max);
        } catch (Exception e) {
            ret.put("ringerMode", "normal");
            ret.put("ringVolume", 0);
            ret.put("ringVolumeMax", 0);
        }

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        // DND state
        try {
            String filter = "unknown";
            boolean dndActive = false;
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                int f = nm.getCurrentInterruptionFilter();
                switch (f) {
                    case NotificationManager.INTERRUPTION_FILTER_ALL: filter = "all"; break;
                    case NotificationManager.INTERRUPTION_FILTER_PRIORITY: filter = "priority"; break;
                    case NotificationManager.INTERRUPTION_FILTER_ALARMS: filter = "alarms"; break;
                    case NotificationManager.INTERRUPTION_FILTER_NONE: filter = "none"; break;
                    default: filter = "unknown";
                }
                dndActive = f != NotificationManager.INTERRUPTION_FILTER_ALL
                         && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
            }
            ret.put("dndActive", dndActive);
            ret.put("dndFilter", filter);
        } catch (Exception e) {
            ret.put("dndActive", false);
            ret.put("dndFilter", "unknown");
        }

        // Channel-specific state for the incoming-calls channel
        try {
            int importance = -1;
            boolean soundSet = false;
            boolean bypass = false;
            boolean blocked = false;
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = nm.getNotificationChannel(NotificationChannels.INCOMING_CALLS);
                if (ch != null) {
                    importance = ch.getImportance();
                    soundSet = ch.getSound() != null;
                    bypass = ch.canBypassDnd();
                    blocked = importance == NotificationManager.IMPORTANCE_NONE;
                }
            }
            ret.put("channelImportance", importance);
            ret.put("channelSoundSet", soundSet);
            ret.put("channelBypassDnd", bypass);
            ret.put("channelBlocked", blocked);
        } catch (Exception e) {
            ret.put("channelImportance", -1);
            ret.put("channelSoundSet", false);
            ret.put("channelBypassDnd", false);
            ret.put("channelBlocked", false);
        }

        call.resolve(ret);
    }

    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                intent.putExtra(Settings.EXTRA_CHANNEL_ID, NotificationChannels.INCOMING_CALLS);
            } else {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not open channel settings", e);
        }
    }

    @PluginMethod
    public void openDndSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ZEN_MODE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception ex) {
                call.reject("could not open DND settings", ex);
            }
        }
    }

    @PluginMethod
    public void openVolumeSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception ex) {
                call.reject("could not open volume settings", ex);
            }
        }
    }
}
