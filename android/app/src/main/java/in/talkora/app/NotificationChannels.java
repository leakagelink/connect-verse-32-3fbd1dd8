package in.talkora.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

/**
 * Single source of truth for Talkora's Android notification channels.
 *
 * Channel IDs MUST match the `channelId` strings sent in the FCM v1 payload
 * (see src/lib/push.server.ts → sendFcmToTokens / sendDataOnlyFcm). If the
 * server sends a channel_id that doesn't exist on the device, FCM falls back
 * to a default channel and the notification loses its importance/sound
 * routing — so always register every channel here at app launch.
 *
 * Importance levels chosen for Play Store policy friendliness:
 *   incoming_calls → IMPORTANCE_MAX  + bypass DND + ring sound (call invites)
 *   missed_calls   → IMPORTANCE_HIGH + heads-up (post-ring miss alerts)
 *   messages       → IMPORTANCE_HIGH + heads-up (chat / gifts / follows)
 *   general        → IMPORTANCE_DEFAULT (system / marketing / misc)
 */
public final class NotificationChannels {
    public static final String INCOMING_CALLS = "incoming_calls";
    public static final String MISSED_CALLS   = "missed_calls";
    public static final String MESSAGES       = "messages";
    public static final String GENERAL        = "general";

    private NotificationChannels() {}

    public static void ensureAll(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // 1) Incoming calls — ringing channel
        if (nm.getNotificationChannel(INCOMING_CALLS) == null) {
            NotificationChannel ch = new NotificationChannel(
                INCOMING_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Ringing for incoming Talkora voice and video calls");
            ch.enableLights(true);
            ch.enableVibration(true);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            ch.setShowBadge(false);
            AudioAttributes ring = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), ring);
            nm.createNotificationChannel(ch);
        }

        // 2) Missed calls — heads-up, regular notification sound
        if (nm.getNotificationChannel(MISSED_CALLS) == null) {
            NotificationChannel ch = new NotificationChannel(
                MISSED_CALLS, "Missed calls", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Alerts when you miss a Talkora call");
            ch.enableLights(true);
            ch.enableVibration(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            ch.setShowBadge(true);
            AudioAttributes notif = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), notif);
            nm.createNotificationChannel(ch);
        }

        // 3) Messages — heads-up for chats, gifts, follows
        if (nm.getNotificationChannel(MESSAGES) == null) {
            NotificationChannel ch = new NotificationChannel(
                MESSAGES, "Messages & activity", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("New chat messages, gifts and followers");
            ch.enableLights(true);
            ch.enableVibration(true);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            ch.setShowBadge(true);
            AudioAttributes notif = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), notif);
            nm.createNotificationChannel(ch);
        }

        // 4) General — system, marketing, misc
        if (nm.getNotificationChannel(GENERAL) == null) {
            NotificationChannel ch = new NotificationChannel(
                GENERAL, "General", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Account updates and other notifications");
            ch.setShowBadge(true);
            nm.createNotificationChannel(ch);
        }
    }
}
