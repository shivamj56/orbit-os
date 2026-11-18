package com.gathin.tvhome;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Choreographer;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Home held down: the apps used lately, as they were last seen, in a row over whatever is on screen. Left and right go
 * through them, OK goes back into one, Back or Home closes the row. The pictures are the ones taken on the way out of each
 * app (AppReturn); an app never left that way shows its banner. Six at most, newest first, kept small in memory.
 */
final class AppSwitcher extends View {

    private static final int MOST = 6;
    private static final long IN_MS = 260L;
    /** Newest last; the pictures at a third of the screen, which is all the row needs. */
    private static final Map<String, Bitmap> pictures = new LinkedHashMap<>(8, 0.75f, true);
    private static final List<String> order = new ArrayList<>();

    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final Paint scrim = new Paint(), glass = new Paint(Paint.ANTI_ALIAS_FLAG), glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint picturePaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final TextPaint label = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final TextPaint heading = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Matrix matrix = new Matrix();
    private final RectF r = new RectF();
    private final float u;
    private final List<String> shown = new ArrayList<>();
    private final List<String> names = new ArrayList<>();
    private final List<Drawable> banners = new ArrayList<>();
    private final List<Integer> accents = new ArrayList<>();
    /** Returned by onKey when Clear all is chosen, in place of a package. */
    static final String CLEAR_ALL = "#clear";
    private boolean added, open, animating, clearFocus;
    private String status = "";
    private long clearingAt;
    private int focus;
    private float x, velocity;
    private long openedAt, lastFrameNs;
    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long nowNs) {
            if (!open) {
                animating = false;
                return;
            }
            float dt = lastFrameNs == 0L ? 1f / 60f : Math.min(0.05f, (nowNs - lastFrameNs) / 1e9f);
            lastFrameNs = nowNs;
            // The same critically damped glide as the row on Home.
            float omega = 15f, error = x - focus, temp = (velocity + omega * error) * dt, decay = (float) Math.exp(-omega * dt);
            velocity = (velocity - omega * temp) * decay;
            x = focus + (error + temp) * decay;
            boolean moving = Math.abs(x - focus) > 0.001f || Math.abs(velocity) > 0.004f;
            if (!moving) {
                x = focus;
                velocity = 0f;
            }
            invalidate();
            boolean flying = clearingAt != 0L && SystemClock.uptimeMillis() - clearingAt < 1200L;
            if (moving || flying || SystemClock.uptimeMillis() - openedAt < IN_MS + 40L) choreographer.postFrameCallback(this);
            else {
                animating = false;
                lastFrameNs = 0L;
            }
        }
    };

    AppSwitcher(Context service) {
        super(service);
        windows = service.getSystemService(WindowManager.class);
        u = service.getResources().getDisplayMetrics().widthPixels / 1280f;
        scrim.setColor(Color.BLACK);
        glass.setColor(0xFF15181D);
        label.setTypeface(service.getResources().getFont(R.font.inter_medium));
        label.setTextSize(17f * u);
        label.setTextAlign(Paint.Align.CENTER);
        label.setColor(0xFFF2F4F8);
        heading.setTypeface(service.getResources().getFont(R.font.inter_light));
        heading.setTextSize(15f * u);
        heading.setLetterSpacing(0.3f);
        heading.setTextAlign(Paint.Align.CENTER);
        heading.setColor(0xFF8F98A8);
        setVisibility(GONE);
    }

    /** An app has come to the front: it goes to the head of the row. */
    static void used(String pkg) {
        order.remove(pkg);
        order.add(pkg);
        while (order.size() > MOST + 2) {
            String oldest = order.remove(0);
            Bitmap b = pictures.remove(oldest);
            if (b != null) b.recycle();
        }
    }

    /** The apps used lately, newest first, as the row would show them: for Clear all from the Control Center. */
    static List<String> recent() {
        List<String> out = new ArrayList<>();
        for (int i = order.size() - 1; i >= 0 && out.size() < MOST; i--) out.add(order.get(i));
        return out;
    }

    /** Closed by Clear all: out of the row until it is used again. */
    static void forget(String pkg) {
        order.remove(pkg);
        Bitmap b = pictures.remove(pkg);
        if (b != null) b.recycle();
    }

    /** The app's last picture, already small and in memory the app's own (not the screen's). */
    static void remember(String pkg, Bitmap small) {
        Bitmap old = pictures.put(pkg, small);
        if (old != null && old != small) old.recycle();
    }

    boolean isOpen() {
        return open;
    }

    /** Opens the row; false when there is nothing to show yet, or no window for it. */
    boolean open(String front) {
        if (open) return true;
        shown.clear();
        names.clear();
        banners.clear();
        accents.clear();
        PackageManager pm = getContext().getPackageManager();
        for (int i = order.size() - 1; i >= 0 && shown.size() < MOST; i--) {
            String pkg = order.get(i);
            try {
                CharSequence name = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0));
                Drawable banner = pm.getApplicationBanner(pkg);
                if (banner == null) banner = pm.getApplicationIcon(pkg);
                shown.add(pkg);
                names.add(name.toString());
                banners.add(banner);
                Bitmap p = pictures.get(pkg);
                accents.add(p != null ? GalleryArt.accentsOf(p)[0] : 0xFF74D1FF);
            } catch (PackageManager.NameNotFoundException gone) {
                // Uninstalled since: just not in the row.
            }
        }
        if (shown.isEmpty() || !ensureWindow()) return false;
        // The app in front is first; the one before it is where the focus starts, as on a phone.
        focus = shown.size() > 1 && shown.get(0).equals(front) ? 1 : 0;
        x = focus;
        velocity = 0f;
        open = true;
        openedAt = SystemClock.uptimeMillis();
        setAlpha(1f);
        setVisibility(VISIBLE);
        wake();
        return true;
    }

    /** The apps in the row, for Clear all. */
    List<String> packages() {
        return new ArrayList<>(shown);
    }

    /** The cards fly off and the line under them says what is happening. */
    void clearing(String line) {
        if (clearingAt == 0L) clearingAt = SystemClock.uptimeMillis();
        status = line;
        wake();
    }

    void setStatus(String line) {
        status = line;
        invalidate();
    }

    void close() {
        clearFocus = false;
        clearingAt = 0L;
        status = "";
        open = false;
        setVisibility(GONE);
        banners.clear();
    }

    /** Keys while the row is open; all of them are its own. Returns the app chosen on OK's release, else null. */
    String onKey(KeyEvent e) {
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (down && clearingAt == 0L) {
                    clearFocus = true;
                    invalidate();
                }
                return null;
            case KeyEvent.KEYCODE_DPAD_UP:
                if (down && clearingAt == 0L) {
                    clearFocus = false;
                    invalidate();
                }
                return null;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (down && focus > 0 && !clearFocus) {
                    focus--;
                    wake();
                }
                return null;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down && focus < shown.size() - 1 && !clearFocus) {
                    focus++;
                    wake();
                }
                return null;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (!down && !e.isCanceled() && clearingAt == 0L) {
                    if (clearFocus) return CLEAR_ALL;
                    String pkg = shown.get(focus);
                    close();
                    return pkg;
                }
                return null;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_HOME:
                if (!down) close();
                return null;
            default:
                return null;
        }
    }

    /** The app's own launch, as the remote's buttons do it: a running app comes back where it was. */
    static Intent launchIntent(Context c, String pkg) {
        PackageManager pm = c.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i != null) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return i;
    }

    private void wake() {
        invalidate();
        if (animating) return;
        animating = true;
        lastFrameNs = 0L;
        choreographer.postFrameCallback(frame);
    }

    private boolean ensureWindow() {
        if (added) return true;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.setTitle("OwnerAppSwitcher");
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

    void release() {
        close();
        if (added) windows.removeView(this);
        added = false;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (!open) return;
        float t = Math.min(1f, (SystemClock.uptimeMillis() - openedAt) / (float) IN_MS);
        float e = 1f - (1f - t) * (1f - t) * (1f - t);
        scrim.setAlpha(Math.round(205f * e));
        c.drawRect(0, 0, getWidth(), getHeight(), scrim);
        heading.setAlpha(Math.round(255f * e));
        c.drawText("RECENT", getWidth() / 2f, 196f * u - (1f - e) * 10f * u, heading);
        float cardW = 300f * u, cardH = cardW * 9f / 16f, gap = 34f * u, mid = getWidth() / 2f, cy = 360f * u + (1f - e) * 40f * u;
        for (int i = 0; i < shown.size(); i++) {
            float d = i - x;
            float near = (float) Math.exp(-d * d * 2.2f);
            float s = 1f + 0.14f * near;
            float w = cardW * s, h = cardH * s, cx = mid + d * (cardW + gap) + Math.signum(d) * Math.min(1f, Math.abs(d)) * 0.07f * cardW;
            if (cx + w / 2f < 0f || cx - w / 2f > getWidth()) continue;
            float fly = clearingAt == 0L ? 0f : Math.max(0f, Math.min(1f, (SystemClock.uptimeMillis() - clearingAt - i * 90L) / 450f));
            fly = fly * fly * fly;
            if (fly >= 1f) continue;
            r.set(cx - w / 2f, cy - h / 2f - fly * 300f * u, cx + w / 2f, cy + h / 2f - fly * 300f * u);
            float radius = 18f * u;
            int alpha = Math.round(255f * e * (0.55f + 0.45f * near) * (1f - fly));
            if (near > 0.2f) {
                glow.setColor(accents.get(i));
                glow.setAlpha(Math.round(70f * near * e));
                c.drawRoundRect(r.left - 6f * u, r.top - 6f * u, r.right + 6f * u, r.bottom + 6f * u, radius + 6f * u, radius + 6f * u, glow);
            }
            glass.setAlpha(alpha);
            c.drawRoundRect(r, radius, radius, glass);
            Bitmap p = pictures.get(shown.get(i));
            if (p != null && !p.isRecycled()) {
                BitmapShader sh = new BitmapShader(p, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
                float sc = Math.max(r.width() / p.getWidth(), r.height() / p.getHeight());
                matrix.setScale(sc, sc);
                matrix.postTranslate(r.centerX() - p.getWidth() * sc / 2f, r.centerY() - p.getHeight() * sc / 2f);
                sh.setLocalMatrix(matrix);
                picturePaint.setShader(sh);
                picturePaint.setAlpha(alpha);
                c.drawRoundRect(r, radius, radius, picturePaint);
            } else {
                Drawable b = banners.get(i);
                int bw = Math.round(r.width() * 0.62f), bh = Math.round(bw * 9f / 16f);
                b.setBounds(Math.round(r.centerX() - bw / 2f), Math.round(r.centerY() - bh / 2f), Math.round(r.centerX() + bw / 2f), Math.round(r.centerY() + bh / 2f));
                b.setAlpha(alpha);
                b.draw(c);
            }
            label.setAlpha(Math.round(255f * e * (0.35f + 0.65f * near) * (1f - fly)));
            c.drawText(TextUtils.ellipsize(names.get(i), label, w, TextUtils.TruncateAt.END).toString(), cx, r.bottom + 34f * u, label);
        }
        drawClear(c, e);
    }

    /** Under the row: Clear all, and how much memory is free (or which app it is closing). */
    private void drawClear(Canvas c, float e) {
        String text = Words.t("Clear all");
        float tw = label.measureText(text), sw = heading.measureText(status);
        float pw = 44f * u + tw + (status.isEmpty() ? 0f : 18f * u + sw), ph = 46f * u;
        float cx = getWidth() / 2f, top = 560f * u;
        r.set(cx - pw / 2f, top, cx + pw / 2f, top + ph);
        boolean on = clearFocus || clearingAt != 0L;
        glass.setAlpha(Math.round(230f * e));
        glass.setColor(on ? 0xFF16302A : 0xFF15181D);
        glass.setAlpha(Math.round(230f * e));
        c.drawRoundRect(r, ph / 2f, ph / 2f, glass);
        glow.setColor(on ? 0xFF4BE3A0 : 0x33FFFFFF);
        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeWidth((on ? 1.6f : 1f) * u);
        glow.setAlpha(Math.round((on ? 200f : 50f) * e));
        c.drawRoundRect(r, ph / 2f, ph / 2f, glow);
        glow.setStyle(Paint.Style.FILL);
        label.setAlpha(Math.round(255f * e));
        label.setTextAlign(Paint.Align.LEFT);
        float base = top + ph / 2f + 6f * u;
        c.drawText(text, r.left + 22f * u, base, label);
        label.setTextAlign(Paint.Align.CENTER);
        if (!status.isEmpty()) {
            heading.setTextAlign(Paint.Align.LEFT);
            heading.setAlpha(Math.round(255f * e));
            c.drawText(status, r.left + 22f * u + tw + 18f * u, base - 1f * u, heading);
            heading.setTextAlign(Paint.Align.CENTER);
        }
        glass.setColor(0xFF15181D);
    }
}
