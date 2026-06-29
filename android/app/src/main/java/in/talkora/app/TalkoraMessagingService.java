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

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives high-priority data-only FCM messages from the Talkora backend
 * (see src/lib/push.server.ts → sendDataOnlyFcm).
 *
 * Extends the Capacitor push plugin's MessagingService so token registration
 * and standard notification handling still flow through to JS, while we
 * layer on full-screen incoming-call handling for our `type=incoming_call`
 * payload.
 *
 * type = "incoming_call"  → launch full-screen IncomingCallActivity
 * type = "cancel_call"    → dismiss any existing call notification + activity
 */
public class TalkoraMessagingService extends MessagingService {
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
        Map<String, String> data = message.getData();
        String type = (data != null) ? data.get("type") : null;

        if ("incoming_call".equals(type)) {
            showIncomingCall(data);
            return; // do NOT call super — we don't want a duplicate banner
        }
        if ("cancel_call".equals(type)) {
            dismissIncomingCall();
            return;
        }
        // Everything else (chat / system / gifts) → Capacitor's default flow
        super.onMessageReceived(message);
    }

    private void showIncomingCall(Map<String, String> data) {
        ensureChannel();

        String inviteId   = nullSafe(data.get("invite_id"));
        String callerId   = nullSafe(data.get("caller_id"));
        String callerName = nullSafe(data.get("caller_name"));
        String callerAv   = nullSafe(data.get("caller_avatar"));
        String kind       = nullSafe(data.get("call_kind"));
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

        // On Android 10+ background activity starts are restricted; try a
        // direct launch first, then fall back to a heads-up notification with
        // the full-screen intent attached (the OS will honour it from any
        // app that holds USE_FULL_SCREEN_INTENT).
        try {
            startActivity(full);
        } catch (Exception ignored) {
            // OEM blocked the background start — full-screen intent below handles it.
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
