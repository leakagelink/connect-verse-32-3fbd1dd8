package in.talkora.app;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Routes in-call audio between the earpiece and the loud speaker.
 * WebRTC/Agora on Android defaults to the earpiece (voice-call mode),
 * which is why users perceive the call as quiet even at max volume.
 * Toggling this plugin flips AudioManager into speakerphone mode so
 * the remote audio plays through the device's main speaker.
 */
@CapacitorPlugin(name = "SpeakerMode")
public class SpeakerModePlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        Boolean on = call.getBoolean("on", false);
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) {
                call.reject("AudioManager unavailable");
                return;
            }
            // IN_COMMUNICATION is the correct mode for VoIP / WebRTC calls;
            // it lets us route output and applies AEC/AGC tuning.
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // API 31+: prefer setCommunicationDevice over the deprecated
                // setSpeakerphoneOn for reliable routing on modern Android.
                AudioDeviceInfo target = null;
                int type = on ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                              : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
                for (AudioDeviceInfo dev : am.getAvailableCommunicationDevices()) {
                    if (dev.getType() == type) { target = dev; break; }
                }
                if (target != null) {
                    am.setCommunicationDevice(target);
                } else {
                    am.setSpeakerphoneOn(on);
                }
            } else {
                am.setSpeakerphoneOn(on);
            }

            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to set speaker mode: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isOn(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            boolean on = false;
            if (am != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AudioDeviceInfo dev = am.getCommunicationDevice();
                    on = dev != null && dev.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
                } else {
                    on = am.isSpeakerphoneOn();
                }
            }
            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read speaker mode: " + e.getMessage());
        }
    }
}
