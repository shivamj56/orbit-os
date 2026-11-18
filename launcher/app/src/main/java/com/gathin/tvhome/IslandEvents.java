package com.gathin.tvhome;

import android.app.Notification;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;

import androidx.annotation.NonNull;

import java.util.HashMap;
import java.util.Map;

/**
 * What the TV Island hears about: headphones and speakers coming and going (with their battery when they say it), the
 * internet lost and back, an HDMI device switched on, and the notifications of the apps on Home. Nothing in the first minutes
 * after a boot, when all of it happens at once and none of it is news.
 */
final class IslandEvents {

    private static final long QUIET_AFTER_BOOT_MS = 3L * 60L * 1000L, OFFLINE_AFTER_MS = 4000L, SAME_APP_GAP_MS = 10_000L;
    private static final String BATTERY_CHANGED = "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED";
    private static final String BATTERY_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL";
    private static final int BLUE = 0xFF74D1FF, VIOLET = 0xFFE9B3FF, RED = 0xFFFF5A6A, GREEN = 0xFF4BE3A0, GREY = 0xFF9AA3B2;

    private static IslandEvents running;

    private final Context context;
    private final TvIsland island;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Long> connectedAt = new HashMap<>();
    private final Map<String, Long> lastFromApp = new HashMap<>();
    private long lostAt;
    private final Runnable offline = this::showOffline;

    private final BroadcastReceiver bluetooth = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
            if (device == null || !quietOver()) return;
            String name;
            try {
                BluetoothClass kind = device.getBluetoothClass();
                // Only sound: the remote itself reconnects after every standby and is not news.
                if (kind == null || kind.getMajorDeviceClass() != BluetoothClass.Device.Major.AUDIO_VIDEO) return;
                name = device.getName();
            } catch (SecurityException noPermission) {
                return;
            }
            if (name == null || name.trim().isEmpty()) name = Words.mark("Headphones");
            String key = "bt:" + device.getAddress();
            String action = intent.getAction();
            if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                connectedAt.put(key, SystemClock.elapsedRealtime());
                island.show(new TvIsland.Event(key, name, Words.mark("Connected"), BLUE, TvIsland.ICON_HEADPHONES, null, null, 3500L));
            } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                connectedAt.remove(key);
                island.show(new TvIsland.Event(key, name, Words.mark("Disconnected"), GREY, TvIsland.ICON_HEADPHONES, null, null, 3000L));
            } else if (BATTERY_CHANGED.equals(action)) {
                Long at = connectedAt.get(key);
                int level = intent.getIntExtra(BATTERY_LEVEL, -1);
                // The battery is news right after connecting, or when it runs low.
                boolean fresh = at != null && SystemClock.elapsedRealtime() - at < 30_000L;
                if (level < 0 || !(fresh || level <= 15)) return;
                island.show(new TvIsland.Event(key, name, (fresh ? Words.mark("Connected") : Words.mark("Battery low")) + "   ·   " + level + "%",
                        level <= 15 ? RED : BLUE, TvIsland.ICON_HEADPHONES, null, null, 3500L));
            }
        }
    };

    private final ConnectivityManager.NetworkCallback network = new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(@NonNull Network n) {
            main.post(() -> {
                main.removeCallbacks(offline);
                if (lostAt != 0L && SystemClock.elapsedRealtime() - lostAt >= OFFLINE_AFTER_MS && quietOver()) {
                    island.dismiss("net");
                    island.show(new TvIsland.Event("net", Words.mark("Back online"), "", GREEN, TvIsland.ICON_ONLINE, null, null, 2500L));
                }
                lostAt = 0L;
            });
        }

        @Override
        public void onLost(@NonNull Network n) {
            main.post(() -> {
                lostAt = SystemClock.elapsedRealtime();
                main.removeCallbacks(offline);
                main.postDelayed(offline, OFFLINE_AFTER_MS);
            });
        }
    };

    private final TvInputManager.TvInputCallback inputs = new TvInputManager.TvInputCallback() {
        @Override
        public void onInputStateChanged(String inputId, int state) {
            if (state != TvInputManager.INPUT_STATE_CONNECTED || !quietOver() || MovieNight.on()) return;
            TvInputManager tim = context.getSystemService(TvInputManager.class);
            TvInputInfo info = tim == null ? null : tim.getTvInputInfo(inputId);
            if (info == null || info.getType() != TvInputInfo.TYPE_HDMI) return;
            CharSequence label = info.loadLabel(context);
            island.show(new TvIsland.Event("in:" + inputId, (label == null ? "HDMI" : label.toString()) + " connected",
                    Words.mark("Press Inputs to watch it"), VIOLET, TvIsland.ICON_HDMI, null, null, 3500L));
        }
    };

    private void showOffline() {
        if (lostAt != 0L && quietOver()) {
            island.show(new TvIsland.Event("net", Words.mark("No internet"), Words.mark("Apps that stream will wait for it"), RED, TvIsland.ICON_OFFLINE, null, null, 4000L));
        }
    }

    IslandEvents(Context context, TvIsland island) {
        this.context = context;
        this.island = island;
    }

    void start() {
        IntentFilter f = new IntentFilter();
        f.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        f.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        f.addAction(BATTERY_CHANGED);
        try {
            context.registerReceiver(bluetooth, f, Context.RECEIVER_EXPORTED);
        } catch (RuntimeException noBluetooth) {
            // The rest still works.
        }
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm != null) cm.registerDefaultNetworkCallback(network);
        TvInputManager tim = context.getSystemService(TvInputManager.class);
        if (tim != null) tim.registerCallback(inputs, main);
        running = this;
    }

    void stop() {
        if (running == this) running = null;
        main.removeCallbacksAndMessages(null);
        try {
            context.unregisterReceiver(bluetooth);
        } catch (RuntimeException notRegistered) {
            // Nothing to undo.
        }
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        try {
            if (cm != null) cm.unregisterNetworkCallback(network);
        } catch (RuntimeException notRegistered) {
            // Nothing to undo.
        }
        TvInputManager tim = context.getSystemService(TvInputManager.class);
        if (tim != null) tim.unregisterCallback(inputs);
    }

    private static boolean quietOver() {
        return SystemClock.elapsedRealtime() > QUIET_AFTER_BOOT_MS;
    }

    /** From GuardRevival, the notification listener: an app on Home has something to say. Main thread. */
    static void notification(Context listener, StatusBarNotification sbn) {
        IslandEvents events = running;
        if (events == null || !quietOver() || sbn == null || MovieNight.on()) return;
        Notification n = sbn.getNotification();
        String pkg = sbn.getPackageName();
        if (n == null || sbn.isOngoing() || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        if (pkg.equals(listener.getPackageName()) || pkg.equals("android") || pkg.startsWith("com.android.")) return;
        PackageManager pm = listener.getPackageManager();
        // Only the apps someone would open: the firmware's own services post a good deal that is nobody's business.
        if (pm.getLeanbackLaunchIntentForPackage(pkg) == null && pm.getLaunchIntentForPackage(pkg) == null) return;
        Bundle extras = n.extras;
        CharSequence title = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT);
        if (title == null || title.toString().trim().isEmpty()) return;
        long now = SystemClock.elapsedRealtime();
        Long last = events.lastFromApp.get(pkg);
        if (last != null && now - last < SAME_APP_GAP_MS) return;
        events.lastFromApp.put(pkg, now);
        Bitmap icon = null;
        int accent = BLUE;
        try {
            icon = small(pm.getApplicationIcon(pkg), Math.round(64f * listener.getResources().getDisplayMetrics().widthPixels / 1280f));
            accent = GalleryArt.accentsOf(icon)[0];
        } catch (PackageManager.NameNotFoundException | RuntimeException noIcon) {
            // The glass without a picture.
        }
        events.island.show(new TvIsland.Event("app:" + pkg, title.toString().trim(), text == null ? "" : text.toString().trim(),
                accent, TvIsland.ICON_NONE, icon, null, 4500L));
    }

    private static Bitmap small(Drawable d, int size) {
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, size, size);
        d.draw(c);
        return b;
    }
}
