package in.talkora.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives high-priority data-only FCM messages from the Talkora backend
 * (see src/lib/push.server.ts → sendDataOnlyFcm).
 *
 * type = "incoming_call"  → launch full-screen IncomingCallActivity
 *                            (WhatsApp / Truecaller style)
 * type = "cancel_call"     → dismiss any existing call notification + activity
 *
 * Token rotation is persisted to SharedPreferences so the JS layer can pick
 * it up on next launch and upsert into device_tokens via registerDeviceToken.
 */
public class TalkoraMessagingService extends FirebaseMessagingService {
    private static final String TAG = "TalkoraFCM";
    public static final String CALL_CHANNEL_ID = "incoming_calls";
    public static final int CALL_NOTIFICATION_ID = 1991;
    public static final String PREF_PENDING_TOKEN = "talkora.fcm.pending_token";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        try {
            getSharedPreferences("talkora.fcm", Context.MODE_PRIVATE)
                .edit().putString(PREF_PENDING_TOKEN, token).apply();
        } catch (Exception e) {
            Log.w(TAG, "could not persist new fcm token", e);
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String type = data.get("type");
        if (type == null) return;

        if ("incoming_call".equals(type)) {
            showIncomingCall(data);
        } else if ("cancel_call".equals(type)) {
            dismissIncomingCall();
        }
    }

    private void showIncomingCall(Map<String, String> data) {
        ensureChannel();

        String inviteId   = nullSafe(data.get("invite_id"));
        String callerId   = nullSafe(data.get("caller_id"));
        String callerName = nullSafe(data.get("caller_name"));
        String callerAv   = nullSafe(data.get("caller_avatar"));
        String kind       = nullSafe(data.get("call_kind")); // "voice" | "video"
        if (kind.isEmpty()) kind = "voice";

        Intent full = new Intent(this, IncomingCallActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        full.putExtra(IncomingCallActivity.EXTRA_INVITE_ID, inviteId);
        full.putExtra(IncomingCallActivity.EXTRA_CALLER_ID, callerId);
        full.putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName);
        full.putExtra(IncomingCallActivity.EXTRA_CALLER_AVATAR, callerAv);
        full.putExtra(IncomingCallActivity.EXTRA_KIND, kind);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullPi = PendingIntent.getActivity(this, 1001, full, piFlags);

        // On Android 10+ the OS prefers the full-screen-intent over starting
        // an activity directly from background. Try a direct launch first,
        // then fall back to a high-priority heads-up notification with the
        // full-screen intent attached.
        try {
            startActivity(full);
        } catch (Exception ignored) {
            // Some OEMs block background activity starts; the notification's
            // full-screen intent below handles that case.
        }

        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        String title = "Incoming " + ("video".equals(kind) ? "video" : "voice") + " call";
        String body  = (callerName.isEmpty() ? "Someone" : callerName) + " is calling…";

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(ringtone)
            .setContentIntent(fullPi)
            .setFullScreenIntent(fullPi, true);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(CALL_NOTIFICATION_ID, b.build());
    }

    private void dismissIncomingCall() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(CALL_NOTIFICATION_ID);
        // Tell the activity to finish if it's currently showing.
        Intent dismiss = new Intent(IncomingCallActivity.ACTION_DISMISS);
        dismiss.setPackage(getPackageName());
        sendBroadcast(dismiss);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CALL_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
            CALL_CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Ringing for incoming Talkora voice and video calls");
        ch.enableLights(true);
        ch.enableVibration(true);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), audio);
        nm.createNotificationChannel(ch);
    }

    private static String nullSafe(String s) { return s == null ? "" : s; }
}
