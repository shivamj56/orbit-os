package com.gathin.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.app.ActivityManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Clear all, from the recent apps: the apps left running behind are closed and their memory comes back, as on a phone.
 * Android 14 lets no app close another (killBackgroundProcesses reaches only the caller's own), so this does what a person
 * would: each app's page in Settings, its Force stop, its OK, one after the other, behind the recent apps' own cover. About
 * a second an app. The apps then start from nothing next time, and stay asleep at boot until they are opened again.
 */
final class MemoryClear {

    interface Listener {
        /** Which app it is on, counting from 1, for the cover's line. */
        void onProgress(int done, int total, String label);

        void onDone(int closed, long freeMb);
    }

    private static final long LOOK_MS = 120L, PAGE_MS = 3000L, DIALOG_MS = 2000L;
    private static final String[] FORCE_STOP = {"force stop"};
    private static final String[] OK = {"ok", "force stop"};

    private final AccessibilityService service;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<String> left = new ArrayList<>();
    private Listener listener;
    private int total, closed;
    private long stepUntil;
    private boolean running;

    MemoryClear(AccessibilityService service) {
        this.service = service;
    }

    boolean running() {
        return running;
    }

    void clear(List<String> packages, Listener listener) {
        if (running) return;
        running = true;
        this.listener = listener;
        left.clear();
        left.addAll(packages);
        total = left.size();
        closed = 0;
        nextApp();
    }

    void cancel() {
        main.removeCallbacksAndMessages(null);
        running = false;
    }

    private void nextApp() {
        if (left.isEmpty()) {
            finish();
            return;
        }
        String pkg = left.remove(0);
        listener.onProgress(total - left.size(), total, label(pkg));
        try {
            service.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        } catch (RuntimeException noSettings) {
            nextApp();
            return;
        }
        stepUntil = SystemClock.uptimeMillis() + PAGE_MS;
        main.postDelayed(() -> pressForceStop(pkg), LOOK_MS * 2);
    }

    /** Finds the app's Force stop and presses it; a greyed one means the app is not running at all. */
    private void pressForceStop(String pkg) {
        AccessibilityNodeInfo button = find(service.getRootInActiveWindow(), FORCE_STOP);
        if (button == null) {
            if (SystemClock.uptimeMillis() < stepUntil) main.postDelayed(() -> pressForceStop(pkg), LOOK_MS);
            else nextApp();
            return;
        }
        if (!button.isEnabled() || !click(button)) {
            nextApp();
            return;
        }
        stepUntil = SystemClock.uptimeMillis() + DIALOG_MS;
        main.postDelayed(() -> confirm(pkg, button), LOOK_MS * 2);
    }

    /** The "Force stop?" question: its OK. */
    private void confirm(String pkg, AccessibilityNodeInfo first) {
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        AccessibilityNodeInfo ok = find(root, OK);
        // On some firmware the question has no OK of its own but a second Force stop: not the same node as the first.
        if (ok != null && !ok.equals(first)) {
            if (click(ok)) closed++;
            main.postDelayed(this::nextApp, LOOK_MS * 2);
            return;
        }
        if (SystemClock.uptimeMillis() < stepUntil) main.postDelayed(() -> confirm(pkg, first), LOOK_MS);
        else nextApp();
    }

    private void finish() {
        running = false;
        ActivityManager am = service.getSystemService(ActivityManager.class);
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        long free = -1L;
        if (am != null) {
            am.getMemoryInfo(info);
            free = info.availMem / (1024L * 1024L);
        }
        listener.onDone(closed, free);
    }

    private String label(String pkg) {
        try {
            return service.getPackageManager().getApplicationLabel(service.getPackageManager().getApplicationInfo(pkg, 0)).toString();
        } catch (Exception gone) {
            return pkg;
        }
    }

    private static boolean click(AccessibilityNodeInfo node) {
        for (AccessibilityNodeInfo n = node; n != null; n = n.getParent()) {
            if (n.isClickable()) return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    /** The first node whose own text is one of these, ignoring case, breadth first: the list item rather than a heading. */
    private static AccessibilityNodeInfo find(AccessibilityNodeInfo root, String[] texts) {
        if (root == null) return null;
        List<AccessibilityNodeInfo> queue = new ArrayList<>();
        queue.add(root);
        for (int i = 0; i < queue.size() && i < 600; i++) {
            AccessibilityNodeInfo n = queue.get(i);
            CharSequence t = n.getText();
            if (t != null) {
                String s = t.toString().trim().toLowerCase(Locale.ROOT);
                for (String want : texts) if (s.equals(want)) return n;
            }
            for (int k = 0; k < n.getChildCount(); k++) {
                AccessibilityNodeInfo child = n.getChild(k);
                if (child != null) queue.add(child);
            }
        }
        return null;
    }

    /** What is free right now, for the recent apps' Clear all button. */
    static long freeMb(AccessibilityService service) {
        ActivityManager am = service.getSystemService(ActivityManager.class);
        if (am == null) return -1L;
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(info);
        return info.availMem / (1024L * 1024L);
    }
}
