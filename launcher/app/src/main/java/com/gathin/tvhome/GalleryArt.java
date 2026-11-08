package com.gathin.tvhome;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.os.Build;

import androidx.annotation.RequiresApi;

import java.util.Random;

/**
 * The pictures and shaders behind {@link GalleryHomeView} and {@link VolumeSlider}, made once on a worker thread.
 * Every frame only moves these around: on a Mali-G31 with 1 GB of RAM that is what keeps the gallery at the panel's
 * full rate, where a live blur would not. Bitmaps end up in graphics memory, so nothing scrolling in stops a frame.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class GalleryArt {

    static final int CARD_W = 244;
    static final int CARD_H = 352;
    private static final int SRC_W = 320;
    private static final int SRC_H = 180;

    /**
     * One card. Left of the scan line it is quiet silver, right of it full colour. Where they meet the picture bends
     * as if through a drop of glass, and the edge between them ripples while the row moves: no second bitmap and no
     * cut, so the change is a soft wipe. The frame's rounded corners and its thin bright rim are computed here too,
     * which keeps them clean at any tilt. motion = line position, logo shift, ripple phase, liquid amount.
     */
    private static final String CARD_SKSL = ""
            + "uniform shader bg;\n"
            + "uniform shader logo;\n"
            + "uniform float4 motion;\n"
            + "uniform float2 look;\n"
            + "uniform float3 light;\n"
            + "uniform float2 logoAt;\n"
            + "float4 main(float2 p) {\n"
            + "  float dx = p.x - motion.x;\n"
            + "  float lens = exp(-dx * dx / 1700.0);\n"
            + "  float wave = sin(p.y * 0.031 + motion.z) * (1.2 + 6.5 * motion.w);\n"
            + "  float2 q = float2(p.x - lens * (dx * (0.15 + 0.17 * motion.w) - wave), p.y);\n"
            + "  float4 art = bg.eval(q);\n"
            + "  float4 mark = logo.eval(q - logoAt - float2(motion.y, 0.0));\n"
            + "  float3 c = art.rgb * (1.0 - mark.a) + mark.rgb;\n"
            + "  float grey = dot(c, float3(0.30, 0.59, 0.11));\n"
            + "  float3 silver = mix(float3(grey), c, 0.10) * float3(0.64, 0.66, 0.70);\n"
            + "  float bend = dx + wave;\n"
            + "  c = mix(silver, c, smoothstep(-30.0, 30.0, bend));\n"
            + "  float2 d = abs(p - float2(122.0, 176.0)) - float2(96.0, 150.0);\n"
            + "  float sd = length(max(d, float2(0.0))) + min(max(d.x, d.y), 0.0) - 24.0;\n"
            + "  float alpha = clamp(0.5 - sd, 0.0, 1.0);\n"
            + "  float rim = clamp(1.0 - abs(sd + 1.4) / 1.4, 0.0, 1.0);\n"
            + "  float up = clamp(1.0 - p.y / 176.0, 0.0, 1.0);\n"
            + "  float near = exp(-bend * bend / 600.0);\n"
            + "  c += float3(rim * (0.07 + 0.30 * up));\n"
            + "  c += light * (near * 0.17 + rim * near * 0.8);\n"
            + "  float g = (p.x * 0.74 + p.y * 0.67 - look.x) / 58.0;\n"
            + "  c += float3(exp(-g * g) * 0.085);\n"
            + "  c *= 1.0 - look.y;\n"
            + "  return float4(c * alpha, alpha);\n"
            + "}\n";

    /** The light behind the row: one colour shading into another across it, hotter towards the middle. */
    private static final String ROOM_SKSL = ""
            + "uniform shader mask;\n"
            + "uniform float3 left;\n"
            + "uniform float3 right;\n"
            + "uniform float2 room;\n"
            + "float4 main(float2 p) {\n"
            + "  float a = mask.eval(p).a;\n"
            + "  float3 tint = mix(left, right, smoothstep(0.26, 0.74, p.x / room.x));\n"
            + "  float3 c = tint * a * room.y + (tint * 0.45 + 0.55) * a * a * a * room.y * 0.34;\n"
            + "  return float4(c, 1.0);\n"
            + "}\n";

    /** A grey mask in a chosen colour, added on top: the blooms. */
    private static final String TINT_SKSL = ""
            + "uniform shader mask;\n"
            + "uniform float4 tint;\n"
            + "float4 main(float2 p) {\n"
            + "  float a = mask.eval(p).a * tint.a;\n"
            + "  return float4(tint.rgb * a, a);\n"
            + "}\n";

    static final class Card {
        final AppAdapter.Entry entry;
        final String key;
        final RuntimeShader shader;
        final float logoRoom;
        final int accent;
        final int accent2;

        Card(AppAdapter.Entry entry, RuntimeShader shader, float logoRoom, int accent, int accent2) {
            this.entry = entry;
            this.key = entry.component.flattenToShortString();
            this.shader = shader;
            this.logoRoom = logoRoom;
            this.accent = accent;
            this.accent2 = accent2;
        }
    }


    private GalleryArt() {
    }

    // ---- app cards -------------------------------------------------------------------------------

    static Card card(AppAdapter.Entry e) {
        Bitmap source = source(e);
        int[] px = new int[SRC_W * SRC_H];
        source.getPixels(px, 0, SRC_W, 0, 0, SRC_W, SRC_H);

        // The banner's border says what it is: one colour with a logo on it, or a picture.
        long sumR = 0, sumG = 0, sumB = 0;
        int n = 0;
        for (int y = 0; y < SRC_H; y++) {
            for (int x = 0; x < SRC_W; x += (y == 0 || y == SRC_H - 1) ? 1 : SRC_W - 1) {
                int p = px[y * SRC_W + x];
                sumR += Color.red(p);
                sumG += Color.green(p);
                sumB += Color.blue(p);
                n++;
            }
        }
        int er = (int) (sumR / n), eg = (int) (sumG / n), eb = (int) (sumB / n);
        long deviation = 0;
        for (int y = 0; y < SRC_H; y++) {
            for (int x = 0; x < SRC_W; x += (y == 0 || y == SRC_H - 1) ? 1 : SRC_W - 1) {
                int p = px[y * SRC_W + x];
                deviation += Math.abs(Color.red(p) - er) + Math.abs(Color.green(p) - eg) + Math.abs(Color.blue(p) - eb);
            }
        }
        boolean flat = deviation / n < 30;

        Bitmap logo = flat ? cutOutLogo(px, er, eg, eb) : null;
        if (logo == null) logo = featheredBanner(source);
        float logoX = (CARD_W - logo.getWidth()) / 2f;
        float logoY = (CARD_H - logo.getHeight()) / 2f - 8f;
        Bitmap background = background(source, flat, Color.rgb(er, eg, eb), logoY, logo.getHeight());
        source.recycle();

        RuntimeShader shader = new RuntimeShader(CARD_SKSL);
        shader.setInputShader("bg", mask(gpu(background), Shader.TileMode.CLAMP));
        // Clamp, not DECAL, which comes back opaque black on this GPU and hides the card: a logo's edges are clear anyway.
        shader.setInputShader("logo", mask(gpu(logo), Shader.TileMode.CLAMP));
        shader.setFloatUniform("logoAt", logoX, logoY);

        int[] pair = accentPair(bannerHue(px, new float[3], e));
        return new Card(e, shader, Math.max(0f, logoX - 8f), pair[0], pair[1]);
    }

    private static int[] accentPair(float hue) {
        float[] hsv = {hue, 0.94f, 1f};
        int accent = Color.HSVToColor(hsv);
        // The cyberpunk pair: warm hues lean towards magenta, cool ones along towards violet and cyan.
        hsv[0] = (hue >= 330f || hue < 70f) ? (hue + 320f) % 360f : (hue + 42f) % 360f;
        return new int[]{accent, Color.HSVToColor(hsv)};
    }

    /** The same light for a video's picture as for an app's banner. */
    static int[] accentsOf(Bitmap picture) {
        Bitmap readable = picture.getConfig() == Bitmap.Config.HARDWARE ? picture.copy(Bitmap.Config.ARGB_8888, false) : picture;
        Bitmap small = Bitmap.createScaledBitmap(readable, 48, 27, true);
        int[] px = new int[48 * 27];
        small.getPixels(px, 0, 48, 0, 0, 48, 27);
        if (small != readable) small.recycle();
        if (readable != picture) readable.recycle();
        float hue = dominantHue(px, new float[3], 5.0);
        return accentPair(hue < 0f ? 195f : hue);
    }

    /** A word of the big titles: thin, and a little darker towards its foot. */
    static Bitmap word(Context ctx, String text, float size) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(ctx.getResources().getFont(R.font.inter_thin));
        p.setTextSize(size);
        p.setLetterSpacing(-0.03f);
        int w = (int) Math.ceil(p.measureText(text) + size * 0.2f);
        float base = size * 0.98f;
        int h = (int) Math.ceil(size * 1.24f);
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        p.setShader(new LinearGradient(0, base - size * 0.8f, 0, base, 0xFFFFFFFF, 0xFFB4BAC8, Shader.TileMode.CLAMP));
        new Canvas(b).drawText(text, size * 0.1f, base, p);
        return gpu(b);
    }

    private static BitmapShader mask(Bitmap b, Shader.TileMode mode) {
        BitmapShader s = new BitmapShader(b, mode, mode);
        s.setFilterMode(BitmapShader.FILTER_MODE_LINEAR);
        return s;
    }

    /**
     * The hue the light behind a card takes: all the banner's colours averaged round the colour wheel, weighted by how
     * strong each is. A gradient reads as its overall colour (JioHotstar's blue to pink is violet), a single-colour logo as
     * that colour (Netflix red). Colours that cancel out, a many-coloured logo, fall back to the ordinary Home's most vivid
     * patch; a banner with no colour at all gets a violet.
     */
    private static float bannerHue(int[] px, float[] hsv, AppAdapter.Entry e) {
        float hue = dominantHue(px, hsv, 12.0);
        if (hue >= 0f) return hue;
        if (hue == NO_COLOUR) return 272f;
        Color.colorToHSV(AppAdapter.vividColor(e.banner != null ? e.banner : e.icon), hsv);
        return hsv[1] < 0.25f ? 272f : hsv[0];
    }

    private static final float NO_COLOUR = -1f, COLOURS_CANCEL = -2f;

    private static float dominantHue(int[] px, float[] hsv, double enough) {
        double sumX = 0, sumY = 0, total = 0;
        for (int i = 0; i < px.length; i += 3) {
            Color.colorToHSV(px[i], hsv);
            if (hsv[2] < 0.2f || hsv[1] < 0.28f) continue;
            double w = hsv[1] * hsv[1] * hsv[2], angle = Math.toRadians(hsv[0]);
            sumX += w * Math.cos(angle);
            sumY += w * Math.sin(angle);
            total += w;
        }
        if (total < enough) return NO_COLOUR;
        if (Math.hypot(sumX, sumY) < total * 0.30) return COLOURS_CANCEL;
        return (float) ((Math.toDegrees(Math.atan2(sumY, sumX)) + 360.0) % 360.0);
    }

    private static Bitmap source(AppAdapter.Entry e) {
        Bitmap b = Bitmap.createBitmap(SRC_W, SRC_H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        c.drawColor(0xFF14161A);
        Drawable d = e.banner != null ? e.banner : e.icon;
        if (d == null) return b;
        if (e.banner != null) {
            d.setBounds(0, 0, SRC_W, SRC_H);
        } else {
            int side = 112;
            d.setBounds((SRC_W - side) / 2, (SRC_H - side) / 2, (SRC_W + side) / 2, (SRC_H + side) / 2);
        }
        d.draw(c);
        return b;
    }

    /**
     * A banner that is one colour with a logo: the logo alone, on nothing, sized for a tall card. Banners keep wide
     * margins for a 16:9 tile, and those would leave a tiny logo here. Null when no logo stands out from the colour.
     */
    private static Bitmap cutOutLogo(int[] px, int er, int eg, int eb) {
        int minX = SRC_W, minY = SRC_H, maxX = -1, maxY = -1;
        for (int y = 0; y < SRC_H; y++) {
            for (int x = 0; x < SRC_W; x++) {
                int p = px[y * SRC_W + x];
                int diff = Math.max(Math.abs(Color.red(p) - er),
                        Math.max(Math.abs(Color.green(p) - eg), Math.abs(Color.blue(p) - eb)));
                if (diff > 28) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;
        minX = Math.max(0, minX - 3);
        minY = Math.max(0, minY - 3);
        maxX = Math.min(SRC_W - 1, maxX + 3);
        maxY = Math.min(SRC_H - 1, maxY + 3);
        int w = maxX - minX + 1, h = maxY - minY + 1;
        int[] out = new int[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = px[(y + minY) * SRC_W + x + minX];
                int r = Color.red(p), g = Color.green(p), b = Color.blue(p);
                int diff = Math.max(Math.abs(r - er), Math.max(Math.abs(g - eg), Math.abs(b - eb)));
                // Undo the banner colour in the logo's soft edge, so it sits cleanly on the card's shaded colour.
                float a = Math.min(1f, diff / 110f);
                if (a <= 0f) continue;
                out[y * w + x] = Color.argb(Math.round(a * 255),
                        clamp(er + (r - er) / a), clamp(eg + (g - eg) / a), clamp(eb + (b - eb) / a));
            }
        }
        // Clear edges, so clamping the logo leaves nothing around it.
        for (int x = 0; x < w; x++) {
            out[x] = 0;
            out[(h - 1) * w + x] = 0;
        }
        for (int y = 0; y < h; y++) {
            out[y * w] = 0;
            out[y * w + w - 1] = 0;
        }
        Bitmap cut = Bitmap.createBitmap(out, w, h, Bitmap.Config.ARGB_8888);
        float scale = Math.min(CARD_W * 0.72f / w, CARD_H * 0.34f / h);
        Bitmap sized = Bitmap.createScaledBitmap(cut, Math.max(1, Math.round(w * scale)),
                Math.max(1, Math.round(h * scale)), true);
        if (sized != cut) cut.recycle();
        return sized;
    }

    /**
     * A banner that is a picture stays whole, the card's full width. {@link #background} carries its own top and
     * bottom colours up and down the card, so only those two edges fade, into what is already their colour.
     */
    private static Bitmap featheredBanner(Bitmap source) {
        int w = CARD_W - 6;
        int h = Math.round(w * SRC_H / (float) SRC_W);
        Bitmap sized = Bitmap.createScaledBitmap(source, w, h, true);
        Bitmap out = sized.copy(Bitmap.Config.ARGB_8888, true);
        if (sized != source && sized != out) sized.recycle();
        out.setHasAlpha(true);
        int[] p = new int[w * h];
        out.getPixels(p, 0, w, 0, 0, w, h);
        float fx = 2f, fy = 16f;
        for (int y = 0; y < h; y++) {
            float ay = Math.min(1f, Math.min(y, h - 1 - y) / fy);
            for (int x = 0; x < w; x++) {
                float a = ay * Math.min(1f, Math.min(x, w - 1 - x) / fx);
                int c = p[y * w + x];
                p[y * w + x] = (Math.round(Color.alpha(c) * a) << 24) | (c & 0xFFFFFF);
            }
        }
        out.setPixels(p, 0, w, 0, 0, w, h);
        return out;
    }

    private static Bitmap background(Bitmap source, boolean flat, int edge, float logoY, int logoH) {
        Bitmap art = Bitmap.createBitmap(CARD_W, CARD_H, Bitmap.Config.ARGB_8888);
        Canvas a = new Canvas(art);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
        float luma = (0.299f * Color.red(edge) + 0.587f * Color.green(edge) + 0.114f * Color.blue(edge)) / 255f;
        if (flat) {
            // Pure white cards glare in a dark room: bring them down to a soft porcelain.
            float soften = luma > 0.82f ? 0.88f : 1f;
            a.drawColor(Color.rgb(Math.round(Color.red(edge) * soften), Math.round(Color.green(edge) * soften),
                    Math.round(Color.blue(edge) * soften)));
        } else {
            // The banner's top row carried up the card and its bottom row down it, a few pixels across and
            // stretched so no single pixel draws a streak. Sampling the whole banner instead smeared its logo.
            stretchRow(a, source, 0, 0, logoY + 20f, p);
            stretchRow(a, source, SRC_H - 3, logoY + logoH - 20f, CARD_H, p);
            a.drawBitmap(source, null, new RectF(0, logoY + 14f, CARD_W, logoY + logoH - 14f), p);
        }
        // Light from above, so the flat colour reads as a surface.
        p.setShader(new LinearGradient(0, 0, 0, CARD_H,
                new int[]{0x26FFFFFF, 0x00FFFFFF, 0x00000000, 0x52000000},
                new float[]{0f, 0.28f, 0.70f, 1f}, Shader.TileMode.CLAMP));
        a.drawRect(0, 0, CARD_W, CARD_H, p);
        if (flat && luma < 0.22f) {
            // A dark card would melt into the black screen: a soft pool of light behind its logo.
            p.setShader(new RadialGradient(CARD_W / 2f, CARD_H * 0.46f, CARD_W * 0.92f,
                    0x2CFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
            a.drawRect(0, 0, CARD_W, CARD_H, p);
        }
        return art;
    }

    private static void stretchRow(Canvas c, Bitmap source, int row, float top, float bottom, Paint p) {
        Bitmap strip = Bitmap.createBitmap(source, 0, row, SRC_W, 3);
        Bitmap small = Bitmap.createScaledBitmap(strip, 10, 1, true);
        c.drawBitmap(small, null, new RectF(0, top, CARD_W, bottom), p);
        if (small != strip) small.recycle();
        strip.recycle();
    }

    // ---- the room --------------------------------------------------------------------------------

    /** The shader for the light behind the row. */
    static RuntimeShader roomShader(Bitmap mask) {
        RuntimeShader s = new RuntimeShader(ROOM_SKSL);
        s.setInputShader("mask", mask(mask, Shader.TileMode.CLAMP));
        return s;
    }

    /** The shader that paints a mask in a colour. */
    static RuntimeShader tintShader(Bitmap mask) {
        RuntimeShader s = new RuntimeShader(TINT_SKSL);
        s.setInputShader("mask", mask(mask, Shader.TileMode.CLAMP));
        return s;
    }

    /**
     * How the light falls off, as alpha. Noise of about one colour step keeps its long dark fade from showing bands
     * on an 8-bit panel, which a smooth gradient would do.
     */
    static Bitmap roomMask(int w, int h) {
        float[] wideX = new float[w], hotX = new float[w];
        for (int x = 0; x < w; x++) {
            float d = (x - w / 2f) / (w * 0.31f);
            wideX[x] = (float) Math.exp(-d * d);
            d *= 2.4f;
            hotX[x] = (float) Math.exp(-d * d);
        }
        float[] wideY = new float[h], hotY = new float[h];
        for (int y = 0; y < h; y++) {
            float d = (y - h / 2f) / (h * 0.31f);
            wideY[y] = (float) Math.exp(-d * d);
            d *= 1.6f;
            hotY[y] = (float) Math.exp(-d * d);
        }
        int[] px = new int[w * h];
        Random noise = new Random(7);
        for (int y = 0; y < h; y++) {
            float fy = (y - h / 2f) / (h / 2f);
            float edgeY = (1f - fy * fy) * (1f - fy * fy);
            for (int x = 0; x < w; x++) {
                float fx = (x - w / 2f) / (w / 2f);
                // Dead by the bitmap's own edge, or its rectangle would show on the black.
                float edge = edgeY * (1f - fx * fx) * (1f - fx * fx);
                float i = edge * (0.62f * wideX[x] * wideY[y] + 0.38f * hotX[x] * hotY[y]);
                px[y * w + x] = clamp(255f * i + (noise.nextFloat() - 0.5f) * Math.min(1f, edge * 8f)) << 24;
            }
        }
        return gpu(Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888));
    }

    /** The bloom around the scan line: a tight core and a wide soft shoulder, both dead by the bitmap's edge. */
    static Bitmap bloomMask(int w, int h) {
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            float fy = (y - h / 2f) / (h / 2f);
            float ay = 1f - fy * fy;
            ay *= ay;
            for (int x = 0; x < w; x++) {
                float fx = (x - w / 2f) / (w / 2f);
                float edge = 1f - fx * fx;
                edge *= edge;
                float tight = fx * 15f, wide = fx * 3.6f;
                float a = ay * edge * (0.62f * (float) Math.exp(-tight * tight) + 0.26f * (float) Math.exp(-wide * wide));
                px[y * w + x] = clamp(a * 255f) << 24;
            }
        }
        return gpu(Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888));
    }

    /** A soft flat glow, for the search bar's top edge. */
    static Bitmap barGlowMask(int w, int h) {
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            float fy = (y - h / 2f) / (h / 2f);
            float ay = 1f - fy * fy;
            ay *= ay;
            for (int x = 0; x < w; x++) {
                float fx = (x - w / 2f) / (w / 2f);
                float ax = 1f - fx * fx;
                px[y * w + x] = clamp(255f * 0.55f * ay * ax * ax * ax) << 24;
            }
        }
        return gpu(Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888));
    }

    /** A round soft glow, for the volume slider. */
    static Bitmap radialMask(int side) {
        int[] px = new int[side * side];
        float c = (side - 1) / 2f;
        for (int y = 0; y < side; y++) {
            for (int x = 0; x < side; x++) {
                float dx = (x - c) / c, dy = (y - c) / c;
                float r = dx * dx + dy * dy;
                float a = r >= 1f ? 0f : (1f - r) * (1f - r);
                px[y * side + x] = clamp(255f * a * a) << 24;
            }
        }
        return gpu(Bitmap.createBitmap(px, side, side, Bitmap.Config.ARGB_8888));
    }

    /** The greeting: a large, clean title and a quiet line under it. It changes a few times a day, so it is a picture. */
    static Bitmap headline(Context ctx, String title, String line, float size) {
        Paint big = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        big.setTypeface(ctx.getResources().getFont(R.font.inter_regular));
        big.setTextSize(size);
        big.setLetterSpacing(-0.022f);
        big.setTextAlign(Paint.Align.CENTER);
        Paint small = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        small.setTypeface(ctx.getResources().getFont(R.font.inter_light));
        small.setTextSize(size * 0.42f);
        small.setLetterSpacing(0.004f);
        small.setTextAlign(Paint.Align.CENTER);
        small.setColor(0xD6FFFFFF);
        float titleBase = size * 1.02f, lineBase = titleBase + size * 0.70f;
        int w = (int) Math.ceil(Math.max(big.measureText(title), small.measureText(line)) + size);
        int h = (int) Math.ceil(lineBase + size * 0.2f);
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        big.setShader(new LinearGradient(0, titleBase - size * 0.8f, 0, titleBase + size * 0.08f,
                0xFFFFFFFF, 0xFFBBC0CC, Shader.TileMode.CLAMP));
        c.drawText(title, w / 2f, titleBase, big);
        c.drawText(line, w / 2f, lineBase, small);
        return gpu(b);
    }

    // ---- liquid glass ----------------------------------------------------------------------------

    /**
     * A piece of Apple-style glass, ready-made: a faint body that lets the light behind it through, a bright thin rim
     * that is strongest along the top, a highlight where the room's light would catch it, and the soft pool that
     * thick glass gathers along its lower edge. The bar and the round buttons are this.
     */
    static Bitmap glass(int w, int h, float radius) {
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        float s = 1f;
        RectF r = new RectF(s, s, w - s, h - s);
        p.setShader(new LinearGradient(0, 0, 0, h, new int[]{0x30FFFFFF, 0x12FFFFFF, 0x0CFFFFFF},
                new float[]{0f, 0.5f, 1f}, Shader.TileMode.CLAMP));
        c.drawRoundRect(r, radius, radius, p);
        p.setShader(new LinearGradient(0, h * 0.6f, 0, h, 0x00FFFFFF, 0x24FFFFFF, Shader.TileMode.CLAMP));
        c.drawRoundRect(r, radius, radius, p);

        int save = c.save();
        Path clip = new Path();
        clip.addRoundRect(r, radius, radius, Path.Direction.CW);
        c.clipPath(clip);
        Matrix stretch = new Matrix();
        float glintW = Math.max(h * 1.1f, w * 0.34f), glintH = h * 0.42f;
        RadialGradient glint = new RadialGradient(0, 0, 1f, 0x52FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP);
        stretch.setScale(glintW, glintH);
        stretch.postTranslate(w * 0.32f, h * 0.06f);
        glint.setLocalMatrix(stretch);
        p.setShader(glint);
        c.drawRect(0, 0, w, h, p);
        c.restoreToCount(save);

        p.setShader(new LinearGradient(0, 0, 0, h, new int[]{0xC4FFFFFF, 0x36FFFFFF, 0x1EFFFFFF, 0x5CFFFFFF},
                new float[]{0f, 0.3f, 0.72f, 1f}, Shader.TileMode.CLAMP));
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.3f);
        c.drawRoundRect(r, radius, radius, p);
        return gpu(b);
    }

    private static int clamp(float v) {
        return v <= 0f ? 0 : v >= 255f ? 255 : Math.round(v);
    }

    /** In graphics memory from the start, so no frame ever waits for an upload; plain if the driver refuses. */
    static Bitmap gpu(Bitmap b) {
        Bitmap hardware = b.copy(Bitmap.Config.HARDWARE, false);
        if (hardware == null) {
            b.prepareToDraw();
            return b;
        }
        b.recycle();
        return hardware;
    }
}
