package com.gathin.tvhome;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Choreographer;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.List;

/**
 * Home pressed while a video plays: the video keeps playing, picture and sound, and the apps rise from the bottom on a
 * strip of glass over it. Left and right choose, OK opens one (the playing app's own tile just goes back to it), Back
 * or Up keeps watching, Home again goes to the full Home. This TV has no picture-in-picture (the firmware has it off
 * and no app here declares it), so this is the nearest thing to the small window the owner asked for (10 Nov).
 */
final class VideoShelf extends View {

    interface Host {
        /** The full Home, the way the Home key went before. */
        void shelfHome();

        /** Opens this app (not the one playing). */
        void shelfOpen(String pkg);
    }

    private static final float CARD_W = 224f, CARD_H = 126f, GAP = 26f, ROW_Y = 566f;
    private static final long IDLE_MS = 20_000L;

    private static final class App {
        final String pkg, label;
        final Drawable banner, icon;

        App(String pkg, String label, Drawable banner, Drawable icon) {
            this.pkg = pkg;
            this.label = label;
            this.banner = banner;
            this.icon = icon;
        }
    }

    private final Host host;
    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final float u;
    private final List<App> apps = new ArrayList<>();
    private final Paint scrim = new Paint(), card = new Paint(Paint.ANTI_ALIAS_FLAG), rim = new Paint(Paint.ANTI_ALIAS_FLAG),
            glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint name = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG),
            line = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG),
            hint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG),
            badge = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final RectF r = new RectF();
    private boolean added, open, animating;
    private String playing = "", title = "";
    private int focus;
    // springs, stepped like the Control Center's: value, target, velocity
    private float slide, slideT, slideV, row, rowT, rowV;
    private long lastNs, touchedAt;
    private final Runnable idle = () -> {
        if (open && SystemClock.uptimeMillis() - touchedAt >= IDLE_MS) close();
    };

    VideoShelf(Context service, Host host) {
        super(service);
        this.host = host;
        windows = service.getSystemService(WindowManager.class);
        u = service.getResources().getDisplayMetrics().widthPixels / 1280f;
        rim.setStyle(Paint.Style.STROKE);
        name.setTypeface(service.getResources().getFont(R.font.inter_medium));
        name.setTextSize(17f);
        name.setColor(0xFFFFFFFF);
        name.setTextAlign(Paint.Align.CENTER);
        line.setTypeface(service.getResources().getFont(R.font.inter_medium));
        line.setTextSize(16f);
        line.setColor(0xFFFFFFFF);
        hint.setTypeface(service.getResources().getFont(R.font.inter_regular));
        hint.setTextSize(13.5f);
        hint.setColor(0xA6FFFFFF);
        badge.setTypeface(service.getResources().getFont(R.font.inter_medium));
        badge.setTextSize(12f);
        badge.setColor(0xFF16161B);
        setVisibility(GONE);
    }

    boolean isOpen() {
        return open;
    }

    /** Rises over the playing video; false when there is no window for it (Home then goes as it always did). */
    boolean open(String playingPkg, String playingTitle) {
        if (open) return true;
        if (!ensureWindow()) return false;
        playing = playingPkg;
        title = playingTitle == null ? "" : playingTitle;
        readApps();
        if (apps.size() < 2) return false;
        // The focus starts on the app after the playing one, the likeliest next choice.
        int at = indexOf(playing);
        focus = Math.min(apps.size() - 1, at >= 0 ? at + 1 : 1);
        row = rowT = focus;
        rowV = 0f;
        slide = 0f;
        slideV = 0f;
        slideT = 1f;
        open = true;
        touchedAt = SystemClock.uptimeMillis();
        main.postDelayed(idle, IDLE_MS + 100L);
        setVisibility(VISIBLE);
        wake();
        return true;
    }

    /** Keeps watching: the strip goes down, the video never stopped. */
    void close() {
        if (!open) return;
        open = false;
        slideT = 0f;
        main.removeCallbacks(idle);
        wake();
    }

    void release() {
        open = false;
        main.removeCallbacksAndMessages(null);
        if (added) {
            try {
                windows.removeView(this);
            } catch (RuntimeException gone) {
                // already gone with the service
            }
        }
        added = false;
        apps.clear();
    }

    /** The playing app went away underneath (it ended, or something else came up): nothing left to keep watching. */
    void frontChanged(String pkg) {
        if (open && pkg != null && !pkg.equals(playing) && !pkg.equals(getContext().getPackageName())) close();
    }

    /** All keys are the strip's while it is up. */
    boolean onKey(KeyEvent e) {
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        touchedAt = SystemClock.uptimeMillis();
        main.removeCallbacks(idle);
        main.postDelayed(idle, IDLE_MS + 100L);
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (down && focus > 0) move(-1);
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down && focus < apps.size() - 1) move(1);
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (!down && !e.isCanceled()) choose();
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_DPAD_UP:
                if (!down) close();
                return true;
            case KeyEvent.KEYCODE_HOME:
                if (!down) {
                    close();
                    host.shelfHome();
                }
                return true;
            default:
                return true;
        }
    }

    private void move(int step) {
        focus += step;
        rowT = focus;
        wake();
    }

    private void choose() {
        App a = apps.get(focus);
        close();
        if (a.pkg == null) host.shelfHome();
        else if (!a.pkg.equals(playing)) host.shelfOpen(a.pkg);
    }

    private int indexOf(String pkg) {
        for (int i = 0; i < apps.size(); i++) if (pkg.equals(apps.get(i).pkg)) return i;
        return -1;
    }

    /** Home's own row, in its order, behind a Home tile; without Home in memory, the TV's apps by name. */
    private void readApps() {
        apps.clear();
        Context c = getContext();
        apps.add(new App(null, "Home", null, c.getDrawable(R.drawable.cc_tv)));
        GalleryHomeView home = GalleryHomeView.alive();
        List<AppAdapter.Entry> row = home != null ? home.rowEntries() : null;
        if (row != null && !row.isEmpty()) {
            for (AppAdapter.Entry e : row) apps.add(new App(e.pkg, e.label, copy(e.banner), copy(e.icon)));
            return;
        }
        PackageManager pm = c.getPackageManager();
        List<ResolveInfo> found = pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0);
        List<App> list = new ArrayList<>();
        for (ResolveInfo ri : found) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(c.getPackageName()) || pkg.equals("com.android.tv.settings")) continue;
            list.add(new App(pkg, ri.loadLabel(pm).toString(), ri.activityInfo.loadBanner(pm), ri.loadIcon(pm)));
        }
        list.sort((a, b) -> a.label.compareToIgnoreCase(b.label));
        apps.addAll(list);
    }

    /** Home's drawables are Home's: the strip draws its own copies, with its own bounds and alpha. */
    private static Drawable copy(Drawable d) {
        if (d == null) return null;
        Drawable.ConstantState s = d.getConstantState();
        return s != null ? s.newDrawable().mutate() : d;
    }

    private boolean ensureWindow() {
        if (added) return true;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.setTitle("OwnerVideoShelf");
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

    // ---------------------------------------------------------------- motion

    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long nowNs) {
            float dt = lastNs == 0L ? 1f / 60f : Math.min(0.05f, (nowNs - lastNs) / 1e9f);
            lastNs = nowNs;
            int steps = Math.max(1, (int) Math.ceil(dt * 240f));
            float h = dt / steps;
            for (int i = 0; i < steps; i++) {
                // The strip rises with a little give and settles; the row glides to the focus.
                float a = -260f * (slide - slideT) - 26f * slideV;
                slideV += a * h;
                slide += slideV * h;
                float b = -330f * (row - rowT) - 34f * rowV;
                rowV += b * h;
                row += rowV * h;
            }
            boolean moving = Math.abs(slide - slideT) > 4e-4f || Math.abs(slideV) > 3e-3f
                    || Math.abs(row - rowT) > 4e-4f || Math.abs(rowV) > 3e-3f;
            if (!moving) {
                slide = slideT;
                slideV = 0f;
                row = rowT;
                rowV = 0f;
            }
            invalidate();
            if (moving) {
                choreographer.postFrameCallback(this);
            } else {
                animating = false;
                lastNs = 0L;
                if (!open) {
                    setVisibility(GONE);
                    apps.clear();
                }
            }
        }
    };

    private void wake() {
        invalidate();
        if (animating) return;
        animating = true;
        lastNs = 0L;
        choreographer.postFrameCallback(frame);
    }

    // ---------------------------------------------------------------- drawing

    @Override
    protected void onDraw(Canvas c) {
        if (apps.isEmpty()) return;
        int save = c.save();
        c.scale(u, u);
        float s = Math.max(0f, Math.min(1.05f, slide)), fade = Math.min(1f, s);
        float dy = (1f - s) * 260f;
        // A dark glass floor rising under the row; the video above it stays as it is.
        // Nearly opaque by the cards' top: a film's subtitles showed through the row on the TV (10 Nov).
        scrim.setShader(new LinearGradient(0f, 320f + dy, 0f, 720f + dy, new int[]{0x00000000, 0xCC000000, 0xF7050608, 0xFA050608},
                new float[]{0f, 0.3f, 0.45f, 1f}, Shader.TileMode.CLAMP));
        scrim.setAlpha(Math.round(255f * fade));
        c.drawRect(0f, 300f, 1280f, 720f, scrim);
        // the top edge of the glass: one fine line of light
        rim.setStrokeWidth(1f);
        rim.setColor(0x33FFFFFF);
        rim.setAlpha(Math.round(51f * fade));
        c.drawLine(120f, 446f + dy, 1160f, 446f + dy, rim);

        // what keeps playing, and what the keys do
        if (!title.isEmpty() || !playing.isEmpty()) {
            int at = indexOf(playing);
            String app = at >= 0 ? apps.get(at).label : "";
            String what = !title.isEmpty() ? "Still playing  ·  " + title : app.isEmpty() ? "Still playing" : "Still playing in " + app;
            what = TextUtils.ellipsize(what, line, 760f, TextUtils.TruncateAt.END).toString();
            line.setAlpha(Math.round(255f * fade));
            card.setColor(0xFFFF3B30);
            card.setAlpha(Math.round(255f * fade));
            c.drawCircle(84f, 476f + dy, 5f, card);
            c.drawText(what, 98f, 482f + dy, line);
        }
        hint.setAlpha(Math.round(166f * fade));
        hint.setTextAlign(Paint.Align.RIGHT);
        c.drawText("Back  keep watching      Home  all of Home", 1196f, 482f + dy, hint);
        hint.setTextAlign(Paint.Align.LEFT);

        float cy = ROW_Y + dy;
        for (int i = 0; i < apps.size(); i++) {
            float d = i - row;
            float cx = 640f + d * (CARD_W + GAP);
            if (cx + CARD_W < -20f || cx - CARD_W > 1300f) continue;
            float near = (float) Math.exp(-d * d * 3.0f);
            float k = 1f + 0.12f * near;
            float w = CARD_W * k, h = CARD_H * k;
            r.set(cx - w / 2f, cy - h / 2f, cx + w / 2f, cy + h / 2f);
            App a = apps.get(i);
            int alpha = Math.round(255f * fade * (0.55f + 0.45f * near));
            if (near > 0.15f) {
                glow.setColor(0x66FFFFFF);
                glow.setAlpha(Math.round(70f * near * fade));
                c.drawRoundRect(r.left - 7f, r.top - 7f, r.right + 7f, r.bottom + 7f, 24f, 24f, glow);
            }
            card.setColor(0xFF1C1E25);
            card.setAlpha(alpha);
            c.drawRoundRect(r, 18f, 18f, card);
            int keep = c.save();
            c.clipRect(r);
            if (a.banner != null) {
                a.banner.setBounds(Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom));
                a.banner.setAlpha(alpha);
                a.banner.draw(c);
            } else if (a.icon != null) {
                float is = h * 0.46f;
                a.icon.setBounds(Math.round(cx - is / 2f), Math.round(cy - is / 2f), Math.round(cx + is / 2f), Math.round(cy + is / 2f));
                if (a.pkg == null) a.icon.setTint(0xFFFFFFFF);
                a.icon.setAlpha(alpha);
                a.icon.draw(c);
            }
            c.restoreToCount(keep);
            rim.setStrokeWidth(near > 0.5f ? 2.4f : 1.2f);
            rim.setColor(near > 0.5f ? 0xFFFFFFFF : 0x40FFFFFF);
            rim.setAlpha(Math.round((near > 0.5f ? 255f : 64f) * fade));
            c.drawRoundRect(r, 18f, 18f, rim);
            if (a.pkg != null && a.pkg.equals(playing)) {
                // the app that is playing says so: OK on it just goes back to the video
                float bw = badge.measureText("Playing") + 18f;
                RectF b = new RectF(r.left + 10f, r.top + 10f, r.left + 10f + bw, r.top + 32f);
                card.setColor(0xFFFFFFFF);
                card.setAlpha(Math.round(235f * fade));
                c.drawRoundRect(b, 11f, 11f, card);
                badge.setAlpha(Math.round(255f * fade));
                c.drawText("Playing", b.left + 9f, b.top + 15.5f, badge);
            }
            if (near > 0.5f) {
                name.setAlpha(Math.round(255f * fade * near));
                c.drawText(TextUtils.ellipsize(a.label, name, w + 40f, TextUtils.TruncateAt.END).toString(), cx, r.bottom + 32f, name);
            }
        }
        c.restoreToCount(save);
    }
}
