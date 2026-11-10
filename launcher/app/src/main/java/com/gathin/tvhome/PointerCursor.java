package com.gathin.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.animation.ValueAnimator;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.Shader;
import android.graphics.SweepGradient;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * The phone's pointer on the TV, for Orbit's Cursor mode: a small ring the phone's globe moves over whatever is on the
 * screen, and a click where it stands. TV apps are made for the remote, so the click goes the way they can take it: the
 * clickable thing under the ring is clicked through accessibility (nearly every app answers that), and a thing that can
 * only be focused gets the focus and the remote's OK. Home draws its own row, so Home gets the click itself. A tap
 * played at the point comes last, and only on a box with a touch screen: Android drops an accessibility service's taps
 * on a TV that has neither touchscreen nor faketouch, as this Xiaomi has not (found 10 Nov), and there OK goes to what
 * has the focus instead. Scrolling works the same way: the list under the ring, then a swipe or the remote's arrows.
 *
 * <p>Moves come in on the door's datagram thread, up to 60 a second; they only add up where the ring should go, and its
 * small window moves once on the main thread for however many came in meanwhile. The ring fades after a few seconds
 * without a move. The look-ups in the app's views run on a thread of their own, never the main one: an app that hangs
 * must not take Home's keys or the door with it.
 */
final class PointerCursor extends View {

    private static final long IDLE_MS = 4_000L, FADE_MS = 260L, PRESS_MS = 420L;
    private static final long SCROLL_GAP_MS = 140L;
    /** How far the globe has to roll, in 1280-wide pixels, for one step of the list under the ring. */
    private static final float SCROLL_STEP = 48f;
    private static final int DEEPEST = 40;

    private final AccessibilityService service;
    private final WindowManager windows;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final HandlerThread workThread = new HandlerThread("orbit-pointer");
    private final Handler work;
    private final float u;
    private final int size, screenW, screenH;
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG), shade = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG), dot = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ripple = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final WindowManager.LayoutParams lp;
    private final Runnable applyMoves = this::applyMoves, fadeOut = this::fadeOut;
    /** Whether Android plays this service's taps here: only with a touch screen, or a pointer that stands in for one. */
    private final boolean canTouch;
    private boolean added, released;
    /** Where the ring stands, in screen pixels: written on the main thread, read by clicks on the work thread. */
    private volatile float x, y;
    /** Moves and scrolls that came in and are not applied yet, in screen pixels. Under {@code this}. */
    private float pendingX, pendingY, scrollX, scrollY;
    private boolean movePosted, scrollPosted;
    private long lastScrollAt;
    private float press;
    private ValueAnimator pressing, fading;

    PointerCursor(AccessibilityService service) {
        super(service);
        this.service = service;
        windows = service.getSystemService(WindowManager.class);
        DisplayMetrics metrics = service.getResources().getDisplayMetrics();
        screenW = metrics.widthPixels;
        screenH = metrics.heightPixels;
        u = screenW / 1280f;
        size = Math.round(64f * u);
        x = screenW / 2f;
        y = screenH / 2f;
        PackageManager pm = service.getPackageManager();
        canTouch = pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN) || pm.hasSystemFeature(PackageManager.FEATURE_FAKETOUCH);
        workThread.start();
        work = new Handler(workThread.getLooper());

        float c = size / 2f;
        glow.setShader(new RadialGradient(c, c, 26f * u, new int[] {0x5574D1FF, 0x2274D1FF, 0x0074D1FF},
                new float[] {0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
        shade.setStyle(Paint.Style.STROKE);
        shade.setStrokeWidth(5f * u);
        shade.setColor(0x66000000);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(2.6f * u);
        // The halo's own colours, the same as the Island's ribbon.
        ring.setShader(new SweepGradient(c, c, new int[] {0xFF74D1FF, 0xFFFF74D1, 0xFFFFE9B3, 0xFF74D1FF}, null));
        dot.setColor(0xFFFFFFFF);
        ripple.setStyle(Paint.Style.STROKE);
        ripple.setStrokeWidth(2f * u);
        ripple.setColor(0xFFFFFFFF);
        setLayerType(LAYER_TYPE_HARDWARE, null);

        lp = new WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.setTitle("OwnerPointer");
        lp.setFitInsetsTypes(0);
        lp.windowAnimations = 0;
        place();
    }

    /** From the door's datagram thread: the globe rolled by this much (1280-wide pixels). */
    void move(float dx, float dy) {
        synchronized (this) {
            pendingX += dx * u;
            pendingY += dy * u;
            if (movePosted) return;
            movePosted = true;
        }
        main.post(applyMoves);
    }

    /** From the door's datagram thread: two fingers moved by this much; positive dy shows what is further down. */
    void scroll(float dx, float dy) {
        synchronized (this) {
            scrollX += dx;
            scrollY += dy;
            if (scrollPosted) return;
            scrollPosted = true;
        }
        work.post(this::applyScroll);
    }

    /** A click where the ring stands, which shows itself there (in the middle of the screen before the first move). */
    void click(boolean longPress) {
        final int px = Math.round(x), py = Math.round(y);
        main.post(() -> {
            if (released || !ensureWindow()) return;
            if (fading != null) fading.cancel();
            setAlpha(1f);
            setVisibility(VISIBLE);
            pressed();
            main.removeCallbacks(fadeOut);
            main.postDelayed(fadeOut, IDLE_MS);
        });
        work.post(() -> {
            AccessibilityNodeInfo root = activeRoot();
            // Home draws its own row: the click goes straight to it, in this same process.
            if (root != null && service.getPackageName().contentEquals(String.valueOf(root.getPackageName()))) {
                main.post(() -> {
                    GalleryHomeView home = GalleryHomeView.alive();
                    if (home != null) home.tapAt(px, py);
                });
                return;
            }
            if (root != null && clickAt(root, px, py, longPress)) return;
            if (canTouch) tap(px, py, longPress ? 700L : 60L);
            // No touch screen, so no tap: OK goes to whatever has the focus, which is what the click meant in most apps.
            else if (!longPress && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_DPAD_CENTER);
            }
        });
    }

    void hide() {
        main.removeCallbacks(fadeOut);
        main.post(fadeOut);
    }

    /** Help mode: the phone tapped this spot of its picture of the screen (1280-wide pixels): jump there and click. */
    void tapAt(float tx, float ty) {
        main.post(() -> {
            if (released) return;
            x = Math.max(0f, Math.min(screenW - 1f, tx * u));
            y = Math.max(0f, Math.min(screenH - 1f, ty * u));
            place();
            if (!ensureWindow()) return;
            if (fading != null) fading.cancel();
            setAlpha(1f);
            setVisibility(VISIBLE);
            windows.updateViewLayout(this, lp);
            // click() reads x and y as it is called, so it clicks where the ring now stands.
            click(false);
        });
    }

    void release() {
        released = true;
        main.removeCallbacks(applyMoves);
        main.removeCallbacks(fadeOut);
        if (pressing != null) pressing.cancel();
        if (fading != null) fading.cancel();
        if (added) {
            try {
                windows.removeView(this);
            } catch (RuntimeException gone) {
                // Already taken away with the service.
            }
        }
        added = false;
        workThread.quitSafely();
    }

    // ---- moving ----

    private void applyMoves() {
        float dx, dy;
        synchronized (this) {
            dx = pendingX;
            dy = pendingY;
            pendingX = pendingY = 0f;
            movePosted = false;
        }
        if (released) return;
        x = Math.max(0f, Math.min(screenW - 1f, x + dx));
        y = Math.max(0f, Math.min(screenH - 1f, y + dy));
        place();
        if (!ensureWindow()) return;
        if (fading != null) fading.cancel();
        setAlpha(1f);
        setVisibility(VISIBLE);
        windows.updateViewLayout(this, lp);
        main.removeCallbacks(fadeOut);
        main.postDelayed(fadeOut, IDLE_MS);
    }

    private void place() {
        lp.x = Math.round(x - size / 2f);
        lp.y = Math.round(y - size / 2f);
    }

    private boolean ensureWindow() {
        if (added) return true;
        try {
            windows.addView(this, lp);
            added = true;
        } catch (RuntimeException noWindow) {
            added = false;
        }
        return added;
    }

    private void fadeOut() {
        if (!added || getVisibility() != VISIBLE) return;
        if (fading != null) fading.cancel();
        fading = ValueAnimator.ofFloat(getAlpha(), 0f).setDuration(FADE_MS);
        fading.addUpdateListener(a -> {
            setAlpha((float) a.getAnimatedValue());
            if (a.getAnimatedFraction() >= 1f) setVisibility(GONE);
        });
        fading.start();
    }

    private void pressed() {
        if (pressing != null) pressing.cancel();
        pressing = ValueAnimator.ofFloat(0f, 1f).setDuration(PRESS_MS);
        pressing.addUpdateListener(a -> {
            press = (float) a.getAnimatedValue();
            invalidate();
        });
        pressing.start();
    }

    @Override
    protected void onDraw(Canvas c) {
        float mid = size / 2f;
        // The ring dips at the start of a click and a thin circle leaves it, like a drop on water.
        float dip = press > 0f && press < 1f ? 1f - 0.18f * (float) Math.sin(Math.PI * Math.min(1f, press * 2.2f)) : 1f;
        float r = 10.5f * u * dip;
        c.drawCircle(mid, mid, 24f * u, glow);
        c.drawCircle(mid, mid, r, shade);
        c.drawCircle(mid, mid, r, ring);
        c.drawCircle(mid, mid, 2.4f * u, dot);
        if (press > 0f && press < 1f) {
            ripple.setAlpha(Math.round(255 * (1f - press)));
            c.drawCircle(mid, mid, r + press * 18f * u, ripple);
        }
    }

    // ---- clicking and scrolling, on the work thread ----

    private boolean clickAt(AccessibilityNodeInfo root, int px, int py, boolean longPress) {
        AccessibilityNodeInfo target = deepest(root, px, py, longPress ? Want.LONG_CLICK : Want.CLICK, 0, new Rect());
        int action = longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
        if (target != null && target.performAction(action)) return true;
        // Built for the remote only: give it the focus, then the remote's own OK.
        AccessibilityNodeInfo focusable = longPress ? null : deepest(root, px, py, Want.FOCUS, 0, new Rect());
        if (focusable != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && (focusable.isFocused() || focusable.performAction(AccessibilityNodeInfo.ACTION_FOCUS))) {
            return service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_DPAD_CENTER);
        }
        return false;
    }

    private void applyScroll() {
        float dx, dy;
        synchronized (this) {
            dx = scrollX;
            dy = scrollY;
            scrollPosted = false;
        }
        long now = SystemClock.uptimeMillis();
        boolean vertical = Math.abs(dy) >= Math.abs(dx);
        float amount = vertical ? dy : dx;
        if (Math.abs(amount) < SCROLL_STEP || now - lastScrollAt < SCROLL_GAP_MS) {
            if (Math.abs(amount) >= SCROLL_STEP) {
                synchronized (this) {
                    if (!scrollPosted) {
                        scrollPosted = true;
                        work.postDelayed(this::applyScroll, SCROLL_GAP_MS - (now - lastScrollAt));
                    }
                }
            }
            return;
        }
        synchronized (this) {
            // One step used; the rest stays for the next one, and the other direction is dropped.
            if (vertical) {
                scrollY -= Math.copySign(SCROLL_STEP, amount);
                scrollX = 0f;
            } else {
                scrollX -= Math.copySign(SCROLL_STEP, amount);
                scrollY = 0f;
            }
        }
        lastScrollAt = now;
        int px = Math.round(x), py = Math.round(y);
        AccessibilityNodeInfo list = nodeAt(px, py, Want.SCROLL);
        boolean done = false;
        if (list != null) {
            AccessibilityNodeInfo.AccessibilityAction step = vertical
                    ? (amount > 0 ? AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN
                            : AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP)
                    : (amount > 0 ? AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT
                            : AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT);
            done = list.getActionList().contains(step) && list.performAction(step.getId());
            if (!done) {
                done = list.performAction(amount > 0 ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                        : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
            }
        }
        if (!done && canTouch) {
            // A swipe the other way: to see what is further down, the content moves up.
            float reach = 180f * u, toX = px, toY = py;
            if (vertical) toY = amount > 0 ? py - reach : py + reach;
            else toX = amount > 0 ? px - reach : px + reach;
            swipe(px, py, Math.max(0f, Math.min(screenW - 1f, toX)), Math.max(0f, Math.min(screenH - 1f, toY)));
        } else if (!done && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // The remote's arrows move a TV list just as well.
            service.performGlobalAction(vertical
                    ? (amount > 0 ? AccessibilityService.GLOBAL_ACTION_DPAD_DOWN : AccessibilityService.GLOBAL_ACTION_DPAD_UP)
                    : (amount > 0 ? AccessibilityService.GLOBAL_ACTION_DPAD_RIGHT : AccessibilityService.GLOBAL_ACTION_DPAD_LEFT));
        }
        synchronized (this) {
            if (!scrollPosted && Math.abs(scrollY) + Math.abs(scrollX) >= SCROLL_STEP) {
                scrollPosted = true;
                work.postDelayed(this::applyScroll, SCROLL_GAP_MS);
            }
        }
    }

    private enum Want { CLICK, LONG_CLICK, FOCUS, SCROLL }

    /** The deepest node under the point that can take what is wanted, topmost first; null for none or no access. */
    private AccessibilityNodeInfo nodeAt(int px, int py, Want want) {
        AccessibilityNodeInfo root = activeRoot();
        return root == null ? null : deepest(root, px, py, want, 0, new Rect());
    }

    private AccessibilityNodeInfo activeRoot() {
        try {
            return service.getRootInActiveWindow();
        } catch (RuntimeException noWindowAccess) {
            return null;
        }
    }

    private static AccessibilityNodeInfo deepest(AccessibilityNodeInfo node, int px, int py, Want want, int depth, Rect r) {
        if (depth > DEEPEST || !node.isVisibleToUser()) return null;
        node.getBoundsInScreen(r);
        if (!r.contains(px, py)) return null;
        // Children drawn last are on top.
        for (int i = node.getChildCount() - 1; i >= 0; i--) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            AccessibilityNodeInfo found = deepest(child, px, py, want, depth + 1, r);
            if (found != null) return found;
        }
        return takes(node, want) ? node : null;
    }

    private static boolean takes(AccessibilityNodeInfo node, Want want) {
        switch (want) {
            case CLICK: return node.isClickable() && node.isEnabled();
            case LONG_CLICK: return node.isLongClickable() && node.isEnabled();
            case FOCUS: return node.isFocusable() && node.isEnabled();
            default: return node.isScrollable();
        }
    }

    private void tap(float px, float py, long duration) {
        Path at = new Path();
        at.moveTo(px, py);
        dispatch(at, duration);
    }

    private void swipe(float fromX, float fromY, float toX, float toY) {
        Path path = new Path();
        path.moveTo(fromX, fromY);
        path.lineTo(toX, toY);
        dispatch(path, 220L);
    }

    private void dispatch(Path path, long duration) {
        try {
            service.dispatchGesture(new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(path, 0L, duration)).build(), null, null);
        } catch (RuntimeException notAllowed) {
            // Without canPerformGestures (an older install) the click above is all there is.
        }
    }
}
