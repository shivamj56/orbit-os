package com.gathin.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.HardwareBuffer;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Help mode (phone/SPEC.md): the owner, away from home, sees this TV's screen in Orbit and presses its buttons for his
 * parents. About twice a second the helper takes a picture of the screen (menus, apps, settings; the video layer and
 * DRM apps come out grey or black, nothing here can capture them), shrinks it to 640 x 360 and sends it only when it
 * changed, at least every 5 s: to the cloud while a phone watches there, and to the Wi-Fi door for GET /api/screen.
 *
 * <p>While it is on, a note at the top of the screen says who can see it, so nobody at home is watched without knowing.
 * It ends by itself 30 s after the phone stops watching, after 30 minutes, and when the TV goes to standby.
 */
final class HelpMode {

    interface Host {
        /** The cloud is linked and a phone watched it within the last half minute. */
        boolean cloudWatched();

        /** Sends one picture up to the cloud (dropped when the last one is still going). */
        void sendToCloud(byte[] jpeg, int w, int h, int seq);

        /** Takes the last picture away from the cloud. */
        void clearCloud();

        /** The linked account's first name, for the note on the screen; null when it has none. */
        String helperName();
    }

    static final int W = 640, H = 360;
    private static final long TICK_MS = 500L, KEEP_ALIVE_MS = 5_000L, UNWATCHED_MS = 30_000L, LONGEST_MS = 30 * 60_000L;
    private static final int QUALITY = 62;

    private final AccessibilityService service;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService encoder = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "help-encoder");
        t.setDaemon(true);
        t.setPriority(Thread.NORM_PRIORITY - 1);
        return t;
    });
    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            stop();
        }
    };

    private volatile boolean on;
    private boolean taking;
    private long startedAt;
    private volatile long lastAsked;
    private TextView note;

    /** The newest picture, for the door; under {@code this}. */
    private byte[] latest;
    private int seq;
    /** Fingerprint of the last picture sent, and when; encoder thread only. */
    private long sentPrint;
    private long sentAt;

    private final Runnable tick = this::tick;

    HelpMode(AccessibilityService service, Host host) {
        this.service = service;
        this.host = host;
    }

    boolean isOn() {
        return on;
    }

    /** Main thread. */
    void start() {
        lastAsked = SystemClock.elapsedRealtime();
        if (on) return;
        on = true;
        startedAt = SystemClock.elapsedRealtime();
        synchronized (this) {
            latest = null;
        }
        sentPrint = 0L;
        sentAt = 0L;
        try {
            service.registerReceiver(screenOff, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        } catch (RuntimeException ignored) {
            // Then standby ends it through the unwatched timeout instead.
        }
        showNote();
        TvIsland island = HomeKeyService.island();
        if (island != null) {
            island.show(new TvIsland.Event("cc-help", name() + " can see this screen", Words.mark("Orbit help is on, to help you from the phone"),
                    0xFF74D1FF, TvIsland.ICON_PHONE, null, null, 5_000L));
        }
        main.post(tick);
    }

    /** Main thread. */
    void stop() {
        if (!on) return;
        on = false;
        main.removeCallbacks(tick);
        try {
            service.unregisterReceiver(screenOff);
        } catch (RuntimeException notRegistered) {
            // Never registered.
        }
        hideNote();
        synchronized (this) {
            latest = null;
        }
        host.clearCloud();
    }

    /** The door's GET /api/screen: the newest picture and its number, or null while help is off. */
    synchronized Object[] latest() {
        lastAsked = SystemClock.elapsedRealtime();
        return latest == null ? null : new Object[]{latest, seq};
    }

    /** Any thread: the phone asked again (the door read, or a new "on"). */
    void asked() {
        lastAsked = SystemClock.elapsedRealtime();
    }

    private void tick() {
        if (!on) return;
        long now = SystemClock.elapsedRealtime();
        boolean watched = host.cloudWatched() || now - lastAsked < UNWATCHED_MS;
        if (!watched || now - startedAt > LONGEST_MS) {
            stop();
            return;
        }
        main.postDelayed(tick, TICK_MS);
        if (taking) return;
        taking = true;
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, service.getMainExecutor(), new AccessibilityService.TakeScreenshotCallback() {
                @Override
                public void onSuccess(AccessibilityService.ScreenshotResult result) {
                    taking = false;
                    HardwareBuffer buffer = result.getHardwareBuffer();
                    Bitmap screen = Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
                    if (screen == null || !on) {
                        buffer.close();
                        return;
                    }
                    encoder.execute(() -> encode(screen, buffer));
                }

                @Override
                public void onFailure(int error) {
                    taking = false;
                    // Netflix, Prime and the like forbid pictures of their windows: say so instead of a frozen frame.
                    if (error == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW && on) encoder.execute(HelpMode.this::secureFrame);
                    // Anything else (too soon after the last one): the next tick tries again.
                }
            });
        } catch (RuntimeException refused) {
            taking = false;
        }
    }

    /** Encoder thread: shrink, compare with what was sent, keep and send only what changed (or every 5 s). */
    private void encode(Bitmap screen, HardwareBuffer buffer) {
        Bitmap small = null;
        try {
            Bitmap full = screen.copy(Bitmap.Config.ARGB_8888, false);
            if (full == null) return;
            small = Bitmap.createScaledBitmap(full, W, H, true);
            if (small != full) full.recycle();
        } catch (RuntimeException unreadable) {
            return;
        } finally {
            screen.recycle();
            buffer.close();
        }
        encodeSoftware(small);
    }

    /** Encoder thread: a 640 x 360 picture, sent when it differs from the last one sent or that one is 5 s old. */
    private void encodeSoftware(Bitmap small) {
        long print = fingerprint(small);
        long now = SystemClock.elapsedRealtime();
        if (print == sentPrint && now - sentAt < KEEP_ALIVE_MS) {
            small.recycle();
            return;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(48 * 1024);
        small.compress(Bitmap.CompressFormat.JPEG, QUALITY, out);
        small.recycle();
        byte[] jpeg = out.toByteArray();
        int n;
        synchronized (this) {
            if (!on) return;
            latest = jpeg;
            n = ++seq;
        }
        sentPrint = print;
        sentAt = now;
        if (host.cloudWatched()) host.sendToCloud(jpeg, W, H, n);
    }

    /** Encoder thread: a picture that says the app in front hides its screen (it changes nothing, so it goes once). */
    private void secureFrame() {
        Bitmap b = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        android.graphics.Canvas c = new android.graphics.Canvas(b);
        c.drawColor(0xFF0B0F1A);
        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        p.setColor(0xFFFFFFFF);
        p.setTextAlign(android.graphics.Paint.Align.CENTER);
        p.setTextSize(26f);
        c.drawText(Words.t("This app hides its picture"), W / 2f, H / 2f - 8f, p);
        p.setColor(0xB3FFFFFF);
        p.setTextSize(18f);
        c.drawText(Words.t("Netflix and Prime Video do this. Back or Home leaves it."), W / 2f, H / 2f + 26f, p);
        encodeSoftware(b);
    }

    /** 48 x 27 cells of brightness, coarse enough that video noise under a menu does not count as a change. */
    private static long fingerprint(Bitmap b) {
        long h = 1125899906842597L;
        int cols = 48, rows = 27;
        for (int r = 0; r < rows; r++) {
            int y = r * b.getHeight() / rows + b.getHeight() / rows / 2;
            for (int c = 0; c < cols; c++) {
                int x = c * b.getWidth() / cols + b.getWidth() / cols / 2;
                int p = b.getPixel(x, y);
                int lum = (Color.red(p) * 3 + Color.green(p) * 6 + Color.blue(p)) / 10;
                h = 31 * h + (lum >> 3);
            }
        }
        return h;
    }

    private String name() {
        String n = host.helperName();
        return n == null || n.isEmpty() ? "Orbit" : n;
    }

    /** "● Shiv can see this screen", top right, over everything, never taking a key or a touch. */
    private void showNote() {
        if (note != null) return;
        Context c = service;
        TextView t = new TextView(c);
        // The dot in red, like a camera's light: this screen is being seen right now.
        android.text.SpannableString words = new android.text.SpannableString("●  " + Words.t("{name} can see this screen", "name", name()));
        words.setSpan(new android.text.style.ForegroundColorSpan(0xFFFF3B5C), 0, 1, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        t.setText(words);
        t.setTextColor(0xF2FFFFFF);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, 17f * c.getResources().getDisplayMetrics().widthPixels / 1280f);
        try {
            t.setTypeface(c.getResources().getFont(R.font.inter_medium));
        } catch (RuntimeException noFont) {
            // The system font, then.
        }
        int padH = Math.round(16f * c.getResources().getDisplayMetrics().widthPixels / 1280f);
        int padV = Math.round(8f * c.getResources().getDisplayMetrics().widthPixels / 1280f);
        t.setPadding(padH, padV, padH, padV);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xE0101624);
        bg.setStroke(Math.max(1, padV / 6), 0x6674D1FF);
        bg.setCornerRadius(999f);
        t.setBackground(bg);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = padH * 2;
        lp.y = padV * 2 + padV / 2;
        lp.setTitle("OwnerHelpNote");
        lp.windowAnimations = 0;
        try {
            service.getSystemService(WindowManager.class).addView(t, lp);
            note = t;
        } catch (RuntimeException noWindow) {
            note = null;
        }
    }

    private void hideNote() {
        if (note == null) return;
        try {
            service.getSystemService(WindowManager.class).removeView(note);
        } catch (RuntimeException gone) {
            // Already gone with the service.
        }
        note = null;
    }

    /** The service is going away. */
    void release() {
        stop();
        encoder.shutdownNow();
    }
}
