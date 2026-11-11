package com.gathin.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.UserManager;
import android.service.notification.NotificationListenerService;

/**
 * Starts this launcher's process after the firmware has killed it.
 *
 * A notification listener keeps its approval across a force stop, and the system binds it again
 * once the process is gone. That rebind is what brings Home back on TCL and Xiaomi. Under the gallery Home the
 * notifications of the apps on Home are also shown in the TV Island (IslandEvents); they stay on the TV.
 * Enable with {@code cmd notification allow_listener dev.shiv.orbit.home/com.gathin.tvhome.GuardRevival}.
 */
public class GuardRevival extends NotificationListenerService {
    private BroadcastReceiver unlocked;

    @Override
    public void onListenerConnected() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) WatchHistory.listenerConnected();
        UserManager users = getSystemService(UserManager.class);
        if (users != null && !users.isUserUnlocked()) {
            if (unlocked != null) return;
            unlocked = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    stopWaiting();
                    GuardKeep.ensureHomeKey(GuardRevival.this);
                }
            };
            registerReceiver(unlocked, new IntentFilter(Intent.ACTION_USER_UNLOCKED));
            if (users.isUserUnlocked()) {
                stopWaiting();
                GuardKeep.ensureHomeKey(this);
            }
            return;
        }
        GuardKeep.ensureHomeKey(this);
        // A force stop also takes the key helper off the list, and with the remote's volume keys going through it
        // (VolumeSlider), that should not have to wait until someone next opens Home.
        ServiceRepair.restore(this);
    }

    @Override
    public void onNotificationPosted(android.service.notification.StatusBarNotification sbn) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) IslandEvents.notification(this, sbn);
    }

    private void stopWaiting() {
        if (unlocked == null) return;
        try {
            unregisterReceiver(unlocked);
        } catch (RuntimeException ignored) {
        }
        unlocked = null;
    }

    @Override
    public void onDestroy() {
        stopWaiting();
        super.onDestroy();
    }
}
