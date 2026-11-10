package com.gathin.livetv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Choreographer;
import android.view.KeyEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Everything Live TV draws over the picture: the banner at the bottom when the channel changes, the guide down the
 * left side, typed channel numbers and short notes. One view in 1280 x 720 design units; it draws only while something
 * moves, so a channel left playing costs the GPU nothing (the picture itself is the TV's video layer underneath).
 */
final class GuideView extends View {

    interface Listener {
        /** OK on a row of the guide. */
        void onPick(int index);
    }

    static final int ZAPPING = 0, CONNECTING = 1, LIVE = 2, OFF_AIR = 3, PAUSED = 4, EXIT = 5, NO_NET = 6;

    private static final float W = 1280f, H = 720f;
    private static final float BX = 48f, BW = 720f, BH = 150f, BY = H - 46f - BH;
    private static final float GW = 600f, LIST_TOP = 178f, LIST_BOTTOM = H - 74f, ROW = 86f;
    private static final int BLUE = 0xFF74D1FF, LAVENDER = 0xFFADC6FF, PINK = 0xFFE9B3FF, RED = 0xFFFF3B5C;
    private static final long LIVE_SHOWN_MS = 4500L, EXIT_SHOWN_MS = 2200L, TOAST_MS = 2600L;

    private final Listener listener;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final RectF r = new RectF(), dst = new RectF(), local = new RectF();
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint image = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final TextPaint name, number, pillText, small, clock, title, tab, rowName, rowNum, rowSub, big;
    private final Shader bannerBg, bannerRim, guideBg, focusBg, edgeTop, edgeBottom;

    private List<Channels.Channel> channels = new ArrayList<>();
    private int playing = -1;

    // banner
    private final Spring banner = new Spring(16f, 0.002f);
    private Channels.Channel bannerChannel;
    private int bannerState = LIVE, quality;
    private long connectingSince;

    // guide
    private final Spring guide = new Spring(17f, 0.002f), focus = new Spring(22f, 0.004f), scroll = new Spring(20f, 0.004f);
    private boolean guideOpen;
    private int group;
    private final List<Integer> members = new ArrayList<>();
    private int focused;

    // typed number, notes
    private String digits = "";
    private String toast;
    private final Spring toastShown = new Spring(18f, 0.002f);

    private boolean animating;
    private long lastFrameNs;
    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            float dt = lastFrameNs == 0L ? 1f / 60f : Math.min(0.05f, (now - lastFrameNs) / 1e9f);
            lastFrameNs = now;
            boolean moving = banner.step(dt) | guide.step(dt) | focus.step(dt) | scroll.step(dt) | toastShown.step(dt);
            // The thin line in the banner runs while a channel is still connecting.
            moving |= banner.value > 0.01f && (bannerState == CONNECTING || bannerState == ZAPPING);
            invalidate();
            if (moving) {
                choreographer.postFrameCallback(this);
            } else {
                animating = false;
            }
        }
    };
    private final Runnable hideBanner = () -> {
        banner.target = 0f;
        wake();
    };
    private final Runnable hideToast = () -> {
        toastShown.target = 0f;
        wake();
    };

    GuideView(Context context, Listener listener) {
        super(context);
        this.listener = listener;
        Typeface light = font(context, R.font.inter_light), regular = font(context, R.font.inter_regular);
        Typeface medium = font(context, R.font.inter_medium), semibold = font(context, R.font.inter_semibold);
        name = text(semibold, 34f, 0xFFFFFFFF);
        number = text(light, 28f, LAVENDER);
        pillText = text(medium, 14.5f, 0xFFFFFFFF);
        pillText.setLetterSpacing(0.08f);
        small = text(regular, 18.5f, 0x9EFFFFFF);
        clock = text(regular, 20f, 0x99FFFFFF);
        clock.setTextAlign(Paint.Align.RIGHT);
        title = text(semibold, 30f, 0xFFFFFFFF);
        tab = text(medium, 17f, 0xFFFFFFFF);
        rowName = text(medium, 25f, 0xFFFFFFFF);
        rowNum = text(light, 21f, LAVENDER);
        rowSub = text(regular, 16f, 0x8CFFFFFF);
        big = text(light, 62f, 0xFFFFFFFF);
        big.setTextAlign(Paint.Align.CENTER);
        bannerBg = new LinearGradient(0f, BY, 0f, BY + BH, 0xE3131A28, 0xEE090D16, Shader.TileMode.CLAMP);
        bannerRim = new LinearGradient(0f, BY, 0f, BY + BH * 0.55f, 0x38FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP);
        guideBg = new LinearGradient(0f, 0f, GW + 150f, 0f, new int[]{0xF7060911, 0xE8060911, 0x00060911},
                new float[]{0f, GW / (GW + 150f), 1f}, Shader.TileMode.CLAMP);
        focusBg = new LinearGradient(0f, 0f, 0f, ROW, 0x30FFFFFF, 0x14FFFFFF, Shader.TileMode.CLAMP);
        edgeTop = new LinearGradient(0f, LIST_TOP - 6f, 0f, LIST_TOP + 26f, 0xF0060911, 0x00060911, Shader.TileMode.CLAMP);
        edgeBottom = new LinearGradient(0f, LIST_BOTTOM - 26f, 0f, LIST_BOTTOM + 6f, 0x00060911, 0xF0060911, Shader.TileMode.CLAMP);
        line.setStyle(Paint.Style.STROKE);
        setWillNotDraw(false);
    }

    private static Typeface font(Context c, int id) {
        try {
            return c.getResources().getFont(id);
        } catch (RuntimeException missing) {
            return Typeface.DEFAULT;
        }
    }

    private static TextPaint text(Typeface face, float size, int color) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(face);
        p.setTextSize(size);
        p.setColor(color);
        return p;
    }

    void setChannels(List<Channels.Channel> list) {
        channels = list;
        if (guideOpen) rebuild(false);
        invalidate();
    }

    void setPlaying(int index) {
        playing = index;
        invalidate();
    }

    // ---- banner ----------------------------------------------------------------------------------

    void banner(Channels.Channel ch, int state) {
        boolean newChannel = ch != bannerChannel;
        bannerChannel = ch;
        if (state == CONNECTING && (newChannel || bannerState != CONNECTING)) connectingSince = SystemClock.uptimeMillis();
        if (newChannel) quality = 0;
        bannerState = state;
        removeCallbacks(hideBanner);
        if (guideOpen && state != OFF_AIR && state != NO_NET) {
            banner.target = 0f;
        } else {
            banner.target = 1f;
            if (state == LIVE) postDelayed(hideBanner, LIVE_SHOWN_MS);
            if (state == EXIT) postDelayed(hideBanner, EXIT_SHOWN_MS);
        }
        wake();
    }

    void setQuality(int height) {
        quality = height;
        invalidate();
    }

    void hideBanner() {
        removeCallbacks(hideBanner);
        banner.target = 0f;
        wake();
    }

    boolean bannerShown() {
        return banner.target > 0f;
    }

    int bannerState() {
        return bannerState;
    }

    // ---- guide -----------------------------------------------------------------------------------

    boolean guideOpen() {
        return guideOpen;
    }

    void openGuide() {
        if (guideOpen) return;
        guideOpen = true;
        rebuild(true);
        guide.target = 1f;
        removeCallbacks(hideBanner);
        banner.target = 0f;
        wake();
    }

    void closeGuide() {
        if (!guideOpen) return;
        guideOpen = false;
        guide.target = 0f;
        wake();
    }

    /** The rows of the chosen group; focus on the playing channel when it is one of them. */
    private void rebuild(boolean snap) {
        members.clear();
        String g = Channels.GROUPS[group];
        for (int i = 0; i < channels.size(); i++) if (channels.get(i).in(g)) members.add(i);
        int at = members.indexOf(playing);
        focused = Math.max(0, at);
        float target = targetScroll();
        if (snap) {
            focus.snap(focused);
            scroll.snap(target);
        } else {
            focus.target = focused;
            scroll.target = target;
        }
    }

    private float targetScroll() {
        float visible = (LIST_BOTTOM - LIST_TOP) / ROW;
        float max = Math.max(0f, members.size() - visible);
        float want = scroll.target;
        if (focused - want > visible - 2f) want = focused - (visible - 2f);
        if (focused - want < 1f) want = focused - 1f;
        return Math.max(0f, Math.min(max, want));
    }

    /** A key while the guide is open; false when it is not the guide's. */
    boolean guideKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_PAGE_DOWN: {
                int step = keyCode == KeyEvent.KEYCODE_DPAD_UP ? -1 : keyCode == KeyEvent.KEYCODE_DPAD_DOWN ? 1
                        : keyCode == KeyEvent.KEYCODE_CHANNEL_UP || keyCode == KeyEvent.KEYCODE_PAGE_UP ? -5 : 5;
                int next = Math.max(0, Math.min(members.size() - 1, focused + step));
                if (next != focused) {
                    focused = next;
                    focus.target = focused;
                    scroll.target = targetScroll();
                    wake();
                }
                return true;
            }
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT: {
                int next = group + (keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? -1 : 1);
                if (next >= 0 && next < Channels.GROUPS.length) {
                    group = next;
                    rebuild(true);
                    wake();
                }
                return true;
            }
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (focused < members.size()) listener.onPick(members.get(focused));
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                closeGuide();
                return true;
            default:
                return false;
        }
    }

    // ---- digits and notes ------------------------------------------------------------------------

    void digits(String typed) {
        digits = typed == null ? "" : typed;
        invalidate();
    }

    void toast(String text) {
        toast = text;
        toastShown.target = 1f;
        removeCallbacks(hideToast);
        postDelayed(hideToast, TOAST_MS);
        wake();
    }

    private void wake() {
        if (animating) return;
        animating = true;
        lastFrameNs = 0L;
        choreographer.postFrameCallback(frame);
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        choreographer.removeFrameCallback(frame);
        animating = false;
    }

    // ---- drawing ---------------------------------------------------------------------------------

    @Override
    protected void onDraw(Canvas c) {
        float s = getWidth() / W;
        c.save();
        c.scale(s, s);
        if (guide.value > 0.002f) drawGuide(c);
        if (banner.value > 0.002f && bannerChannel != null) drawBanner(c);
        if (!digits.isEmpty()) drawDigits(c);
        if (toast != null && toastShown.value > 0.01f) drawToast(c);
        c.restore();
    }

    private void drawBanner(Canvas c) {
        float a = clamp(banner.value);
        int save = c.saveLayerAlpha(BX - 4f, BY - 4f, BX + BW + 4f, H, Math.round(255f * a));
        c.translate(0f, (1f - a) * 26f);
        Channels.Channel ch = bannerChannel;
        r.set(BX, BY, BX + BW, BY + BH);
        fill.setShader(bannerBg);
        c.drawRoundRect(r, 30f, 30f, fill);
        fill.setShader(null);
        line.setShader(bannerRim);
        line.setStrokeWidth(1.6f);
        r.inset(0.8f, 0.8f);
        c.drawRoundRect(r, 29f, 29f, line);
        line.setShader(null);

        r.set(BX + 20f, BY + 20f, BX + 192f, BY + BH - 22f);
        chip(c, r, 20f);
        logo(c, ch, r, 14f, name);

        float x = BX + 216f;
        c.drawText(clockNow(), BX + BW - 28f, BY + 50f, clock);
        String num = String.format(java.util.Locale.ROOT, "%02d", ch.num);
        c.drawText(num, x, BY + 56f, number);
        float nx = x + number.measureText(num) + 14f;
        c.drawText(ellipsize(ch.name, name, BX + BW - 140f - nx), nx, BY + 56f, name);

        float px = x, py = BY + 90f;
        if (bannerState == OFF_AIR || bannerState == NO_NET) {
            px += pill(c, px, py, bannerState == NO_NET ? "NO INTERNET" : "OFF AIR", 0x33FF8A5A, 0xFFFFB08A, false) + 8f;
        } else if (bannerState == PAUSED) {
            px += pill(c, px, py, "PAUSED", 0x1FFFFFFF, 0xDDFFFFFF, false) + 8f;
        } else if (!ch.paid()) {
            px += pill(c, px, py, "LIVE", 0x33FF3B5C, 0xFFFF8396, true) + 8f;
        }
        px += pill(c, px, py, ch.paid() ? ch.appName.toUpperCase(java.util.Locale.ROOT) : ch.group.toUpperCase(java.util.Locale.ROOT),
                0x1AFFFFFF, 0xCCFFFFFF, false) + 8f;
        if (quality > 0 && bannerState == LIVE) {
            pill(c, px, py, quality >= 1000 ? "FULL HD" : quality >= 700 ? "HD" : "SD", 0x1F74D1FF, 0xFFA8E4FF, false);
        }

        String say;
        switch (bannerState) {
            case ZAPPING:
                say = ch.paid() ? "OK opens " + ch.appName : "OK to watch now";
                break;
            case CONNECTING:
                say = SystemClock.uptimeMillis() - connectingSince > 6000L ? "Still connecting, the channel is slow right now" : "Connecting…";
                break;
            case OFF_AIR:
                say = "Not on air right now.  ▲ ▼ another channel";
                break;
            case NO_NET:
                say = "The TV is not online. Check the Wi-Fi";
                break;
            case PAUSED:
                say = "Paused.  OK or ▶ goes back to live";
                break;
            case EXIT:
                say = "Press BACK again to go Home";
                break;
            default:
                say = "▲ ▼  Channels      OK  All channels";
        }
        small.setColor(bannerState == OFF_AIR || bannerState == NO_NET ? 0xE6FFB49C : bannerState == EXIT ? 0xFFFFFFFF : 0x9EFFFFFF);
        c.drawText(ellipsize(say, small, BW - 240f), x, BY + 131f, small);

        if (bannerState == CONNECTING || bannerState == ZAPPING) {
            // A short light running along the bottom edge: it is working on it.
            float t = ((SystemClock.uptimeMillis() - connectingSince) % 1300L) / 1300f;
            float left = BX + 34f, right = BX + BW - 34f, y = BY + BH - 3f;
            fill.setColor(0x1AFFFFFF);
            r.set(left, y - 1.2f, right, y + 1.2f);
            c.drawRoundRect(r, 1.2f, 1.2f, fill);
            float head = left + (right - left + 160f) * t - 80f;
            fill.setColor(bannerState == ZAPPING ? 0x80FFFFFF : BLUE);
            r.set(Math.max(left, head - 80f), y - 1.2f, Math.min(right, head + 80f), y + 1.2f);
            if (r.right > r.left) c.drawRoundRect(r, 1.2f, 1.2f, fill);
        }
        c.restoreToCount(save);
    }

    /** A small capsule of capital letters; returns its width. */
    private float pill(Canvas c, float x, float cy, String text, int bg, int fg, boolean dot) {
        float pad = 12f, dotW = dot ? 15f : 0f;
        float w = pillText.measureText(text) + pad * 2f + dotW;
        r.set(x, cy - 14f, x + w, cy + 14f);
        fill.setColor(bg);
        c.drawRoundRect(r, 14f, 14f, fill);
        if (dot) {
            fill.setColor(0x55FF3B5C);
            c.drawCircle(x + pad + 4f, cy, 8f, fill);
            fill.setColor(RED);
            c.drawCircle(x + pad + 4f, cy, 4.5f, fill);
        }
        pillText.setColor(fg);
        c.drawText(text, x + pad + dotW, cy + 5.2f, pillText);
        return w;
    }

    private void chip(Canvas c, RectF box, float radius) {
        fill.setColor(0xFF141A27);
        c.drawRoundRect(box, radius, radius, fill);
        line.setColor(0x1FFFFFFF);
        line.setStrokeWidth(1.2f);
        c.drawRoundRect(box, radius, radius, line);
    }

    /** The channel's logo fitted into the chip, or its name when there is no logo. */
    private void logo(Canvas c, Channels.Channel ch, RectF box, float inset, TextPaint like) {
        Bitmap b = ch.logo;
        float bw = box.width() - inset * 2f, bh = box.height() - inset * 2f;
        if (b != null && b.getWidth() > 0 && b.getHeight() > 0) {
            float k = Math.min(bw / b.getWidth(), bh / b.getHeight());
            float w = b.getWidth() * k, h = b.getHeight() * k;
            float lx = box.centerX() - w / 2f, ly = box.centerY() - h / 2f;
            dst.set(lx, ly, lx + w, ly + h);
            c.drawBitmap(b, null, dst, image);
            return;
        }
        TextPaint t = new TextPaint(like);
        t.setTextSize(Math.min(like.getTextSize(), bh * 0.42f));
        t.setTextAlign(Paint.Align.CENTER);
        t.setColor(0xE6FFFFFF);
        c.drawText(ellipsize(ch.name, t, bw), box.centerX(), box.centerY() + t.getTextSize() * 0.36f, t);
    }

    private void drawGuide(Canvas c) {
        float open = clamp(guide.value);
        c.save();
        c.translate(-(1f - open) * (GW + 160f), 0f);
        fill.setShader(guideBg);
        c.drawRect(0f, 0f, GW + 150f, H, fill);
        fill.setShader(null);

        c.drawText("Live TV", 56f, 72f, title);
        rowSub.setColor(0x80FFFFFF);
        c.drawText("Free Hindi channels", 56f, 100f, rowSub);
        clock.setTextAlign(Paint.Align.RIGHT);
        c.drawText(clockNow(), GW - 44f, 70f, clock);

        // the groups
        float tx = 44f, ty = 138f;
        for (int i = 0; i < Channels.GROUPS.length; i++) {
            String g = Channels.GROUPS[i];
            float w = tab.measureText(g) + 30f;
            r.set(tx, ty - 18f, tx + w, ty + 18f);
            if (i == group) {
                fill.setColor(0xF2FFFFFF);
                c.drawRoundRect(r, 18f, 18f, fill);
                tab.setColor(0xFF0A0E16);
            } else {
                tab.setColor(0x99FFFFFF);
            }
            c.drawText(g, tx + 15f, ty + 6f, tab);
            tx += w + 4f;
        }

        // the rows
        c.save();
        c.clipRect(0f, LIST_TOP - 6f, GW, LIST_BOTTOM + 6f);
        float fy = LIST_TOP + (focus.value - scroll.value) * ROW;
        r.set(34f, fy + 5f, GW - 34f, fy + ROW - 5f);
        c.save();
        c.translate(0f, fy);
        fill.setShader(focusBg);
        local.set(34f, 5f, GW - 34f, ROW - 5f);
        c.drawRoundRect(local, 22f, 22f, fill);
        fill.setShader(null);
        c.restore();
        line.setColor(0x47FFFFFF);
        line.setStrokeWidth(1.5f);
        c.drawRoundRect(r, 22f, 22f, line);

        int first = Math.max(0, (int) Math.floor(scroll.value) - 1);
        int last = Math.min(members.size() - 1, (int) Math.ceil(scroll.value + (LIST_BOTTOM - LIST_TOP) / ROW) + 1);
        for (int i = first; i <= last; i++) drawRow(c, i, LIST_TOP + (i - scroll.value) * ROW);
        c.restore();
        // soft ends where the list runs on
        if (scroll.value > 0.05f) edge(c, LIST_TOP - 6f, LIST_TOP + 26f, edgeTop);
        if (scroll.value < members.size() - (LIST_BOTTOM - LIST_TOP) / ROW - 0.05f) edge(c, LIST_BOTTOM - 26f, LIST_BOTTOM + 6f, edgeBottom);

        // the keys
        float kx = 52f, ky = H - 32f;
        kx = key(c, kx, ky, "OK", "Watch");
        kx = key(c, kx + 22f, ky, "◀ ▶", "Groups");
        key(c, kx + 22f, ky, "BACK", "Close");
        c.restore();
    }

    private void drawRow(Canvas c, int i, float y) {
        Channels.Channel ch = channels.get(members.get(i));
        boolean isFocused = i == focused, isPlaying = members.get(i) == playing;
        float dim = (ch.offAir || ch.checkFailed) && !isPlaying ? 0.45f : 1f;
        r.set(52f, y + 13f, 164f, y + ROW - 13f);
        chip(c, r, 15f);
        image.setAlpha(Math.round(255f * dim));
        logo(c, ch, r, 8f, rowName);
        image.setAlpha(255);
        rowNum.setAlpha(Math.round((isFocused ? 235f : 190f) * dim));
        String num = String.format(java.util.Locale.ROOT, "%02d", ch.num);
        c.drawText(num, 184f, y + 40f, rowNum);
        float nx = 184f + rowNum.measureText(num) + 12f;
        rowName.setAlpha(Math.round((isFocused ? 255f : 215f) * dim));
        c.drawText(ellipsize(ch.name, rowName, GW - 60f - nx), nx, y + 40f, rowName);
        String sub;
        int color;
        if (isPlaying) {
            sub = "Now playing";
            color = BLUE;
            // three still bars, a playing mark that needs no frames
            fill.setColor(BLUE);
            float bx = 184f, base = y + 64f;
            float[] hs = {9f, 14f, 6f};
            for (int k = 0; k < 3; k++) {
                r.set(bx + k * 5.5f, base - hs[k], bx + k * 5.5f + 3.2f, base);
                c.drawRoundRect(r, 1.6f, 1.6f, fill);
            }
            rowSub.setColor(color);
            c.drawText(sub, 184f + 24f, y + 64f, rowSub);
            return;
        } else if (ch.paid()) {
            sub = "Opens in " + ch.appName + "  ›";
            color = 0xD9E9B3FF;
        } else if (ch.offAir || ch.checkFailed) {
            sub = ch.offAir ? "Off air right now" : "May be off air";
            color = 0xCCFF9C86;
        } else {
            sub = ch.group;
            color = 0x80FFFFFF;
        }
        rowSub.setColor(color);
        c.drawText(sub, 184f, y + 64f, rowSub);
    }

    private void edge(Canvas c, float top, float bottom, Shader s) {
        fill.setShader(s);
        c.drawRect(0f, top, GW, bottom, fill);
        fill.setShader(null);
    }

    /** A keycap and what it does; returns where the next one starts. */
    private float key(Canvas c, float x, float baseline, String cap, String what) {
        pillText.setColor(0xE6FFFFFF);
        float w = pillText.measureText(cap) + 18f;
        r.set(x, baseline - 18f, x + w, baseline + 6f);
        line.setColor(0x4DFFFFFF);
        line.setStrokeWidth(1.2f);
        c.drawRoundRect(r, 7f, 7f, line);
        c.drawText(cap, x + 9f, baseline - 1f, pillText);
        rowSub.setColor(0x8CFFFFFF);
        c.drawText(what, x + w + 9f, baseline, rowSub);
        return x + w + 9f + rowSub.measureText(what);
    }

    private void drawDigits(Canvas c) {
        float w = 200f, h = 100f, x = W - 48f - w, y = 40f;
        r.set(x, y, x + w, y + h);
        fill.setShader(bannerBg);
        c.save();
        c.translate(0f, y - BY);
        local.set(x, BY, x + w, BY + h);
        c.drawRoundRect(local, 26f, 26f, fill);
        c.restore();
        fill.setShader(null);
        line.setColor(0x33FFFFFF);
        line.setStrokeWidth(1.4f);
        c.drawRoundRect(r, 26f, 26f, line);
        String shown = digits.length() == 1 ? digits + "_" : digits;
        c.drawText(shown, x + w / 2f, y + 72f, big);
    }

    private void drawToast(Canvas c) {
        float a = clamp(toastShown.value);
        float w = small.measureText(toast) + 48f, x = (W - w) / 2f, y = 56f - (1f - a) * 16f;
        int save = c.saveLayerAlpha(x - 2f, y - 2f, x + w + 2f, y + 50f, Math.round(255f * a));
        r.set(x, y, x + w, y + 46f);
        fill.setColor(0xE6121826);
        c.drawRoundRect(r, 23f, 23f, fill);
        line.setColor(0x33FFFFFF);
        line.setStrokeWidth(1.2f);
        c.drawRoundRect(r, 23f, 23f, line);
        small.setColor(0xF2FFFFFF);
        c.drawText(toast, x + 24f, y + 29.5f, small);
        c.restoreToCount(save);
    }

    private String clockNow() {
        return android.text.format.DateFormat.getTimeFormat(getContext()).format(new Date());
    }

    private static String ellipsize(String text, TextPaint p, float width) {
        return TextUtils.ellipsize(text, p, Math.max(10f, width), TextUtils.TruncateAt.END).toString();
    }

    private static float clamp(float v) {
        return Math.max(0f, Math.min(1f, v));
    }

    /** The exact path of a critically damped spring: the same motion at any frame length, no overshoot. */
    static final class Spring {
        float value, velocity, target;
        private final float omega, rest;

        Spring(float omega, float rest) {
            this.omega = omega;
            this.rest = rest;
        }

        boolean step(float dt) {
            float x = value - target;
            if (x == 0f && velocity == 0f) return false;
            float e = (float) Math.exp(-omega * dt);
            float next = (x + (velocity + omega * x) * dt) * e;
            velocity = (velocity - omega * (velocity + omega * x) * dt) * e;
            value = target + next;
            if (Math.abs(next) < rest && Math.abs(velocity) < rest * 10f) {
                value = target;
                velocity = 0f;
                return false;
            }
            return true;
        }

        void snap(float v) {
            value = target = v;
            velocity = 0f;
        }
    }
}
