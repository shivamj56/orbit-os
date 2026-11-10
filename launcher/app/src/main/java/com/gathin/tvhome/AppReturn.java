package com.gathin.tvhome;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.View;
import android.view.WindowManager;

/**
 * The way back to Home: the app's last picture shrinks into its card in the row, the way a phone puts an app away, while
 * Home opens underneath. A picture the app protects (a film playing in Netflix, say) comes out black, and then the app's
 * card itself goes back into the row instead. In a window of the helper's, above everything, taking no keys.
 */
final class AppReturn extends View {

    private static final long SHRINK_MS = 420L, FADE_FROM = 300L;

    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final Paint picturePaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint shade = new Paint();
    private final Matrix matrix = new Matrix();
    private final RectF from = new RectF(), to = new RectF(), now = new RectF();
    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long t) {
            if (!active) return;
            if (SystemClock.uptimeMillis() - beganAt >= SHRINK_MS) {
                finish();
                return;
            }
            invalidate();
            choreographer.postFrameCallback(this);
        }
    };
    private boolean added, active;
    private Bitmap picture;
    private android.hardware.HardwareBuffer buffer;
    private GalleryArt.Card card;
    private GalleryHomeView home;
    private long beganAt;

    AppReturn(Context service) {
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
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.setTitle("OwnerAppReturn");
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

    /**
     * Shows the app's picture where it is, full screen, at once; call {@link #go} once Home has been asked for. The picture
     * is the helper's to recycle: this keeps it only until the animation ends.
     */
    boolean hold(Bitmap picture, android.hardware.HardwareBuffer buffer) {
        if (active || !ensureWindow()) return false;
        this.picture = picture;
        this.buffer = buffer;
        this.card = null;
        this.home = null;
        active = true;
        beganAt = Long.MAX_VALUE;
        setAlpha(1f);
        setVisibility(VISIBLE);
        invalidate();
        return true;
    }

    /** Off it goes, towards the middle card of the row, which is the app that was open. */
    void go(GalleryHomeView home, GalleryArt.Card card) {
        if (!active) return;
        this.home = home;
        this.card = card;
        beganAt = SystemClock.uptimeMillis();
        choreographer.postFrameCallback(frame);
        // Should no frame ever come (the screen went off), this still ends.
        postDelayed(this::finish, SHRINK_MS + 600L);
    }

    void cancel() {
        if (active) finish();
    }

    private void finish() {
        if (!active) return;
        active = false;
        choreographer.removeFrameCallback(frame);
        setVisibility(GONE);
        // The screenshot's memory goes back at once: it is a whole screen's worth.
        if (picture != null) picture.recycle();
        if (buffer != null) buffer.close();
        picture = null;
        buffer = null;
        card = null;
        home = null;
    }

    void release() {
        cancel();
        if (added) windows.removeView(this);
        added = false;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (!active || picture == null) return;
        float w = getWidth(), h = getHeight();
        from.set(0f, 0f, w, h);
        float t = beganAt == Long.MAX_VALUE ? 0f : Math.min(1f, (SystemClock.uptimeMillis() - beganAt) / (float) SHRINK_MS);
        // Quick to start, gentle to land.
        float e = t < 0.5f ? 4f * t * t * t : 1f - (float) Math.pow(-2f * t + 2f, 3f) / 2f;
        if (home != null) home.focusedCardRect(to);
        else to.set(w * 0.43f, h * 0.36f, w * 0.57f, h * 0.66f);
        if (card != null && home != null) {
            // A protected picture: the card goes back instead, from the size it came forward to.
            home.drawOpening(c, card, 1f - e, 0f);
            setAlpha(1f - Math.max(0f, (t - 0.7f) / 0.3f));
            return;
        }
        // The picture keeps its own shape until it is nearly home, then takes the card's.
        float morph = Math.max(0f, (e - 0.55f) / 0.45f);
        float targetW = to.width() + (to.height() * w / h - to.width()) * (1f - morph);
        float cx = from.centerX() + (to.centerX() - from.centerX()) * e;
        float cy = from.centerY() + (to.centerY() - from.centerY()) * e;
        float nw = from.width() + (targetW - from.width()) * e, nh = from.height() + (to.height() - from.height()) * e;
        now.set(cx - nw / 2f, cy - nh / 2f, cx + nw / 2f, cy + nh / 2f);
        BitmapShader shader = new BitmapShader(picture, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        // Cover: the picture fills the shrinking frame and is cut to it, as it narrows towards the card.
        float scale = Math.max(now.width() / picture.getWidth(), now.height() / picture.getHeight());
        matrix.setScale(scale, scale);
        matrix.postTranslate(now.centerX() - picture.getWidth() * scale / 2f, now.centerY() - picture.getHeight() * scale / 2f);
        shader.setLocalMatrix(matrix);
        picturePaint.setShader(shader);
        float fade = Math.max(0f, (SystemClock.uptimeMillis() - beganAt - FADE_FROM) / (float) (SHRINK_MS - FADE_FROM));
        picturePaint.setAlpha(Math.round(255f * (1f - Math.min(1f, fade))));
        float radius = 24f * w / 1280f * e;
        c.drawRoundRect(now, radius, radius, picturePaint);
        if (e > 0f) {
            shade.setColor(Color.BLACK);
            shade.setAlpha(Math.round(70f * e * (1f - Math.min(1f, fade))));
            c.drawRoundRect(now, radius, radius, shade);
        }
    }
}
