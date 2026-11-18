package com.gathin.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import androidx.annotation.RequiresApi;

/**
 * The owner's volume slider, from the reference they sent, mirrored so it hugs the screen's right edge: a neon line up
 * a fine scale that swells away from a dark round knob with a glow behind the swell, the nearest numbers growing as the
 * knob passes them, the value large beside it, and the colour moving from aqua through electric blue and violet to a
 * hot magenta as the volume rises. There is no panel: it comes out of the edge of the screen and goes back into it.
 *
 * <p>The TV's own volume bar appears whenever a volume key reaches the system (SystemUI's VolumeVerticalUIManager, with
 * no setting to stop it), so the keys do not go there: res/raw/remote_keys.kcm, a keyboard layout set on the remote,
 * gives them names that mean nothing to the system, the key helper hands them here, and this sets the volume with no
 * UI flag. It is also what makes a held button smooth. The volume follows how long the button has been held instead of
 * a stream of steps from the audio service, and that service, which can hold a caller for tens of ms while it works on
 * a change, is only ever called from a thread of its own.
 *
 * <p>Without the layout (a firmware update could drop it) the keys go to the system as usual. This then only watches
 * what the TV reports, and a soft shade with no visible edge rises from the screen's side over the TV's bar.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class VolumeSlider extends View {

    private static final String ACTION_VOLUME = "android.media.VOLUME_CHANGED_ACTION";
    private static final String ACTION_MUTE = "android.media.STREAM_MUTE_CHANGED_ACTION";
    private static final String EXTRA_STREAM = "android.media.EXTRA_VOLUME_STREAM_TYPE";
    private static final String EXTRA_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE";
    private static final String EXTRA_PREVIOUS = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE";
    private static final String EXTRA_MUTED = "android.media.EXTRA_STREAM_VOLUME_MUTED";

    /** What res/raw/remote_keys.kcm turns the remote's Volume Down, Volume Up and Mute into. */
    private static final int KEY_LOWER = KeyEvent.KEYCODE_NUMPAD_LEFT_PAREN;
    private static final int KEY_RAISE = KeyEvent.KEYCODE_NUMPAD_RIGHT_PAREN;
    private static final int KEY_MUTE = KeyEvent.KEYCODE_NUMPAD_EQUALS;

    /** A 1280 x 720 design, in screen coordinates. The window is the right-hand part of the screen, full height. */
    private static final float WINDOW_LEFT = 880f;
    private static final float LINE_X = 1168f, SCALE_TOP = 120f, SCALE_BOTTOM = 636f;
    private static final float KNOB_X = 1128f, KNOB_R = 36f, NUMBER_END = 1072f, NUMBER_SIZE = 92f;
    private static final float LABEL_END = 1270f, LABEL_SIZE = 20f, LABEL_GROW = 1.46f;
    private static final float SWELL = 24f, SWELL_HALF = 66f;

    private static final long STAY_MS = 2600L;
    /** The TV's own bar stays about 3.6 s after the last change, measured; the shade over it must outlast it. */
    private static final long STAY_OVER_TV_BAR_MS = 3900L;
    /** The goal moves smoothly by itself while a button is held, so this can be quick and still be one glide. */
    private static final float OMEGA = 16f;
    /** A press is one step. Held past this delay, the volume runs, gathering speed, in steps per second. */
    private static final float HOLD_DELAY_S = 0.30f, HOLD_RATE_FIRST = 14f, HOLD_RATE_FULL = 26f, HOLD_RATE_RAMP_S = 1.1f;
    /** A release that never came (the remote dropped out while held) must not run the volume to the top. */
    private static final float HOLD_LONGEST_S = 9f;
    /** A volume report this soon after this slider's own change is that change coming back. */
    private static final long OWN_ECHO_MS = 700L;
    /** Behind the numbers over a bright picture. Fully up only to cover the TV's own bar. */
    private static final float SCRIM = 0.58f;

    /** The colour up the scale. */
    private static final int[] RAMP_STOPS = {0xFF19F7E6, 0xFF12D6FF, 0xFF4CA0FF, 0xFF9070FF, 0xFFE055F5, 0xFFFF4DA6};
    private static final float[] RAMP_AT = {0f, 0.30f, 0.55f, 0.75f, 0.90f, 1f};
    private static final int MUTED_COLOUR = 0xFF8C8F8A;

    /**
     * Where the neon line runs at a height, and how steeply: straight, except for the swell away from the knob, which
     * is longer ahead of a moving knob. Worked out per pixel, so no path has to be traced again for every frame.
     */
    private static final String CURVE_SKSL = ""
            + "uniform float2 knob;\n"
            + "uniform float3 swell;\n"
            + "float2 curve(float y) {\n"
            + "  float d = y - knob.y;\n"
            + "  float h = d < 0.0 ? swell.y : swell.z;\n"
            + "  float s = 1.0 - clamp(abs(d) / h, 0.0, 1.0);\n"
            + "  return float2(knob.x + swell.x * s * s * (3.0 - 2.0 * s), 6.0 * s * (1.0 - s) * swell.x / h);\n"
            + "}\n";

    /** The line: every height in its own colour of the ramp, fading to a thin grey above the knob. */
    private static final String LINE_SKSL = CURVE_SKSL
            + "uniform shader ramp;\n"
            + "uniform float4 edges;\n"
            + "uniform float3 fade;\n"
            + "float4 main(float2 p) {\n"
            + "  float2 c = curve(p.y);\n"
            + "  float a = clamp(edges.x + 0.5 - abs(p.x - c.x) / sqrt(1.0 + c.y * c.y), 0.0, 1.0);\n"
            + "  a *= clamp(p.y - edges.y + 0.5, 0.0, 1.0) * clamp(edges.z - p.y + 0.5, 0.0, 1.0) * edges.w;\n"
            + "  float t = clamp((edges.z - p.y) / (edges.z - edges.y), 0.0, 1.0);\n"
            + "  float3 rgb = ramp.eval(float2(0.5 + 255.0 * t, 0.5)).rgb;\n"
            + "  float lit = clamp((p.y - fade.x) / fade.y, 0.0, 1.0) * (1.0 - fade.z);\n"
            + "  return float4(mix(float3(0.41, 0.42, 0.40), rgb, lit) * a, a);\n"
            + "}\n";

    /** The glow, only on the far side of the line as in the reference: the knob's colour, then the next one out. */
    private static final String GLOW_SKSL = CURVE_SKSL
            + "uniform float3 light;\n"
            + "uniform float4 inner;\n"
            + "uniform float3 outer;\n"
            + "float4 main(float2 p) {\n"
            + "  float2 d = (p - light.xy) / light.z;\n"
            + "  float f = max(0.0, 1.0 - dot(d, d));\n"
            + "  float a = f * f * f * f * inner.a * clamp(p.x - curve(p.y).x + 0.5, 0.0, 1.0);\n"
            + "  return float4(mix(outer, inner.rgb, f) * a, a);\n"
            + "}\n";

    private final WindowManager windows;
    private final AudioManager audio;
    private final float u;
    private boolean added, ready, released;

    /** Everything that talks to the audio service. */
    private final HandlerThread audioThread = new HandlerThread("volume-audio", Process.THREAD_PRIORITY_DISPLAY);
    private final Handler audioHandler;
    private final Handler main = new Handler(Looper.getMainLooper());
    private GallerySound sound;
    private volatile int asked;
    private volatile int sent;

    private int max = 100;
    private boolean muted;
    /** Where the volume is going, in steps but not only whole ones: a held button moves it a little every frame. */
    private float goal;
    private float shown, velocity;
    /** The direction of the button being held, or 0. */
    private int held;
    private float heldFor;
    private long lastOwnMs = -OWN_ECHO_MS;
    /** How far the slider has come out of the edge. */
    private float presence;
    private float cover;
    private boolean overTvBar;
    private boolean wanted;
    private float jolt;

    private boolean animating;
    private long lastFrameNs;

    private final Paint shadePaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint tickPaint = new Paint();
    private final Paint labelPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint unitPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint mutePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint digitPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint digitShadowPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint linePaint = new Paint();
    private final Paint glowPaint = new Paint(Paint.DITHER_FLAG);
    private final Paint knobPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final RectF windowRect = new RectF();
    private final RectF to = new RectF();
    private final Rect from = new Rect();

    private RuntimeShader lineShader, glowShader;
    private Bitmap knob, shade;
    private final int[] ramp = new int[256];
    /**
     * The ten digits side by side, and the scale's numbers: alpha-only pictures the paint colours. Text moves in whole
     * pixels, which beside the knob's smooth travel is a shiver, and text drawn at a new size every frame, as the
     * numbers grow, is rasterised again every frame.
     */
    private Bitmap digits, digitShadows;
    private int digitCell, digitHeight, digitBaseline, digitPad, digitPitch;
    private final Bitmap[] labelArt = new Bitmap[5];
    private int labelPad;

    private final Runnable leave = this::goBackIn;
    private final Runnable sendVolume = this::applyVolume;
    private final Runnable sendMute = () -> applyMute(AudioManager.ADJUST_MUTE);
    private final Runnable sendUnmute = () -> applyMute(AudioManager.ADJUST_UNMUTE);
    private final Runnable click = () -> {
        if (sound != null) sound.play(GallerySound.DETENT);
    };

    /** Changes that did not come through onKey: the Google Home app, the voice assistant, or the keys without the layout. */
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent.getIntExtra(EXTRA_STREAM, -1) != AudioManager.STREAM_MUSIC) return;
            if (ACTION_MUTE.equals(intent.getAction())) {
                boolean now = intent.getBooleanExtra(EXTRA_MUTED, muted);
                if (now == muted) return;
                muted = now;
                appear(!ownChangeJustNow());
                return;
            }
            int next = intent.getIntExtra(EXTRA_VALUE, -1);
            int previous = intent.getIntExtra(EXTRA_PREVIOUS, -1);
            if (next < 0 || next == previous || ownChangeJustNow()) return;
            if (!wanted && presence <= 0f) {
                // From where it was, so the knob visibly travels even on the first press.
                shown = previous >= 0 ? previous : next;
                velocity = 0f;
            }
            goal = next;
            asked = next;
            sent = next;
            appear(true);
        }
    };

    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            if (!animating) return;
            float dt = lastFrameNs == 0L ? 1f / 60f : Math.min(0.05f, (now - lastFrameNs) / 1e9f);
            lastFrameNs = now;
            boolean busy = advance(dt);
            invalidate();
            if (busy) {
                Choreographer.getInstance().postFrameCallback(this);
            } else {
                animating = false;
                lastFrameNs = 0L;
            }
        }
    };

    VolumeSlider(Context service) {
        super(service);
        audio = service.getSystemService(AudioManager.class);
        windows = service.getSystemService(WindowManager.class);
        u = service.getResources().getDisplayMetrics().widthPixels / 1280f;
        audioThread.start();
        audioHandler = new Handler(audioThread.getLooper());

        tickPaint.setStrokeWidth(Math.max(1f, 1.3f * u));
        unitPaint.setTextAlign(Paint.Align.RIGHT);
        unitPaint.setColor(0xE6FFFFFF);
        unitPaint.setTextSize(21f * u);
        mutePaint.setTextAlign(Paint.Align.RIGHT);
        mutePaint.setTextSize(54f * u);
        mutePaint.setLetterSpacing(-0.03f);
        mutePaint.setShadowLayer(9f * u, 0f, 0f, 0xB0000000);
        linePaint.setStyle(Paint.Style.FILL);
        glowPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.ADD));

        IntentFilter filter = new IntentFilter(ACTION_VOLUME);
        filter.addAction(ACTION_MUTE);
        service.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        max = Math.max(1, audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        muted = audio.isStreamMute(AudioManager.STREAM_MUSIC);
        goal = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        asked = Math.round(goal);
        sent = asked;
        shown = goal;
        setVisibility(GONE);

        // Made ahead, away from the main thread: the first press after a restart should be as quick as any other.
        audioHandler.post(() -> sound = new GallerySound(service));
        Thread worker = new Thread(() -> {
            Typeface thin = service.getResources().getFont(R.font.inter_thin);
            Typeface light = service.getResources().getFont(R.font.inter_light);
            unitPaint.setTypeface(light);
            mutePaint.setTypeface(thin);
            Bitmap rampArt = makeRamp();
            BitmapShader rampShader = new BitmapShader(rampArt, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            rampShader.setFilterMode(BitmapShader.FILTER_MODE_LINEAR);
            lineShader = new RuntimeShader(LINE_SKSL);
            lineShader.setInputShader("ramp", rampShader);
            glowShader = new RuntimeShader(GLOW_SKSL);
            knob = makeKnob();
            shade = makeShade();
            makeDigits(thin);
            makeLabels(light);
            main.post(() -> {
                if (released) return;
                linePaint.setShader(lineShader);
                glowPaint.setShader(glowShader);
                ready = true;
                attach();
            });
        }, "volume-art");
        worker.start();
    }

    private void goBackIn() {
        wanted = false;
        wake();
        audioHandler.post(this::readSystem);
    }

    /** On the audio thread. Whatever came in while the last call was in the audio service goes as one change. */
    private void applyVolume() {
        int next = asked;
        if (next == sent) return;
        sent = next;
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0);
    }

    private void applyMute(int adjust) {
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, adjust, 0);
    }

    void release() {
        released = true;
        getContext().unregisterReceiver(receiver);
        removeCallbacks(leave);
        animating = false;
        Choreographer.getInstance().removeFrameCallback(frame);
        if (added) windows.removeView(this);
        added = false;
        audioHandler.post(() -> {
            if (sound != null) sound.release();
        });
        audioThread.quitSafely();
    }

    /** A key from the remote, by way of the key helper. True when it is one of the volume keys, which go no further. */
    boolean onKey(KeyEvent event) {
        int code = event.getKeyCode();
        int direction = code == KEY_RAISE ? 1 : code == KEY_LOWER ? -1 : 0;
        if (direction == 0 && code != KEY_MUTE) return false;
        if (event.getRepeatCount() != 0) return true;
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        if (direction == 0) {
            if (down) setMuted(!muted);
        } else if (down) {
            press(direction);
        } else if (held == direction) {
            letGo();
        }
        return true;
    }

    private void press(int direction) {
        if (!wanted && presence <= 0f) {
            shown = goal;
            velocity = 0f;
        }
        if (muted) setMuted(false);
        held = direction;
        heldFor = 0f;
        setGoal(Math.round(goal) + direction);
        jolt = 1f;
        audioHandler.post(click);
        appear(false);
    }

    private void letGo() {
        held = 0;
        removeCallbacks(leave);
        postDelayed(leave, overTvBar ? STAY_OVER_TV_BAR_MS : STAY_MS);
    }

    private void setMuted(boolean now) {
        muted = now;
        lastOwnMs = SystemClock.uptimeMillis();
        audioHandler.post(now ? sendMute : sendUnmute);
        appear(false);
    }

    private void setGoal(float next) {
        goal = Math.max(0f, Math.min(max, next));
        lastOwnMs = SystemClock.uptimeMillis();
        int whole = Math.round(goal);
        if (whole != asked) {
            asked = whole;
            audioHandler.post(sendVolume);
        }
    }

    private boolean ownChangeJustNow() {
        return held != 0 || SystemClock.uptimeMillis() - lastOwnMs < OWN_ECHO_MS;
    }

    private void appear(boolean fromElsewhere) {
        overTvBar |= fromElsewhere;
        wanted = true;
        setVisibility(VISIBLE);
        removeCallbacks(leave);
        if (held == 0) postDelayed(leave, overTvBar ? STAY_OVER_TV_BAR_MS : STAY_MS);
        wake();
    }

    /** On the audio thread, once the slider has gone: the truth, in case a report was missed or taken for an echo. */
    private void readSystem() {
        int real = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        boolean silent = audio.isStreamMute(AudioManager.STREAM_MUSIC);
        main.post(() -> {
            overTvBar = false;
            if (wanted || held != 0 || ownChangeJustNow()) return;
            muted = silent;
            goal = real;
            asked = real;
            sent = real;
            shown = real;
            velocity = 0f;
        });
    }

    private void attach() {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                Math.round((1280f - WINDOW_LEFT) * u), WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        // A service's window gets no hardware drawing unless it asks.
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.END | Gravity.TOP;
        lp.setTitle("OwnerVolumeSlider");
        windowRect.set(0f, 0f, (1280f - WINDOW_LEFT) * u, 720f * u);
        try {
            windows.addView(this, lp);
            added = true;
        } catch (RuntimeException noWindow) {
            added = false;   // no slider is better than taking the launcher down at boot
        }
    }

    private static float smooth(float from, float to, float v) {
        float t = Math.max(0f, Math.min(1f, (v - from) / (to - from)));
        return t * t * (3f - 2f * t);
    }

    /**
     * The shade the slider stands on: nothing at its left, fully opaque over the TV's own bar (screen x 1200 to 1253,
     * y 181 to 539), and fading out above and below, so it never reads as a shape. Low resolution and stretched: it has
     * no detail, and black has no banding to hide.
     */
    private Bitmap makeShade() {
        int w = 160, h = 180;
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            float sy = y * 720f / (h - 1);
            float vertical = smooth(16f, 150f, sy) * (1f - smooth(575f, 704f, sy));
            for (int x = 0; x < w; x++) {
                float sx = WINDOW_LEFT + x * (1280f - WINDOW_LEFT) / (w - 1);
                float across = smooth(WINDOW_LEFT + 8f, 1090f, sx);
                px[y * w + x] = Math.round(255f * across * vertical) << 24;
            }
        }
        return GalleryArt.gpu(Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888));
    }

    /** The knob: a soft-edged dark dome in a shallow ring, with the two small arrows of the reference. */
    private Bitmap makeKnob() {
        int side = Math.round(KNOB_R * u * 3f);
        Bitmap b = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        float m = side / 2f, r = KNOB_R * u;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        p.setShader(new RadialGradient(m + 2f * u, m + 4f * u, r * 1.42f, new int[]{0xB0000000, 0x70000000, 0x00000000},
                new float[]{0.6f, 0.8f, 1f}, Shader.TileMode.CLAMP));
        c.drawCircle(m + 2f * u, m + 4f * u, r * 1.42f, p);
        p.setShader(new LinearGradient(m - r, m - r, m + r, m + r, 0xFF484A48, 0xFF1C1D1C, Shader.TileMode.CLAMP));
        c.drawCircle(m, m, r, p);
        float inner = r * 0.70f;
        p.setShader(new LinearGradient(m - inner, m - inner, m + inner, m + inner, 0xFF262726, 0xFF393B39, Shader.TileMode.CLAMP));
        c.drawCircle(m, m, inner, p);
        p.setShader(null);
        p.setColor(0xFFA8AAA6);
        float w = 7f * u, h = 8.8f * u, gap = 3.8f * u;
        Path arrows = new Path();
        arrows.moveTo(m, m - gap - h);
        arrows.lineTo(m + w, m - gap);
        arrows.lineTo(m - w, m - gap);
        arrows.close();
        arrows.moveTo(m, m + gap + h);
        arrows.lineTo(m + w, m + gap);
        arrows.lineTo(m - w, m + gap);
        arrows.close();
        c.drawPath(arrows, p);
        return GalleryArt.gpu(b);
    }

    private Bitmap makeRamp() {
        int stop = 0;
        for (int i = 0; i < ramp.length; i++) {
            float t = i / (ramp.length - 1f);
            while (stop < RAMP_AT.length - 2 && t > RAMP_AT[stop + 1]) stop++;
            ramp[i] = blend(RAMP_STOPS[stop], RAMP_STOPS[stop + 1], smooth(RAMP_AT[stop], RAMP_AT[stop + 1], t));
        }
        return GalleryArt.gpu(Bitmap.createBitmap(ramp, ramp.length, 1, Bitmap.Config.ARGB_8888));
    }

    private void makeDigits(Typeface face) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(face);
        p.setTextSize(NUMBER_SIZE * u);
        p.setFontFeatureSettings("'tnum'");
        p.setColor(Color.WHITE);
        float widest = 0f;
        for (int d = 0; d <= 9; d++) widest = Math.max(widest, p.measureText(Integer.toString(d)));
        int advance = (int) Math.ceil(widest);
        Rect ink = new Rect();
        p.getTextBounds("0123456789", 0, 10, ink);
        // Room for the soft shadow, which keeps a thin number readable over a bright picture.
        digitPad = Math.round(14f * u) + 1;
        digitBaseline = (int) Math.ceil(-ink.top) + digitPad;
        digitHeight = digitBaseline + (int) Math.ceil(ink.bottom) + digitPad;
        digitCell = advance + 2 * digitPad;
        digitPitch = Math.round(advance - 0.03f * NUMBER_SIZE * u);
        Bitmap b = Bitmap.createBitmap(digitCell * 10, digitHeight, Bitmap.Config.ALPHA_8);
        Canvas c = new Canvas(b);
        for (int d = 0; d <= 9; d++) {
            String s = Integer.toString(d);
            c.drawText(s, d * digitCell + digitPad + (advance - p.measureText(s)) / 2f, digitBaseline, p);
        }
        b.prepareToDraw();
        digits = b;
        Bitmap soft = Bitmap.createBitmap(digitCell * 10, digitHeight, Bitmap.Config.ALPHA_8);
        Canvas sc = new Canvas(soft);
        p.setMaskFilter(new BlurMaskFilter(7f * u, BlurMaskFilter.Blur.NORMAL));
        p.setStyle(Paint.Style.FILL_AND_STROKE);
        p.setStrokeWidth(2f * u);
        for (int d = 0; d <= 9; d++) {
            String s = Integer.toString(d);
            sc.drawText(s, d * digitCell + digitPad + (advance - p.measureText(s)) / 2f, digitBaseline, p);
        }
        soft.prepareToDraw();
        digitShadows = soft;
    }

    private void makeLabels(Typeface face) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(face);
        float size = LABEL_SIZE * u * LABEL_GROW;
        p.setTextSize(size);
        p.setTextAlign(Paint.Align.RIGHT);
        p.setColor(Color.WHITE);
        labelPad = Math.round(2f * u) + 1;
        String[] texts = {"20", "40", "60", "80", "100"};
        for (int i = 0; i < texts.length; i++) {
            int w = (int) Math.ceil(p.measureText(texts[i])) + 2 * labelPad;
            int h = (int) Math.ceil(size) + 2 * labelPad;
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ALPHA_8);
            new Canvas(b).drawText(texts[i], w - labelPad, h / 2f + 7f * u * LABEL_GROW, p);
            b.prepareToDraw();
            labelArt[i] = b;
        }
    }

    private void wake() {
        if (animating) return;
        animating = true;
        lastFrameNs = 0L;
        Choreographer.getInstance().postFrameCallback(frame);
    }

    private static float approach(float value, float goal, float rate, float dt) {
        return value + (goal - value) * (1f - (float) Math.exp(-rate * dt));
    }

    private boolean advance(float dt) {
        boolean busy = false;
        if (held != 0) {
            heldFor += dt;
            if (heldFor > HOLD_LONGEST_S) {
                letGo();
            } else if (heldFor > HOLD_DELAY_S) {
                float gathered = Math.min(1f, (heldFor - HOLD_DELAY_S) / HOLD_RATE_RAMP_S);
                setGoal(goal + held * (HOLD_RATE_FIRST + (HOLD_RATE_FULL - HOLD_RATE_FIRST) * gathered) * dt);
            }
            busy = true;
        }

        // The same exact critically damped spring as the gallery.
        float error = shown - goal;
        float temp = (velocity + OMEGA * error) * dt;
        float decay = (float) Math.exp(-OMEGA * dt);
        velocity = (velocity - OMEGA * temp) * decay;
        shown = goal + (error + temp) * decay;
        if (Math.abs(shown - goal) > 0.01f || Math.abs(velocity) > 0.02f) {
            busy = true;
        } else {
            shown = goal;
            velocity = 0f;
        }
        jolt = approach(jolt, 0f, 11f, dt);
        if (jolt > 0.004f) busy = true;
        else jolt = 0f;

        float wantPresence = wanted ? 1f : 0f;
        float wantCover = !wanted ? 0f : overTvBar ? 1f : SCRIM;
        presence = approach(presence, wantPresence, wanted ? 12f : 8f, dt);
        // Up at once, so the TV's own bar is never seen; down gently, after it has gone.
        cover = approach(cover, wantCover, wanted ? 60f : 8f, dt);
        if (Math.abs(wantPresence - presence) > 0.004f || Math.abs(wantCover - cover) > 0.004f) {
            busy = true;
        } else {
            presence = wantPresence;
            cover = wantCover;
            if (!wanted) setVisibility(GONE);
        }
        return busy;
    }

    private static int blend(int a, int b, float t) {
        return Color.rgb(Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * t),
                Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * t),
                Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t));
    }

    private int colourAt(float t) {
        return muted ? MUTED_COLOUR : ramp[Math.round(Math.max(0f, Math.min(1f, t)) * (ramp.length - 1))];
    }

    /** A design x, in this window. */
    private float wx(float screenX) {
        return (screenX - WINDOW_LEFT) * u;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (!ready) return;
        shadePaint.setAlpha(Math.round(255f * cover));
        c.drawBitmap(shade, null, windowRect, shadePaint);

        float ease = presence * presence * (3f - 2f * presence);
        float top = SCALE_TOP * u, bottom = SCALE_BOTTOM * u, lineX = wx(LINE_X);
        float t = Math.max(0f, Math.min(1f, shown / max));
        float knobY = bottom - (bottom - top) * t;
        int colour = colourAt(t);
        int alpha = Math.round(255f * ease);

        int outer = c.save();
        // Out of the screen's edge: the whole thing slides in while the scale opens up and down from the knob.
        c.translate((1f - ease) * 92f * u, 0f);
        float open = (bottom - top + 120f * u) * ease;
        c.clipRect(0f, knobY - open, windowRect.right, knobY + open);

        drawScale(c, top, bottom, lineX, knobY, colour, alpha);

        // The swell is liquid: it reaches further and stretches along the line the faster the knob travels.
        float speed = Math.min(1f, Math.abs(velocity) / 16f);
        float reach = SWELL * u * (1f + 0.30f * speed + 0.10f * jolt);
        float half = SWELL_HALF * u * (1f + 0.22f * speed);
        float lead = Math.max(-14f, Math.min(14f, velocity * 0.9f)) * u;

        float radius = 145f * u * (1f + 0.08f * jolt);
        int far = colourAt(t + 0.22f);
        glowShader.setFloatUniform("knob", lineX, knobY);
        glowShader.setFloatUniform("swell", reach, half + lead, half - lead);
        glowShader.setFloatUniform("light", lineX + reach - 6f * u, knobY, radius);
        glowShader.setFloatUniform("inner", Color.red(colour) / 255f, Color.green(colour) / 255f,
                Color.blue(colour) / 255f, (muted ? 0.25f : 0.92f) * ease);
        glowShader.setFloatUniform("outer", Color.red(far) / 255f, Color.green(far) / 255f, Color.blue(far) / 255f);
        c.drawRect(lineX, knobY - radius, windowRect.right, knobY + radius, glowPaint);

        lineShader.setFloatUniform("knob", lineX, knobY);
        lineShader.setFloatUniform("swell", reach, half + lead, half - lead);
        lineShader.setFloatUniform("edges", 1.5f * u, top, bottom + 2f * u, ease);
        lineShader.setFloatUniform("fade", knobY - 210f * u, 176f * u, muted ? 1f : 0f);
        c.drawRect(lineX - 4f * u, top - u, lineX + reach + 4f * u, bottom + 3f * u, linePaint);

        // A short kick on a press: the knob feels like it clicks into place.
        knobPaint.setAlpha(alpha);
        c.drawBitmap(knob, wx(KNOB_X) - jolt * 2.4f * u - knob.getWidth() / 2f, knobY - knob.getHeight() / 2f, knobPaint);

        if (muted) {
            mutePaint.setColor(colour);
            mutePaint.setAlpha(alpha);
            c.drawText(Words.t("Mute"), wx(NUMBER_END), knobY + 19f * u, mutePaint);
        } else {
            digitPaint.setColor(blend(colour, Color.WHITE, 0.22f));
            digitPaint.setAlpha(alpha);
            digitShadowPaint.setColor(Color.BLACK);
            digitShadowPaint.setAlpha(Math.round(alpha * 0.85f));
            float baseline = knobY + 33f * u;
            // Sharp at rest; in between pixels only while it moves, when that is what looks smooth.
            if (Math.abs(velocity) < 0.5f) baseline = Math.round(baseline);
            drawNumber(c, Math.round(shown), Math.round(wx(NUMBER_END)), baseline);
        }
        c.restoreToCount(outer);
    }

    private void drawNumber(Canvas c, int number, float end, float baseline) {
        int rest = Math.max(0, number);
        do {
            int digit = rest % 10;
            from.set(digit * digitCell, 0, (digit + 1) * digitCell, digitHeight);
            float left = end - digitCell + digitPad;
            float y = baseline - digitBaseline;
            to.set(left, y, left + digitCell, y + digitHeight);
            c.drawBitmap(digitShadows, from, to, digitShadowPaint);
            c.drawBitmap(digits, from, to, digitPaint);
            end -= digitPitch;
            rest /= 10;
        } while (rest > 0);
    }

    /** The fine scale. Like a lens passing over it: ticks and numbers near the knob grow, brighten and take its colour. */
    private void drawScale(Canvas c, float top, float bottom, float lineX, float knobY, int colour, int alpha) {
        float tickStart = lineX + 21f * u;
        float span = bottom - top;
        float fade = alpha / 255f;
        int steps = 25;
        for (int i = 0; i <= steps; i++) {
            float y = bottom - span * i / steps;
            float near = (float) Math.exp(-(y - knobY) * (y - knobY) / (82f * 82f * u * u));
            boolean major = i % 5 == 0;
            float length = (major ? 27f : 14f) * (1f + 0.20f * near) * u;
            tickPaint.setColor(blend(Color.WHITE, colour, near));
            tickPaint.setAlpha(Math.round(255f * fade * ((major ? 0.40f : 0.18f) + (major ? 0.48f : 0.28f) * near)));
            c.drawLine(tickStart, y, tickStart + length, y, tickPaint);
        }
        float labelEnd = wx(LABEL_END);
        for (int i = 0; i < labelArt.length; i++) {
            float y = bottom - span * (i + 1) / labelArt.length;
            float near = (float) Math.exp(-(y - knobY) * (y - knobY) / (96f * 96f * u * u));
            float k = (1f + (LABEL_GROW - 1f) * near) / LABEL_GROW;
            Bitmap art = labelArt[i];
            labelPaint.setColor(blend(Color.WHITE, colour, near));
            labelPaint.setAlpha(Math.round(255f * fade * (0.20f + 0.70f * near)));
            to.set(labelEnd - (art.getWidth() - labelPad) * k, y - art.getHeight() / 2f * k,
                    labelEnd + labelPad * k, y + art.getHeight() / 2f * k);
            c.drawBitmap(art, null, to, labelPaint);
        }
        unitPaint.setAlpha(Math.round(230f * fade));
        c.drawText(Words.t("Vol"), labelEnd, bottom + 7f * u, unitPaint);
    }
}
