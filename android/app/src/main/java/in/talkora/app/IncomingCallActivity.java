package in.talkora.app;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen lock-screen incoming call UI — launched by
 * TalkoraMessagingService when an "incoming_call" FCM arrives.
 *
 * Accept → deep-link into the app (talkora://call/<kind>/<callerId>?inviteId=...&autoAccept=1)
 *           so the existing /call route joins the Agora channel.
 * Reject → broadcast back to JS via the talkora://call-reject deep link so the
 *           authenticated app rejects the invite on the server, then finishes.
 */
public class IncomingCallActivity extends AppCompatActivity {
    public static final String EXTRA_INVITE_ID     = "invite_id";
    public static final String EXTRA_CALLER_ID     = "caller_id";
    public static final String EXTRA_CALLER_NAME   = "caller_name";
    public static final String EXTRA_CALLER_AVATAR = "caller_avatar";
    public static final String EXTRA_KIND          = "kind";
    public static final String ACTION_DISMISS      = "in.talkora.app.CALL_DISMISS";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private BroadcastReceiver dismissReceiver;
    private final Handler autoDismiss = new Handler(Looper.getMainLooper());

    private String inviteId, callerId, kind;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Show over lock screen + turn the display on.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        setContentView(R.layout.activity_incoming_call);

        Intent i = getIntent();
        inviteId   = safe(i.getStringExtra(EXTRA_INVITE_ID));
        callerId   = safe(i.getStringExtra(EXTRA_CALLER_ID));
        String name = safe(i.getStringExtra(EXTRA_CALLER_NAME));
        kind       = safe(i.getStringExtra(EXTRA_KIND));
        if (kind.isEmpty()) kind = "voice";

        TextView nameTv  = findViewById(R.id.caller_name);
        TextView labelTv = findViewById(R.id.call_label);
        Button accept    = findViewById(R.id.btn_accept);
        Button reject    = findViewById(R.id.btn_reject);

        nameTv.setText(name.isEmpty() ? "Incoming call" : name);
        labelTv.setText("video".equals(kind) ? "Incoming video call" : "Incoming voice call");

        accept.setOnClickListener(v -> acceptCall());
        reject.setOnClickListener(v -> rejectCall());

        startRingtone();
        startVibration();

        // Receiver — server told us the caller cancelled
        dismissReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { finishCleanly(); }
        };
        IntentFilter f = new IntentFilter(ACTION_DISMISS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(dismissReceiver, f);
        }

        // Auto-dismiss after 45s if user never interacts (matches invite TTL)
        autoDismiss.postDelayed(this::finishCleanly, 45_000);
    }

    private void acceptCall() {
        String path = "talkora://call/" + kind + "/" + callerId
            + "?inviteId=" + inviteId + "&autoAccept=1";
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(path));
        open.setPackage(getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(open);
        finishCleanly();
    }

    private void rejectCall() {
        // Open the app on a path the JS layer recognises and rejects.
        String path = "talkora://call-reject?inviteId=" + inviteId;
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(path));
        open.setPackage(getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { startActivity(open); } catch (Exception ignored) { /* fine */ }
        finishCleanly();
    }

    private void finishCleanly() {
        try { autoDismiss.removeCallbacksAndMessages(null); } catch (Exception ignored) {}
        try { if (ringtone != null) ringtone.stop(); } catch (Exception ignored) {}
        try { if (vibrator != null) vibrator.cancel(); } catch (Exception ignored) {}
        try { if (dismissReceiver != null) unregisterReceiver(dismissReceiver); } catch (Exception ignored) {}
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(TalkoraMessagingService.CALL_NOTIFICATION_ID);
        finish();
    }

    private void startRingtone() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(this, uri);
            if (ringtone != null) ringtone.play();
        } catch (Exception ignored) {}
    }

    private void startVibration() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) return;
            long[] pattern = { 0, 800, 600, 800, 600 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) {}
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        finishCleanly();
    }

    private static String safe(String s) { return s == null ? "" : s; }
}
