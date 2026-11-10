package com.gathin.tvhome;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.PixelFormat;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.View;
import android.view.WindowManager;

/**
 * What the remote's OK does on this TV. Android's own opening is over in a tenth of a second, and then the screen stays empty
 * until the app has its first frame, one to two seconds of nothing that feels like a hang. So the card comes forward here
 * instead, in a window of the helper's that stays above whatever the system does underneath, until the app's window is there,
 * and then it dissolves into the app. The app itself starts as soon as this has its first frame up. It draws nothing the app
 * could feel: it takes no keys, and any key takes it away. It also goes by itself if the app never shows.
 */
final class AppOpening extends View {

    /** The card's way forward. */
    private static final long ZOOM_MS = 320L;
    private static final long FADE_MS = 220L, QUICK_FADE_MS = 110L;
    /**
     * The app's window is up but has not drawn anything yet at the moment it says so. An app starting from nothing then still
     * has its first picture to make; one that was in memory has it ready. The way to tell them apart is how long it took.
     */
    private static final long AFTER_WINDOW_MS = 120L, AFTER_WINDOW_FROM_NOTHING_MS = 350L, FROM_NOTHING_AFTER_MS = 600L;
    /** An app that never shows must not leave this over the TV. */
    private static final long LONGEST_MS = 6000L;
    private static final long HOME_LEAVES_WITHIN_MS = 2500L;
    /** Should the first frame's report not come, the app still starts. */
    private static final long START_ANYWAY_MS = 120L;

    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            if (!active) return;
            tick++;
            long t = SystemClock.uptimeMillis();
            if (fadeFrom != 0L) {
                float gone = (t - fadeFrom) / (float) fadeLength;
                if (gone >= 1f) {
                    finish();
                    return;
                }
                setAlpha(1f - gone);
            } else if (fadeWhen != 0L && t >= fadeWhen) {
                fadeFrom = t;
            }
            // While it only waits, every other frame is plenty: the app is starting and needs the processor more.
            if (t - beganAt < ZOOM_MS + 40L || (fadeFrom == 0L && tick % 2 == 0)) invalidate();
            choreographer.postFrameCallback(this);
        }
    };
    private final Runnable giveUp = () -> fadeOut(FADE_MS);
    private final Runnable checkLeft = this::checkHomeLeft;
    private final Runnable startApp = this::startAppNow;

    private boolean added, active, drawnOnce, appStarted;
    private GalleryHomeView home;
    private GalleryArt.Card card;
    private Bitmap picture;
    private Runnable start;
    private String pkg;
    private long beganAt, fadeWhen, fadeFrom, fadeLength, windowAt;
    private int tick;

    AppOpening(Context service) {
        super(service);
        windows = service.getSystemService(WindowManager.class);
        setVisibility(GONE);
    }

    private boolean ensureWindow() {
        if (added) return true;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        // A service's window gets no hardware drawing unless it asks.
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.setTitle("OwnerAppOpening");
        lp.setFitInsetsTypes(0);
        lp.windowAnimations = 0;
        try {
            windows.addView(this, lp);
            added = true;
        } catch (RuntimeException noWindow) {
            added = false;
        }
        return added;
    }

    /** An app's card from the row. False if this cannot be shown: then nothing has happened, and the caller opens the app itself. */
    boolean begin(GalleryHomeView home, GalleryArt.Card card, String pkg, Runnable start) {
        return begin(home, card, null, pkg, start);
    }

    /** A video's picture from the recents page. {@code pkg} may be empty, when only the app's own launch can tell. */
    boolean begin(GalleryHomeView home, Bitmap picture, String pkg, Runnable start) {
        return begin(home, null, picture, pkg, start);
    }

    private boolean begin(GalleryHomeView home, GalleryArt.Card card, Bitmap picture, String pkg, Runnable start) {
        if (active || !ensureWindow()) return false;
        this.home = home;
        this.card = card;
        this.picture = picture;
        this.pkg = pkg;
        this.start = start;
        active = true;
        drawnOnce = false;
        appStarted = false;
        beganAt = SystemClock.uptimeMillis();
        fadeWhen = 0L;
        fadeFrom = 0L;
        windowAt = 0L;
        tick = 0;
        setAlpha(1f);
        setVisibility(VISIBLE);
        invalidate();
        choreographer.postFrameCallback(frame);
        postDelayed(startApp, START_ANYWAY_MS);
        postDelayed(giveUp, LONGEST_MS);
        return true;
    }

    private void startAppNow() {
        if (appStarted || !active) return;
        appStarted = true;
        removeCallbacks(startApp);
        Runnable go = start;
        start = null;
        if (go != null) go.run();
        postDelayed(checkLeft, HOME_LEAVES_WITHIN_MS);
    }

    /** Home did not go away: the app could not be opened, and the message saying so is waiting under this. */
    private void checkHomeLeft() {
        if (active && home != null && home.isResumedNow()) fadeOut(QUICK_FADE_MS);
    }

    /**
     * A window has come up. The system's own empty starting window comes first and says it is the app's, hence the class:
     * only one of the app's activities means the app itself is there.
     */
    void onWindow(CharSequence windowPackage, CharSequence windowClass) {
        if (!active) return;
        if (windowAt != 0L || pkg == null || windowPackage == null || windowClass == null || !pkg.contentEquals(windowPackage)) return;
        try {
            getContext().getPackageManager().getActivityInfo(new ComponentName(pkg, windowClass.toString()), 0);
        } catch (PackageManager.NameNotFoundException notAnActivity) {
            return;
        }
        windowAt = SystemClock.uptimeMillis();
        long after = windowAt - beganAt >= FROM_NOTHING_AFTER_MS ? AFTER_WINDOW_FROM_NOTHING_MS : AFTER_WINDOW_MS;
        // The card's way forward always finishes: an app that was already running would otherwise cut it off after a frame.
        fadeWhen = Math.max(windowAt + after, beganAt + ZOOM_MS);
        fadeLength = FADE_MS;
    }

    /** Any key: the screen is the app's or Home's again at once. */
    void onAnyKey() {
        if (active) fadeOut(QUICK_FADE_MS);
    }

    /** Home is in front again: the app did not stay. */
    void onHomeBack() {
        if (active && appStarted) fadeOut(QUICK_FADE_MS);
    }

    private void fadeOut(long length) {
        if (!active || fadeFrom != 0L) return;
        fadeLength = length;
        fadeFrom = SystemClock.uptimeMillis();
    }

    private void finish() {
        active = false;
        removeCallbacks(giveUp);
        removeCallbacks(startApp);
        removeCallbacks(checkLeft);
        choreographer.removeFrameCallback(frame);
        setVisibility(GONE);
        // An app that was asked for must still open, even if a key came first.
        if (!appStarted) startAppNow();
        home = null;
        card = null;
        picture = null;
        start = null;
    }

    void release() {
        if (active) finish();
        if (added) windows.removeView(this);
        added = false;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (!active || home == null) return;
        long t = SystemClock.uptimeMillis() - beganAt;
        float x = Math.min(1f, t / (float) ZOOM_MS);
        float open = 1f - (1f - x) * (1f - x) * (1f - x);
        float waited = Math.max(0f, (t - ZOOM_MS) / 1000f);
        if (card != null) home.drawOpening(c, card, open, waited);
        else if (picture != null) home.drawOpeningPicture(c, picture, open, waited);
        if (!drawnOnce) {
            drawnOnce = true;
            getViewTreeObserver().registerFrameCommitCallback(this::startAppNow);
        }
    }
}
