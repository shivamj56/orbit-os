package com.gathin.tvhome;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Choreographer;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

import java.util.ArrayDeque;

/**
 * What just happened, said at the top of the screen in place of the firmware's assorted pop-ups: headphones connected and
 * their battery, the internet gone and back, an HDMI device plugged in, an app's notification, the phone's pairing code,
 * the score. No box: the TV's top edge itself lights up in a ribbon of the owner's colours, the event's colour in the
 * middle, grows out from the centre, and the words float under it on a soft dark veil (the owner's pick, "किनारा", of four
 * designs). On Home the greeting sinks a little and dims while it speaks (setWatcher). New words in the one showing
 * reshape it in place. Nothing is drawn between events: the window is gone. It takes no keys.
 */
final class TvIsland extends View {

    static final int ICON_NONE = 0, ICON_HEADPHONES = 1, ICON_OFFLINE = 2, ICON_ONLINE = 3, ICON_HDMI = 4, ICON_PHONE = 5,
            ICON_FILM = 6, ICON_BAT = 7;

    static final class Event {
        final String title, detail;
        final int accent, glyph;
        final Bitmap icon;
        final boolean[][] qr;
        final long holdMs;
        /** Events with the same key replace each other instead of queueing (the battery after the connection, say). */
        final String key;

        Event(String key, String title, String detail, int accent, int glyph, Bitmap icon, boolean[][] qr, long holdMs) {
            this.key = key;
            // Orbit's words in the launcher's language, whoever put them together.
            this.title = Words.tm(title);
            this.detail = detail == null ? "" : Words.tm(detail);
            this.accent = accent;
            this.glyph = glyph;
            this.icon = icon;
            this.qr = qr;
            this.holdMs = holdMs;
        }
    }

    /** Where the words float, and how long each part takes. */
    private static final float TOP = 10f, WINDOW_H = 236f;
    private static final long ENTER_MS = 800L, LEAVE_MS = 620L, MORPH_MS = 650L;

    /** Told when the Island starts to speak and when it has finished, so that Home can make room. Main thread. */
    interface Watcher {
        void onIsland(boolean showing);
    }

    private Watcher watcher;

    void setWatcher(Watcher w) {
        watcher = w;
    }

    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final ArrayDeque<Event> queue = new ArrayDeque<>();
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG), glyphPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bitmapPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG), qrPaint = new Paint();
    private final TextPaint titlePaint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final TextPaint detailPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final RectF pill = new RectF(), spot = new RectF();
    private final Path glyph = new Path();
    private final float u;
    private boolean added, running;
    private Event current;
    /** 0 nothing, 1 coming down, 2 resting, 3 reshaping, 4 going back up. */
    private int phase;
    private long phaseAt, leaveAt;
    private float width, height, fromW, fromH;
    private final Paint veil = new Paint(Paint.ANTI_ALIAS_FLAG), ribbon = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint core = new Paint();
    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            if (current == null) {
                running = false;
                return;
            }
            long t = SystemClock.uptimeMillis();
            if (phase == 1 && t - phaseAt >= ENTER_MS) setPhase(2, t);
            if (phase == 3 && t - phaseAt >= MORPH_MS) setPhase(2, t);
            if (phase == 2 && t >= leaveAt) setPhase(4, t);
            if (phase == 4 && t - phaseAt >= LEAVE_MS) {
                next();
                return;
            }
            invalidate();
            if (phase == 2) {
                // Resting: nothing moves, nothing is drawn, until it is time to go.
                running = false;
                postDelayed(() -> wake(), Math.max(0L, leaveAt - t));
                return;
            }
            choreographer.postFrameCallback(this);
        }
    };

    TvIsland(Context service) {
        super(service);
        windows = service.getSystemService(WindowManager.class);
        u = service.getResources().getDisplayMetrics().widthPixels / 1280f;
        glyphPaint.setStyle(Paint.Style.STROKE);
        glyphPaint.setStrokeCap(Paint.Cap.ROUND);
        glyphPaint.setStrokeJoin(Paint.Join.ROUND);
        glyphPaint.setStrokeWidth(2.2f * u);
        glyphPaint.setColor(Color.WHITE);
        Typeface medium = service.getResources().getFont(R.font.inter_medium);
        Typeface light = service.getResources().getFont(R.font.inter_light);
        titlePaint.setTypeface(medium);
        titlePaint.setTextSize(19f * u);
        titlePaint.setColor(0xFFF4F6FA);
        detailPaint.setTypeface(light);
        detailPaint.setTextSize(15.5f * u);
        detailPaint.setColor(0xFF9AA3B2);
        qrPaint.setColor(Color.BLACK);
        setVisibility(GONE);
    }

    /** Shows it now, or after what is showing; one with the same key as the one showing takes its place, reshaping it. */
    /** Quiet (the Control Center's moon): nothing pops up while it is on, though everything still goes to the history. */
    static volatile boolean quiet;

    /** What the Island said, newest first, for the Control Center's Notifications. */
    static final class Note {
        final String title, detail;
        final long at;

        Note(String title, String detail, long at) {
            this.title = title;
            this.detail = detail;
            this.at = at;
        }
    }

    private static final java.util.ArrayList<Note> history = new java.util.ArrayList<>();

    static synchronized java.util.List<Note> history() {
        return new java.util.ArrayList<>(history);
    }

    static synchronized void clearHistory() {
        history.clear();
    }

    /** Codes and the panel's own answers are not news; the rest is kept, the same line once, twelve at most. */
    private static synchronized void remember(Event e) {
        if (e.key != null && (e.key.startsWith("cc-") || e.key.equals("pair") || e.key.equals("orbit-link"))) return;
        history.removeIf(n -> n.title.equals(e.title));
        history.add(0, new Note(e.title, e.detail, System.currentTimeMillis()));
        while (history.size() > 12) history.remove(history.size() - 1);
    }

    void show(Event e) {
        remember(e);
        if (quiet && (e.key == null || !e.key.startsWith("cc-"))) return;
        if (current != null && e.key != null && e.key.equals(current.key)) {
            fromW = width;
            fromH = height;
            current = e;
            measure(e);
            long t = SystemClock.uptimeMillis();
            leaveAt = Math.max(leaveAt, t + e.holdMs);
            if (phase == 2) setPhase(3, t);
            wake();
            return;
        }
        queue.removeIf(q -> e.key != null && e.key.equals(q.key));
        queue.add(e);
        if (current == null) next();
    }

    /** Takes away the one showing, if it has this key (the pairing code once the phone is paired). */
    void dismiss(String key) {
        queue.removeIf(q -> key.equals(q.key));
        if (current != null && key.equals(current.key)) {
            leaveAt = Math.min(leaveAt, SystemClock.uptimeMillis());
            wake();
        }
    }

    private void next() {
        boolean wasShowing = current != null;
        current = queue.poll();
        if (current == null) {
            phase = 0;
            running = false;
            setVisibility(GONE);
            if (wasShowing && watcher != null) watcher.onIsland(false);
            return;
        }
        if (!wasShowing && watcher != null) watcher.onIsland(true);
        if (!ensureWindow()) {
            queue.clear();
            current = null;
            return;
        }
        measure(current);
        long t = SystemClock.uptimeMillis();
        leaveAt = t + ENTER_MS + current.holdMs;
        setPhase(1, t);
        setVisibility(VISIBLE);
        wake();
    }

    private void setPhase(int p, long t) {
        phase = p;
        phaseAt = t;
    }

    private void measure(Event e) {
        float text = Math.max(titlePaint.measureText(e.title), detailPaint.measureText(e.detail));
        width = Math.min(1180f * u, 16f * u + 44f * u + 16f * u + text + (e.qr != null ? 172f * u : 30f * u));
        height = (e.qr != null ? 150f : 74f) * u;
    }

    private void wake() {
        invalidate();
        if (running) return;
        running = true;
        choreographer.postFrameCallback(frame);
    }

    private boolean ensureWindow() {
        if (added) return true;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, Math.round(WINDOW_H * u),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        // A service's window gets no hardware drawing unless it asks.
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP;
        lp.setTitle("OwnerTvIsland");
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
        queue.clear();
        current = null;
        phase = 0;
        choreographer.removeFrameCallback(frame);
        if (added) windows.removeView(this);
        added = false;
    }

    private static float clamp(float v) {
        return Math.max(0f, Math.min(1f, v));
    }

    private static float smooth(float x) {
        x = clamp(x);
        return x * x * (3f - 2f * x);
    }

    /** A spring let go from 0 towards 1: past it a little, back, still. A zeta under 1 is the liquid's wobble. */
    private static float spring(float t, float zeta, float omega) {
        if (t <= 0f) return 0f;
        double wd = omega * Math.sqrt(1 - zeta * zeta);
        return (float) (1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t)));
    }

    @Override
    protected void onDraw(Canvas c) {
        Event e = current;
        if (e == null || phase == 0) return;
        float t = (SystemClock.uptimeMillis() - phaseAt) / 1000f;
        float w = width, grow = 1f, content = 1f;
        if (phase == 1) {
            grow = spring(t, 0.7f, 15f);
            content = smooth((t - 0.25f) / 0.2f);
        } else if (phase == 3) {
            w = fromW + (width - fromW) * spring(t, 0.6f, 17f);
        } else if (phase == 4) {
            content = 1f - smooth(t / 0.14f);
            grow = 1f - smooth(t / 0.55f / 0.7f);
        }
        drawEdge(c, e, w, grow);
        if (content > 0.01f) drawContent(c, e, TOP * u, w, height, content);
    }

    /** The top edge alight: a soft dark veil hanging from it so the words read on anything, and the ribbon of light. */
    private void drawEdge(Canvas c, Event e, float w, float grow) {
        if (grow <= 0.001f) return;
        float cx = getWidth() / 2f, half = (w / 2f + 90f * u) * grow, depth = TOP * u + height + 40f * u;
        veil.setShader(new LinearGradient(0, 0, 0, depth, withAlpha(Color.BLACK, Math.round(209f * Math.min(1f, grow))), 0x00000000,
                Shader.TileMode.CLAMP));
        float vx = half * 1.15f + 40f * u;
        spot.set(cx - vx, -depth, cx + vx, depth);
        c.drawOval(spot, veil);
        ribbon.setShader(new LinearGradient(cx - half, 0, cx + half, 0,
                new int[]{0x0074D1FF, 0xFF74D1FF, e.accent | 0xFF000000, 0xFFE9B3FF, 0x00E9B3FF},
                new float[]{0f, 0.2f, 0.5f, 0.8f, 1f}, Shader.TileMode.CLAMP));
        ribbon.setShadowLayer(18f * u, 0f, 0f, withAlpha(e.accent, 220));
        c.drawRect(cx - half, 0f, cx + half, 3f * u, ribbon);
        core.setColor(withAlpha(Color.WHITE, Math.round(230f * Math.min(1f, grow))));
        c.drawRect(cx - half * 0.5f, 0f, cx + half * 0.5f, 1f * u, core);
    }

    private void drawContent(Canvas c, Event e, float y, float w, float h, float content) {
        int a = Math.round(255f * content);
        float cx = getWidth() / 2f, left = cx - w / 2f;
        float iconR = 22f * u, iconCx = left + 16f * u + iconR, iconCy = y + Math.min(h, 74f * u) / 2f;
        glow.setShader(null);
        glow.setColor(e.accent);
        glow.setAlpha(Math.round(a * 0.24f));
        c.drawCircle(iconCx, iconCy, iconR, glow);
        if (e.icon != null) {
            bitmapPaint.setAlpha(a);
            spot.set(iconCx - iconR * 0.78f, iconCy - iconR * 0.78f, iconCx + iconR * 0.78f, iconCy + iconR * 0.78f);
            c.drawBitmap(e.icon, null, spot, bitmapPaint);
        } else if (e.glyph != ICON_NONE) {
            buildGlyph(e.glyph, iconCx, iconCy, iconR * 0.62f);
            glyphPaint.setAlpha(a);
            c.drawPath(glyph, glyphPaint);
        }
        float textX = iconCx + iconR + 16f * u;
        float room = left + w - textX - (e.qr != null ? 150f * u : 26f * u);
        titlePaint.setAlpha(a);
        detailPaint.setAlpha(Math.round(a * 0.92f));
        float base = iconCy + (e.detail.isEmpty() ? 7f * u : -3f * u);
        c.drawText(TextUtils.ellipsize(e.title, titlePaint, Math.max(0f, room), TextUtils.TruncateAt.END).toString(), textX, base, titlePaint);
        if (!e.detail.isEmpty()) {
            c.drawText(TextUtils.ellipsize(e.detail, detailPaint, Math.max(0f, room), TextUtils.TruncateAt.END).toString(), textX, base + 22f * u, detailPaint);
        }
        if (e.qr != null) drawQr(c, e.qr, left + w - 16f * u - 126f * u, y + 12f * u, 126f * u, a);
    }

    private void drawQr(Canvas c, boolean[][] m, float x, float y, float size, int alpha) {
        glow.setShader(null);
        glow.setColor(Color.WHITE);
        glow.setAlpha(alpha);
        c.drawRoundRect(x, y, x + size, y + size, 12f * u, 12f * u, glow);
        // Four modules of light all round: a phone's camera needs that margin to find the code.
        int n = m.length;
        float cell = size / (n + 8), quiet = 4f * cell;
        qrPaint.setAlpha(alpha);
        for (int row = 0; row < n; row++) {
            for (int col = 0; col < n; col++) {
                if (m[row][col]) {
                    c.drawRect(x + quiet + col * cell, y + quiet + row * cell, x + quiet + (col + 1) * cell + 0.5f,
                            y + quiet + (row + 1) * cell + 0.5f, qrPaint);
                }
            }
        }
    }

    private void buildGlyph(int kind, float x, float y, float s) {
        glyph.reset();
        switch (kind) {
            case ICON_HEADPHONES:
                glyph.addArc(x - s, y - s, x + s, y + s * 0.9f, 180f, 180f);
                glyph.addRoundRect(x - s * 1.05f, y - s * 0.05f, x - s * 0.55f, y + s * 0.85f, s * 0.2f, s * 0.2f, Path.Direction.CW);
                glyph.addRoundRect(x + s * 0.55f, y - s * 0.05f, x + s * 1.05f, y + s * 0.85f, s * 0.2f, s * 0.2f, Path.Direction.CW);
                break;
            case ICON_ONLINE:
            case ICON_OFFLINE:
                for (int i = 1; i <= 3; i++) {
                    float rr = s * 0.36f * i;
                    glyph.addArc(x - rr, y + s * 0.55f - rr, x + rr, y + s * 0.55f + rr, 225f, 90f);
                }
                glyph.addCircle(x, y + s * 0.55f, s * 0.06f, Path.Direction.CW);
                if (kind == ICON_OFFLINE) {
                    glyph.moveTo(x - s * 0.9f, y - s * 0.75f);
                    glyph.lineTo(x + s * 0.9f, y + s * 0.95f);
                }
                break;
            case ICON_HDMI:
                glyph.moveTo(x - s, y - s * 0.45f);
                glyph.lineTo(x + s, y - s * 0.45f);
                glyph.lineTo(x + s, y + s * 0.1f);
                glyph.lineTo(x + s * 0.7f, y + s * 0.45f);
                glyph.lineTo(x - s * 0.7f, y + s * 0.45f);
                glyph.lineTo(x - s, y + s * 0.1f);
                glyph.close();
                break;
            case ICON_PHONE:
                glyph.addRoundRect(x - s * 0.55f, y - s, x + s * 0.55f, y + s, s * 0.25f, s * 0.25f, Path.Direction.CW);
                glyph.moveTo(x - s * 0.15f, y + s * 0.72f);
                glyph.lineTo(x + s * 0.15f, y + s * 0.72f);
                break;
            case ICON_FILM:
                glyph.addRoundRect(x - s, y - s * 0.75f, x + s, y + s * 0.75f, s * 0.2f, s * 0.2f, Path.Direction.CW);
                glyph.moveTo(x - s, y - s * 0.3f);
                glyph.lineTo(x + s, y - s * 0.3f);
                glyph.moveTo(x - s, y + s * 0.3f);
                glyph.lineTo(x + s, y + s * 0.3f);
                break;
            case ICON_BAT:
                glyph.addCircle(x, y, s * 0.95f, Path.Direction.CW);
                glyph.moveTo(x - s * 0.55f, y - s * 0.3f);
                glyph.quadTo(x, y - s * 0.05f, x + s * 0.55f, y - s * 0.3f);
                glyph.moveTo(x - s * 0.55f, y + s * 0.3f);
                glyph.quadTo(x, y + s * 0.05f, x + s * 0.55f, y + s * 0.3f);
                break;
            default:
                break;
        }
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (Math.max(0, Math.min(255, alpha)) << 24);
    }
}
