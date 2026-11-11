package com.gathin.tvhome;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorSpace;
import android.graphics.HardwareRenderer;
import android.graphics.LightingColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.RecordingCanvas;
import android.graphics.RectF;
import android.graphics.RenderEffect;
import android.graphics.RenderNode;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.hardware.HardwareBuffer;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.Choreographer;
import android.view.Display;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import java.net.Inet4Address;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The Control Center: the remote's Settings button (or Up at the top of Home) pours it out of the Island as liquid glass,
 * over whatever is on screen. Arrow keys move, OK acts, OK held on Sound lists where the sound plays, Back closes.
 *
 * One window of the helper (HomeKeyService), drawn here: the screen behind is a blurred picture taken as it opens (this
 * TV composites no live blur: low-RAM, no SurfaceFlinger blur), and each tile is glass from one small GPU shader that
 * bends that picture at its rim. Every motion is a spring, so a key pressed in the middle of one simply re-aims it.
 * The layout is the demo's (work/cc-demo), in the 1280 × 720 frame Home also draws in.
 */
final class ControlCenter extends View {

    private static final int CAPSULE = 0, CIRCLE = 1, PILL = 2, CARD = 3, ROUND = 4, SLIDER = 5;
    private static final float ISL_CY = 26f, BAR_W = 1136f;
    private static final int BLUR_W = 320, BLUR_H = 180;
    private static final String YOUTUBE = "com.google.android.youtube.tv";
    /** The Live TV app beside Home (launcher/livetv), and its player. The class keeps the Java package the app was
     *  first written in, so it is never built from the app's id. */
    private static final String LIVE_TV = "dev.shiv.orbit.live";
    private static final String LIVE_TV_ACTIVITY = "com.gathin.livetv.LiveTvActivity";
    private static final String CAST_APP = "com.xiaomi.mitv.smartshare";

    // ---------------------------------------------------------------- springs: every motion is one of these

    private static final class Spring {
        float v, t, vel, k, c;

        Spring(float v, float k, float c) {
            this.v = v;
            this.t = v;
            this.k = k;
            this.c = c;
        }

        Spring to(float target) {
            t = target;
            return this;
        }

        Spring to(float target, float stiffness, float damping) {
            t = target;
            k = stiffness;
            c = damping;
            return this;
        }

        Spring snap(float value) {
            v = t = value;
            vel = 0f;
            return this;
        }

        void kick(float speed) {
            vel += speed;
        }

        void step(float h) {
            float a = -k * (v - t) - c * vel;
            vel += a * h;
            v += vel * h;
        }

        boolean rest() {
            return Math.abs(v - t) < 3e-4f && Math.abs(vel) < 3e-3f;
        }
    }

    private final List<Spring> springs = new ArrayList<>();

    private Spring spring(float v, float k, float c) {
        Spring s = new Spring(v, k, c);
        springs.add(s);
        return s;
    }

    // ---------------------------------------------------------------- tiles

    private final class Mod {
        final String id;
        final int kind;
        final float x, y, w, h, r, tcx, tcy, gx, gy;
        final boolean full;
        final Spring p = spring(0f, 230f, 23f), f = spring(0f, 430f, 30f), pr = spring(0f, 900f, 44f),
                vis = spring(1f, 700f, 52f), nx = spring(0f, 620f, 20f), ny = spring(0f, 620f, 20f);
        final RuntimeShader shader = new RuntimeShader(GLASS);
        final Paint paint = new Paint();
        /** Its words and icons, as a layer on the GPU (see record and stamp). */
        final RenderNode node;
        long stamp = Long.MIN_VALUE;
        final float padL, padT, padR, padB;
        long startAt, sheenAt = -100000L;
        float goal = -1f, goalK, goalC;
        boolean hide, inner;
        int icon, color;
        String label;
        // where it is now, in the 1280 × 720 frame
        float cx, cy, cw, ch, cr;

        Mod(String id, int kind, float x, float y, float w, float h, float r) {
            this.id = id;
            this.kind = kind;
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            full = kind != CARD;
            this.r = full ? Math.min(w, h) / 2f : r;
            tcx = x + w / 2f;
            tcy = y + h / 2f;
            gx = clamp(w * 0.07f, 3f, 9f);
            gy = clamp(h * 0.07f, 3f, 7f);
            paint.setShader(shader);
            // A round button's name sits under it, wider than the button.
            boolean below = kind == ROUND;
            padL = below ? 30f : 4f;
            padR = below ? 30f : 4f;
            padT = 4f;
            padB = below ? 44f : 4f;
            node = new RenderNode("cc-" + id);
            node.setUseCompositingLayer(true, null);
        }

        /** The rectangle it is drawn in now: out of the bar along the top, grown by focus, pressed by OK. */
        void place() {
            float k = p.v;
            float sw = Math.max(36f, w * 0.8f);
            float x0 = lerp(tcx, tcx, k), y0 = lerp(ISL_CY, tcy, k);
            float ww = lerp(sw, w, k), hh = lerp(30f, h, k);
            float focus = f.v * (inner ? 0.45f : 1f), press = pr.v;
            ww += 2f * gx * focus - 2f * Math.min(6f, ww * 0.035f) * press;
            hh += 2f * gy * focus - 2f * Math.min(5f, hh * 0.045f) * press;
            cx = x0 + nx.v;
            cy = y0 + ny.v;
            cw = Math.max(2f, ww);
            ch = Math.max(2f, hh);
            cr = full ? Math.min(cw, ch) / 2f : Math.min(lerp(15f, r, k) + 2f * focus, Math.min(cw, ch) / 2f);
        }
    }

    private final class Target {
        final String id, mod;
        final float[] inner; // x, y, w, h, radius, or null for the whole tile
        final Runnable ok, hold;
        final String slider;
        /** Where each arrow last came from, so the opposite arrow goes back there. */
        final java.util.Map<String, Target> memory = new java.util.HashMap<>();

        Target(String id, String mod, float[] inner, String slider, Runnable ok, Runnable hold) {
            this.id = id;
            this.mod = mod;
            this.inner = inner;
            this.slider = slider;
            this.ok = ok;
            this.hold = hold;
        }
    }

    /** CYCLE: OK steps through its values (Speed 1× → 1.25× → ...), shown on the right. */
    private static final int RADIO = 0, TOGGLE = 1, ACTION = 2, INFO = 3, NOTE = 4, CYCLE = 5;
    /** Cards drawn by their own code instead of a list. */
    private static final int LYRICS = 1, PHONE = 2;

    private static final class Item {
        final int type, icon;
        final String label;
        String sub, right;
        boolean on;
        Runnable act;
        String[] values;
        int index;

        Item(int type, int icon, String label, String sub) {
            this.type = type;
            this.icon = icon;
            this.label = label;
            this.sub = sub;
        }

        boolean focusable() {
            return type != INFO && type != NOTE;
        }
    }

    private final class Detail {
        final String kind, title, from;
        String sub;
        final int icon, color;
        final List<Item> items = new ArrayList<>();
        int focus;
        /** 0: a list of items; LYRICS or PHONE: drawn by its own code, at its own size. */
        int custom;
        float w = 520f, h = -1f;

        Detail(String kind, int icon, int color, String title, String sub, String from) {
            this.kind = kind;
            this.icon = icon;
            this.color = color;
            this.title = title;
            this.sub = sub;
            this.from = from;
        }
    }

    // ---------------------------------------------------------------- state

    private final HomeKeyService service;
    private final WindowManager windows;
    private final Choreographer choreographer = Choreographer.getInstance();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final float u;
    private final List<Mod> mods = new ArrayList<>();
    private final java.util.Map<String, Mod> byId = new java.util.HashMap<>();
    private final List<Target> targets = new ArrayList<>();
    private final java.util.Map<String, Target> tById = new java.util.HashMap<>();

    private final Spring bg = spring(0f, 110f, 21f), rc = spring(0f, 260f, 30f);
    private final Spring barW = spring(24f, 520f, 40f), barH = spring(6f, 520f, 40f), barA = spring(0f, 520f, 44f);
    private final Spring toastW = spring(128f, 420f, 30f), toastA = spring(0f, 520f, 44f), toastT = spring(0f, 520f, 44f);
    private final Spring cardP = spring(0f, 270f, 26f), cardA = spring(0f, 900f, 60f);
    private final Spring pillX = spring(0f, 520f, 38f), pillY = spring(0f, 520f, 38f), pillW = spring(10f, 520f, 38f),
            pillH = spring(10f, 520f, 38f), pillA = spring(0f, 420f, 36f), pillP = spring(0f, 900f, 44f);
    private final Spring volume = spring(0f, 300f, 30f), light = spring(0f, 300f, 30f);
    private float pillR = 20f;

    private final RuntimeShader barShader = new RuntimeShader(GLASS), cardShader = new RuntimeShader(GLASS),
            toastShader = new RuntimeShader(GLASS), pillShader = new RuntimeShader(PILL_SKSL);
    private final Paint barPaint = new Paint(), cardPaint = new Paint(), toastPaint = new Paint(), pillPaint = new Paint();
    private final Paint backPaint = new Paint(Paint.FILTER_BITMAP_FLAG), dimPaint = new Paint(), fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint title = text(R.font.inter_medium, 17f, 0xFFFFFFFF), sub = text(R.font.inter_regular, 14f, 0xADFFFFFF),
            small = text(R.font.inter_regular, 12f, 0x75FFFFFF), label = text(R.font.inter_medium, 13.5f, 0xADFFFFFF),
            clock = text(R.font.inter_light, 56f, 0xFFFFFFFF), ampm = text(R.font.inter_regular, 18f, 0xADFFFFFF),
            big = text(R.font.inter_medium, 18f, 0xFFFFFFFF), item = text(R.font.inter_regular, 16.5f, 0xFFFFFFFF),
            head = text(R.font.inter_medium, 22f, 0xFFFFFFFF), caps = text(R.font.inter_medium, 12.5f, 0x75FFFFFF),
            chipText = text(R.font.inter_medium, 15f, 0xFFFFFFFF), tenText = text(R.font.inter_medium, 7f, 0xFFFFFFFF);
    private final RectF r = new RectF();
    private final Matrix backMatrix = new Matrix();
    private int backLevel = -1;
    private boolean homeCovered;
    // Read once per opening (or when they change), never per frame: some of them are calls into the system.
    private String outputName = "TV speakers", clockText = "", ampmText = "", dateText = "";
    private List<TvIsland.Note> notesNow = new ArrayList<>();
    private String[] titleLines = {""};
    private String titleFor;
    private final java.util.Map<Long, Drawable> sized = new java.util.HashMap<>();
    private Bitmap backdrop, art, artFor;
    private BitmapShader backShader, artShader;
    private Shader warm;
    private final Paint artPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Bitmap blank = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);

    private boolean added, open, animating, wantOpen, broken;
    private long lastNs, capturedAt, openedAt, drawnAt;
    private String focus = "np-play";
    private Detail detail;
    private Mod cardSrc;
    private boolean cardClosing;
    private float csx, csy, csw, csh, csr, ctx, cty, ctw, cth;
    private String toastText = "";
    private int toastIcon;
    private final Runnable hideToast = this::endToast;
    private boolean okDown, okHeld;
    private final Runnable holdOk = this::onHold;
    private long navAt;
    private int scene = -1;

    // the colours of what is playing: they tint the glass and light the room behind the panel
    private int accentA, accentB;
    private final Spring tintK = spring(0f, 120f, 22f);
    private final float[] tintFrom = {0.085f, 0.088f, 0.11f}, tintTo = {0.085f, 0.088f, 0.11f};
    private final Paint washPaint = new Paint(), glowPaint = new Paint();
    private int washFor;
    // the session itself: whose it is, the video's id (for the phone), and whether it takes a speed
    private String mediaPkg, mediaId, artUrl, lastTold;
    private boolean speedOk;
    private float speedNow = 1f;
    private long readAt;
    // the words of the song
    private PanelMedia.Lyrics lyrics;
    private String lyricsFor;
    private boolean lyricsLoading;
    private final Spring lyricRow = spring(0f, 180f, 26f);
    private final TextPaint lyricNow = text(R.font.inter_medium, 26f, 0xFFFFFFFF), lyricNear = text(R.font.inter_regular, 19f, 0x8CFFFFFF);
    private final Runnable lyricTick = new Runnable() {
        @Override
        public void run() {
            if (!open || detail == null || detail.custom != LYRICS) return;
            float row = lyricIndex();
            if (Math.abs(row - lyricRow.t) > 0.001f) {
                lyricRow.to(row);
                wake();
            }
            main.postDelayed(this, 200L);
        }
    };
    // the code for the phone
    private boolean[][] qr;
    private String qrLink = "";

    // what the tiles show
    private String npTitle = "Nothing playing", npSub = "", npApp = "";
    private long npPos, npDur;
    private boolean playing, muted;
    private int volPct, lightPct = 100;
    private String wifiLine = "", btLine = "", orbitLine = "";
    private boolean wifiOn, btOn, orbitOn;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!open) return;
            readMedia();
            readClock();
            invalidate();
            main.postDelayed(this, 1000L);
        }
    };

    ControlCenter(HomeKeyService service) {
        super(service);
        this.service = service;
        windows = service.getSystemService(WindowManager.class);
        u = service.getResources().getDisplayMetrics().widthPixels / 1280f;
        blank.eraseColor(0xFF0B0C10);
        barPaint.setShader(barShader);
        cardPaint.setShader(cardShader);
        toastPaint.setShader(toastShader);
        pillPaint.setShader(pillShader);
        dimPaint.setColor(Color.BLACK);
        build();
        // Every glass shader needs a picture to bend from the start, even before the first screenshot.
        setBackdrop(null);
        setVisibility(GONE);
    }

    private TextPaint text(int font, float size, int color) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(getContext().getResources().getFont(font));
        p.setTextSize(size);
        p.setColor(color);
        return p;
    }

    // ---------------------------------------------------------------- layout, in the 1280 × 720 frame

    private Mod mod(String id, int kind, float x, float y, float w, float h, float radius) {
        Mod m = new Mod(id, kind, x, y, w, h, radius);
        mods.add(m);
        byId.put(id, m);
        return m;
    }

    private Target target(String id, String mod, float[] inner, String slider, Runnable ok, Runnable hold) {
        Target t = new Target(id, mod, inner, slider, ok, hold);
        targets.add(t);
        tById.put(id, t);
        return t;
    }

    private static final String[][] ROUNDS = {
            {"inputs", "Inputs"}, {"picture", "Picture"}, {"soundmode", "Sound mode"}, {"sleep", "Sleep timer"},
            {"saver", "Screensaver"}, {"quiet", "Quiet"}, {"clear", "Clear all"}, {"recents", "Recent apps"}};
    private static final int[] ROUND_ICONS = {R.drawable.cc_inputs, R.drawable.cc_picture, R.drawable.cc_eq, R.drawable.cc_timer,
            R.drawable.cc_sparkle, R.drawable.cc_moon, R.drawable.cc_broom, R.drawable.cc_recents};
    private static final int[] ROUND_COLORS = {0xFFFF9F0A, 0xFFE0A800, 0xFF0FA3B1, 0xFFFF9F0A, 0xFFBF5AF2, 0xFFBF5AF2, 0xFF30D158, 0xFF0A84FF};
    private static final String[] SCENES = {"Movie Night", "Bhakti", "Good Night"};
    private static final int[] SCENE_ICONS = {R.drawable.cc_film, R.drawable.cc_diya, R.drawable.cc_night};

    private void build() {
        mod("orbit", PILL, 848, 48, 168, 48, 0);
        // The remote's Settings button opens this panel now, so the TV's own Settings are one press from here (10 Nov:
        // the owner could not find his way to Developer options).
        mod("settings", CIRCLE, 1032, 48, 48, 48, 0);
        mod("power", CIRCLE, 1096, 48, 48, 48, 0);
        // A plain way out, besides Back: the owner looked for one (10 Nov).
        mod("close", CIRCLE, 1160, 48, 48, 48, 0);
        mod("wifi", CAPSULE, 72, 128, 316, 72, 0);
        mod("bt", CAPSULE, 72, 216, 316, 72, 0);
        mod("cast", CAPSULE, 72, 304, 316, 72, 0);
        mod("np", CARD, 404, 128, 384, 248, 34);
        for (int i = 0; i < ROUNDS.length; i++) {
            Mod m = mod(ROUNDS[i][0], ROUND, 812.5f + (i % 4) * 105f, 128f + (i / 4) * 120f, 72, 72, 0);
            m.label = ROUNDS[i][1];
            m.icon = ROUND_ICONS[i];
            m.color = ROUND_COLORS[i];
        }
        mod("display", SLIDER, 72, 392, 1136, 64, 0);
        mod("sound", SLIDER, 72, 472, 1136, 64, 0);
        mod("scenes", CARD, 72, 552, 560, 104, 30);
        mod("notes", CARD, 648, 552, 560, 104, 30);

        target("orbit", "orbit", null, null, () -> openDetail("orbit"), null);
        target("settings", "settings", null, null,
                () -> closeThen(() -> service.ccOpen(SystemSettings.intent(service, Settings.ACTION_SETTINGS))), null);
        target("power", "power", null, null, () -> openDetail("power"), null);
        target("close", "close", null, null, this::close, null);
        target("wifi", "wifi", null, null, () -> openDetail("wifi"), null);
        target("bt", "bt", null, null, () -> openDetail("bt"), null);
        target("cast", "cast", null, null, () -> openDetail("cast"), null);
        target("np-open", "np", new float[]{416, 140, 360, 96, 22}, null, () -> openDetail("nowplaying"), null);
        target("np-b10", "np", new float[]{436, 302, 48, 48, 24}, null, () -> seek(-10_000L), null);
        target("np-prev", "np", new float[]{504, 302, 48, 48, 24}, null, () -> transport(KeyEvent.KEYCODE_MEDIA_PREVIOUS), null);
        target("np-play", "np", new float[]{568, 298, 56, 56, 28}, null, this::playPause, null);
        target("np-next", "np", new float[]{640, 302, 48, 48, 24}, null, () -> transport(KeyEvent.KEYCODE_MEDIA_NEXT), null);
        target("np-f10", "np", new float[]{708, 302, 48, 48, 24}, null, () -> seek(10_000L), null);
        target("inputs", "inputs", null, null, () -> openDetail("inputs"), null);
        target("picture", "picture", null, null, () -> openSettings("com.mitv.settings.PICTURE_SETTINGS", Settings.ACTION_DISPLAY_SETTINGS), null);
        target("soundmode", "soundmode", null, null, () -> openSettings("com.mitv.settings.SOUND_SETTINGS", Settings.ACTION_SOUND_SETTINGS), null);
        target("sleep", "sleep", null, null, () -> openDetail("sleep"), null);
        target("saver", "saver", null, null, this::startSaver, null);
        target("quiet", "quiet", null, null, this::toggleQuiet, null);
        target("clear", "clear", null, null, () -> closeThen(service::ccClearAll), null);
        target("recents", "recents", null, null, () -> closeThen(service::ccRecents), null);
        target("display", "display", null, "display", this::toggleEye, null);
        target("sound", "sound", null, "sound", this::toggleMute, () -> openDetail("outputs"));
        for (int i = 0; i < SCENES.length; i++) {
            final int n = i;
            target("scene" + i, "scenes", new float[]{88 + i * 180, 592, 168, 48, 24}, null, () -> applyScene(n), null);
        }
        target("notes", "notes", null, null, () -> openDetail("notes"), null);
    }

    // ---------------------------------------------------------------- open and close

    boolean isOpen() {
        return open;
    }

    /** Open, or opening (the screen's picture is on its way): the remote's keys are the panel's either way. */
    boolean isActive() {
        return open || wantOpen;
    }

    /** Opens the panel: a picture of the screen first (this window is not on it yet), then the pour. */
    void open() {
        if (open || wantOpen || broken) return;
        if (!ensureWindow()) return;
        wantOpen = true;
        long now = SystemClock.uptimeMillis();
        // takeScreenshot answers at most every 333 ms; a quick reopen keeps the last picture.
        if (backdrop != null && now - capturedAt < 1500L) {
            begin();
            return;
        }
        capturedAt = now;
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, service.getMainExecutor(), new AccessibilityService.TakeScreenshotCallback() {
                @Override
                public void onSuccess(AccessibilityService.ScreenshotResult result) {
                    HardwareBuffer buffer = result.getHardwareBuffer();
                    final Bitmap shot = Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
                    buffer.close();
                    if (shot == null) {
                        begin();
                        return;
                    }
                    worker.execute(() -> {
                        Bitmap blurred = blur(shot);
                        main.post(() -> {
                            setFrozen(shot);
                            setBackdrop(blurred);
                            begin();
                        });
                    });
                }

                @Override
                public void onFailure(int errorCode) {
                    begin();
                }
            });
        } catch (RuntimeException noScreenshot) {
            begin();
        }
        // Never wait on the picture for long: the panel comes without it.
        main.postDelayed(this::begin, 300L);
    }

    private void begin() {
        if (!wantOpen || open) return;
        wantOpen = false;
        open = true;
        openedAt = SystemClock.uptimeMillis();
        main.removeCallbacks(watchdog);
        main.postDelayed(watchdog, 1500L);
        readAll();
        setVisibility(VISIBLE);
        // The Island stretches into a bar along the top, and the tiles drop out of it row by row.
        barW.snap(24f);
        barH.snap(6f);
        barA.snap(0f).to(1f, 700f, 50f);
        barW.to(BAR_W, 300f, 30f);
        barH.to(30f, 420f, 34f);
        long t0 = SystemClock.uptimeMillis();
        for (Mod m : mods) {
            m.startAt = t0 + 90L + Math.round((m.tcy - 72f) * 0.3f + Math.abs(m.tcx - 640f) * 0.05f);
            m.goal = 1f;
            m.goalK = 230f;
            m.goalC = 23f;
            m.hide = false;
            m.vis.snap(1f);
        }
        bg.to(1f, 110f, 21f);
        setFocus(focus, true);
        main.removeCallbacks(tick);
        main.postDelayed(tick, 1000L);
        wake();
    }

    void close() {
        wantOpen = false;
        if (!open) return;
        if (detail != null) closeDetail(true);
        open = false;
        main.removeCallbacks(tick);
        main.removeCallbacks(holdOk);
        okDown = false;
        barA.to(1f, 520f, 44f);
        barW.to(BAR_W, 380f, 34f);
        barH.to(30f, 380f, 34f);
        long t0 = SystemClock.uptimeMillis();
        for (Mod m : mods) {
            m.startAt = t0 + Math.round((604f - m.tcy) * 0.22f + Math.abs(m.tcx - 640f) * 0.03f);
            m.goal = 0f;
            m.goalK = 330f;
            m.goalC = 34f;
            m.f.to(0f);
        }
        pillA.to(0f, 600f, 50f);
        bg.to(0f, 170f, 26f);
        // Home draws again under the blur as it fades, so what comes back is the live screen, not a picture of it.
        setFrozen(null);
        uncoverHome();
        wake();
    }

    private void uncoverHome() {
        if (!homeCovered) return;
        homeCovered = false;
        GalleryHomeView home = GalleryHomeView.alive();
        if (home != null) home.setCovered(false);
    }

    /** Closes the panel and does something once it is out of the way (an app or Settings coming up). */
    private void closeThen(Runnable after) {
        close();
        main.postDelayed(after, 160L);
    }

    void release() {
        open = false;
        wantOpen = false;
        main.removeCallbacksAndMessages(null);
        if (added) {
            try {
                windows.removeView(this);
            } catch (RuntimeException gone) {
                // already gone with the service
            }
        }
        added = false;
        worker.shutdownNow();
        uncoverHome();
        setFrozen(null);
        setBackdrop(null);
    }

    private boolean ensureWindow() {
        if (added) return true;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.setTitle("OwnerControlCenter");
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

    // ---------------------------------------------------------------- the picture behind

    /** The screen, small and blurred on the GPU, for the glass to bend: an offscreen render, one frame's work. */
    private static Bitmap blur(Bitmap shot) {
        ImageReader reader = ImageReader.newInstance(BLUR_W, BLUR_H, PixelFormat.RGBA_8888, 1,
                HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_GPU_COLOR_OUTPUT);
        RenderNode node = new RenderNode("cc-blur");
        HardwareRenderer renderer = new HardwareRenderer();
        try {
            renderer.setSurface(reader.getSurface());
            renderer.setContentRoot(node);
            node.setPosition(0, 0, BLUR_W, BLUR_H);
            node.setRenderEffect(RenderEffect.createBlurEffect(9f, 9f, Shader.TileMode.CLAMP));
            RecordingCanvas c = node.beginRecording();
            c.scale(BLUR_W / (float) shot.getWidth(), BLUR_H / (float) shot.getHeight());
            c.drawBitmap(shot, 0f, 0f, new Paint(Paint.FILTER_BITMAP_FLAG));
            node.endRecording();
            renderer.createRenderRequest().setWaitForPresent(true).syncAndDraw();
            Image image = reader.acquireNextImage();
            if (image == null) return null;
            HardwareBuffer buffer = image.getHardwareBuffer();
            Bitmap out = buffer == null ? null : Bitmap.wrapHardwareBuffer(buffer, ColorSpace.get(ColorSpace.Named.SRGB));
            if (buffer != null) buffer.close();
            image.close();
            return out;
        } catch (RuntimeException failed) {
            return null;
        } finally {
            node.discardDisplayList();
            renderer.destroy();
            reader.close();
        }
    }

    /**
     * The screen as it was, sharp, drawn first while the blur fades in over it: it looks exactly like what was there,
     * so Home under it can stop drawing from the panel's first frame (on this GPU the two together were 25–30 ms).
     */
    private Bitmap frozen;
    private boolean frozenShown;
    private final RectF full = new RectF(0f, 0f, 1280f, 720f);
    private final Paint framePaint = new Paint(Paint.FILTER_BITMAP_FLAG);

    private void setFrozen(Bitmap b) {
        if (frozen != null && frozen != b) frozen.recycle();
        frozen = b;
        frozenShown = false;
    }

    private void setBackdrop(Bitmap b) {
        if (backdrop != null && backdrop != b) backdrop.recycle();
        backdrop = b;
        Bitmap use = b != null ? b : blank;
        backShader = new BitmapShader(use, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        backMatrix.setScale(1280f / use.getWidth(), 720f / use.getHeight());
        backShader.setLocalMatrix(backMatrix);
        backPaint.setShader(backShader);
        for (Mod m : mods) m.shader.setInputShader("back", backShader);
        barShader.setInputShader("back", backShader);
        cardShader.setInputShader("back", backShader);
        toastShader.setInputShader("back", backShader);
    }

    // ---------------------------------------------------------------- frames

    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long nowNs) {
            float dt = lastNs == 0L ? 1f / 60f : Math.min(0.05f, (nowNs - lastNs) / 1e9f);
            lastNs = nowNs;
            long ms = SystemClock.uptimeMillis();
            boolean pending = false;
            for (Mod m : mods) {
                if (m.goal < 0f) continue;
                if (ms >= m.startAt) {
                    m.p.to(m.goal, m.goalK, m.goalC);
                    m.goal = -1f;
                } else {
                    pending = true;
                }
            }
            int steps = Math.max(1, (int) Math.ceil(dt * 240f));
            float h = dt / steps;
            boolean active = false;
            for (Spring s : springs) {
                if (s.rest()) {
                    s.v = s.t;
                    s.vel = 0f;
                    continue;
                }
                for (int i = 0; i < steps; i++) s.step(h);
                active = true;
            }
            boolean sheen = false;
            for (Mod m : mods) if (ms - m.sheenAt < 700L) sheen = true;
            settle();
            invalidate();
            if (active || pending || sheen) {
                choreographer.postFrameCallback(this);
            } else {
                animating = false;
                lastNs = 0L;
                if (!open && !wantOpen) {
                    setVisibility(GONE);
                    setBackdrop(null);
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

    private float average() {
        float sum = 0f;
        for (Mod m : mods) sum += clamp(m.p.v, 0f, 1f);
        return sum / mods.size();
    }

    /** The bar along the top goes once the tiles are out, and shrinks into the Island once they are back in. */
    private void settle() {
        float avg = average();
        if (open && avg > 0.5f && barA.t != 0f) {
            barA.to(0f, 260f, 32f);
            barW.to(128f, 300f, 30f);
            barH.to(34f, 300f, 30f);
        }
        if (!open && avg < 0.06f && barW.t != 24f) {
            barW.to(24f, 300f, 30f);
            barH.to(6f, 380f, 34f);
            barA.to(0f, 300f, 30f);
        }
        // Covered by the frozen picture (or the blur, once it is opaque), Home stops drawing underneath.
        boolean cover = open && (frozenShown || (backdrop != null && bg.v > 0.98f));
        if (open && frozen != null && backdrop != null && bg.v > 0.995f) setFrozen(null);
        if (cover != homeCovered) {
            homeCovered = cover;
            GalleryHomeView home = GalleryHomeView.alive();
            if (home != null) home.setCovered(cover);
        }
        if (cardClosing && cardP.v < 0.03f) {
            if (cardSrc != null) {
                cardSrc.hide = false;
                cardSrc.vis.to(1f, 700f, 52f);
            }
            cardA.snap(0f);
            cardClosing = false;
            cardSrc = null;
        }
    }

    // ---------------------------------------------------------------- drawing

    @Override
    protected void onDraw(Canvas c) {
        if (!open && !animating) return;
        drawnAt = SystemClock.uptimeMillis();
        try {
            draw(c, 0);
        } catch (RuntimeException failed) {
            // Never leave the remote's keys with a panel that cannot draw: it goes, and Home works as before.
            android.util.Log.e("ControlCenter", "draw failed", failed);
            broken = true;
            forceClose();
        }
    }

    /** Shut at once, without the pour back: for a panel that cannot draw, or never did. */
    private void forceClose() {
        open = false;
        wantOpen = false;
        detail = null;
        main.removeCallbacks(tick);
        main.removeCallbacks(holdOk);
        uncoverHome();
        setVisibility(GONE);
    }

    private final Runnable watchdog = () -> {
        if (open && drawnAt < openedAt) {
            android.util.Log.e("ControlCenter", "no frame after opening");
            forceClose();
        }
    };

    private void draw(Canvas c, int unused) {
        int save = c.save();
        c.scale(u, u);
        float o = clamp(bg.v, 0f, 1f), deep = clamp(rc.v, 0f, 1f);
        if (open && frozen != null && !frozen.isRecycled()) {
            c.drawBitmap(frozen, null, full, framePaint);
            frozenShown = true;
        }
        if (backdrop != null) {
            // The picture comes in already dark, in one pass: no second full-screen layer just to dim it.
            int level = Math.round(255f * (0.60f - 0.28f * deep));
            if (level != backLevel) {
                backLevel = level;
                backPaint.setColorFilter(new LightingColorFilter(Color.rgb(level, level, level), 0));
            }
            backPaint.setAlpha(Math.round(255f * o));
            c.drawRect(0f, 0f, 1280f, 720f, backPaint);
        } else {
            dimPaint.setAlpha(Math.round(255f * (0.40f * o + 0.28f * deep) * 0.85f));
            c.drawRect(0f, 0f, 1280f, 720f, dimPaint);
        }
        float glassDim = 0.34f + 0.26f * deep;
        // The room behind takes the colours of what is playing: one soft wash from behind the Now Playing tile.
        float tk = clamp(tintK.v, 0f, 1f);
        for (int i = 0; i < 3; i++) tint[i] = lerp(tintFrom[i], tintTo[i], tk);
        if (accentA != 0 && o > 0.01f) {
            if (washFor != accentA) {
                washFor = accentA;
                washPaint.setShader(new RadialGradient(596f, 252f, 820f,
                        new int[]{(accentA & 0x00FFFFFF) | 0x5C000000, (accentB & 0x00FFFFFF) | 0x1F000000, 0x00000000},
                        new float[]{0f, 0.5f, 1f}, Shader.TileMode.CLAMP));
            }
            washPaint.setAlpha(Math.round(255f * o * tk * (1f - 0.6f * deep)));
            c.drawRect(0f, 0f, 1280f, 720f, washPaint);
        }

        // the bar the tiles pour out of
        float ba = clamp(barA.v, 0f, 1f);
        if (ba > 0.003f) glass(c, barShader, barPaint, 640f, ISL_CY, Math.max(2f, barW.v), Math.max(2f, barH.v),
                Math.min(barW.v, barH.v) / 2f, 0f, 0f, ba, 0f, 0.22f, glassDim);

        for (Mod m : mods) {
            m.place();
            float vis = m.hide ? 0f : smooth(0f, 0.06f, m.p.v) * (1f - 0.62f * deep);
            if (vis <= 0.003f) continue;
            long since = SystemClock.uptimeMillis() - m.sheenAt;
            float sheen = since > 0 && since < 650 ? since / 650f : 0f;
            glass(c, m.shader, m.paint, m.cx, m.cy, m.cw, m.ch, m.cr, clamp(m.f.v, 0f, 1.2f) * (m.inner ? 0.45f : 1f),
                    clamp(m.pr.v, 0f, 1f), vis, sheen, 0.30f, glassDim);
        }
        drawPill(c, false);
        for (Mod m : mods) {
            boolean under = detail != null || cardClosing ? overlapsCard(m) : false;
            float a = clamp((m.p.v - 0.6f) / 0.32f, 0f, 1f) * m.vis.v * (1f - (under ? 1f : 0.75f) * deep);
            if (a <= 0.004f) continue;
            // The words and icons are a picture kept on the GPU, redrawn only when what they say changes; each frame
            // moves, scales and fades that picture (the render thread spent 15 ms a frame drawing them one by one).
            long now = stamp(m);
            if (now != m.stamp || !m.node.hasDisplayList()) {
                record(m);
                m.stamp = now;
            }
            float s = Math.min(m.cw / m.w, m.ch / m.h);
            int keep = c.save();
            c.translate(m.cx, m.cy);
            c.scale(s, s);
            c.translate(-m.tcx, -m.tcy);
            c.translate(m.x - m.padL, m.y - m.padT);
            c.scale(1f / u, 1f / u);
            m.node.setAlpha(a);
            c.drawRenderNode(m.node);
            c.restoreToCount(keep);
        }
        // the header and the hint ride on the backdrop
        float ha = smooth(0.35f, 1f, o) * (1f - 0.8f * deep);
        if (ha > 0.004f) header(c, ha, -14f * (1f - o));
        float hint = smooth(0.5f, 1f, o) * (1f - 0.7f * deep);
        if (hint > 0.004f) hint(c, hint);

        if (cardSrc != null || detail != null) drawCard(c, glassDim);
        drawToast(c, glassDim);
        c.restoreToCount(save);
    }

    /** The glass's own colour this frame: a dark neutral, or a dark shade of what is playing. */
    private final float[] tint = {0.085f, 0.088f, 0.11f};

    private void glass(Canvas c, RuntimeShader s, Paint p, float cx, float cy, float w, float h, float radius,
                       float focus, float flash, float alpha, float sheen, float tintAmount, float dim) {
        s.setFloatUniform("box", cx, cy, w / 2f, h / 2f);
        s.setFloatUniform("look", radius, focus, flash, alpha);
        s.setFloatUniform("more", sheen, tintAmount, dim, 1f / u);
        s.setFloatUniform("tintc", tint[0], tint[1], tint[2]);
        p.setShader(s);
        // The shadow and the focus glow reach this far outside the glass; past it they are too faint to see.
        float m = focus > 0.01f ? 24f : 16f;
        c.drawRect(cx - w / 2f - m, cy - h / 2f - m, cx + w / 2f + m, cy + h / 2f + m, p);
    }

    private void drawPill(Canvas c, boolean onCard) {
        if ((detail != null || cardClosing) != onCard) return;
        float a = clamp(pillA.v, 0f, 1f) * pillGate();
        if (a <= 0.003f) return;
        float fx = 0f, fy = 0f, tx = 0f, ty = 0f, s = 1f;
        if (onCard) {
            if (cardSrc == null) return;
            float[] cr = cardRect();
            s = Math.min(cr[2] / ctw, cr[3] / cth);
            fx = ctx;
            fy = cty;
            tx = cr[0];
            ty = cr[1];
        } else {
            Target t = tById.get(focus);
            Mod m = t != null ? byId.get(t.mod) : null;
            if (m == null) return;
            s = Math.min(m.cw / m.w, m.ch / m.h);
            fx = m.tcx;
            fy = m.tcy;
            tx = m.cx;
            ty = m.cy;
        }
        float press = pillP.v;
        float w = Math.max(2f, (pillW.v - 6f * press) * s), h = Math.max(2f, (pillH.v - 6f * press) * s);
        float cx = tx + (pillX.v - fx) * s, cy = ty + (pillY.v - fy) * s;
        pillShader.setFloatUniform("box", cx, cy, w / 2f, h / 2f);
        pillShader.setFloatUniform("look", Math.min(pillR * s, Math.min(w, h) / 2f), a, clamp(press, 0f, 1f), 1f / u);
        c.drawRect(cx - w / 2f - 2f, cy - h / 2f - 2f, cx + w / 2f + 2f, cy + h / 2f + 2f, pillPaint);
    }

    private float pillGate() {
        if (detail != null || cardClosing) return cardSrc != null && !cardClosing ? smooth(0.72f, 1f, cardP.v) : 0f;
        Target t = tById.get(focus);
        if (t == null || t.inner == null) return 0f;
        Mod m = byId.get(t.mod);
        return clamp((m.p.v - 0.6f) / 0.32f, 0f, 1f) * (1f - rc.v);
    }

    private float[] cardRect() {
        float k = cardP.v;
        return new float[]{lerp(csx, ctx, k), lerp(csy, cty, k), Math.max(2f, lerp(csw, ctw, k)),
                Math.max(2f, lerp(csh, cth, k)), lerp(csr, 34f, clamp(k, 0f, 1f))};
    }

    private boolean overlapsCard(Mod m) {
        return m.x < ctx + ctw / 2f + 8f && m.x + m.w > ctx - ctw / 2f - 8f && m.y < cty + cth / 2f + 8f && m.y + m.h > cty - cth / 2f - 8f;
    }

    private void drawCard(Canvas c, float dim) {
        if (cardSrc == null) return;
        float[] cr = cardRect();
        float a = clamp(cardA.v, 0f, 1f);
        glass(c, cardShader, cardPaint, cr[0], cr[1], cr[2], cr[3], cr[4], 0.25f, 0f, a, 0f,
                lerp(0.30f, 0.40f, clamp(cardP.v, 0f, 1f)), dim);
        drawPill(c, true);
        float ca = smooth(0.55f, 0.92f, cardP.v) * a * (cardClosing ? smooth(0.2f, 0.9f, cardP.v) : 1f);
        if (ca <= 0.004f || lastDetail == null) return;
        float s = Math.min(cr[2] / ctw, cr[3] / cth);
        int keep = c.save();
        c.translate(cr[0], cr[1]);
        c.scale(s, s);
        c.translate(-ctx, -cty);
        detailContent(c, lastDetail, ca);
        c.restoreToCount(keep);
    }

    private void drawToast(Canvas c, float dim) {
        float a = clamp(toastA.v, 0f, 1f);
        if (a <= 0.003f) return;
        float w = Math.max(2f, toastW.v), h = 40f;
        glass(c, toastShader, toastPaint, 640f, ISL_CY, w, h, h / 2f, 0f, 0f, a, 0f, 0.26f, dim);
        float ta = clamp(toastT.v, 0f, 1f) * smooth(0.6f, 1f, a);
        if (ta <= 0.004f) return;
        float tw = chipText.measureText(toastText), iw = toastIcon != 0 ? 26f : 0f;
        float x = 640f - (tw + iw) / 2f;
        if (toastIcon != 0) drawIcon(c, toastIcon, x + 9f, ISL_CY, 18f, 0xFF64D2FF, ta);
        drawText(c, toastText, x + iw, ISL_CY + 5.5f, chipText, ta);
    }

    // ---------------------------------------------------------------- what each tile shows

    /** The tile's words and icons into its own GPU layer, at the screen's real pixel size. */
    private void record(Mod m) {
        int w = Math.round((m.w + m.padL + m.padR) * u), h = Math.round((m.h + m.padT + m.padB) * u);
        m.node.setPosition(0, 0, w, h);
        RecordingCanvas rec = m.node.beginRecording(w, h);
        try {
            rec.scale(u, u);
            rec.translate(-(m.x - m.padL), -(m.y - m.padT));
            content(rec, m, 1f);
        } finally {
            m.node.endRecording();
        }
    }

    /** Everything a tile's words and icons depend on, folded into one number: a change redraws its layer. */
    private long stamp(Mod m) {
        long h = 17;
        switch (m.id) {
            case "orbit":
                h = mix(h, orbitOn ? 1 : 0, orbitLine.hashCode());
                break;
            case "wifi":
                h = mix(h, wifiOn ? 1 : 0, wifiLine.hashCode());
                break;
            case "bt":
                h = mix(h, btOn ? 1 : 0, btLine.hashCode());
                break;
            case "np":
                h = mix(h, npTitle.hashCode(), npSub.hashCode());
                h = mix(h, npApp.hashCode(), npPos / 1000L);
                h = mix(h, npDur, playing ? 1 : 0);
                h = mix(h, focus.hashCode(), art != null ? System.identityHashCode(art) : 0);
                break;
            case "display":
                h = mix(h, Math.round(light.v * 4f), lightPct);
                h = mix(h, "display".equals(focus) ? 1 : 0, 0);
                break;
            case "sound":
                h = mix(h, Math.round(volume.v * 4f), volPct);
                h = mix(h, muted ? 1 : 0, outputName.hashCode());
                h = mix(h, "sound".equals(focus) ? 1 : 0, 0);
                break;
            case "scenes":
                h = mix(h, scene, 0);
                break;
            case "notes":
                h = mix(h, notesNow.size(), notesNow.isEmpty() ? 0 : notesNow.get(0).at);
                h = mix(h, cricket == null ? 0 : cricket[0].hashCode(), cricket == null ? 0 : cricket[1].hashCode());
                break;
            case "quiet":
                h = mix(h, TvIsland.quiet ? 1 : 0, 0);
                break;
            case "sleep":
                long left = service.ccSleepLeftMs();
                h = mix(h, left > 0 ? 1 : 0, (left + 59_999L) / 60_000L);
                break;
            default:
                break;
        }
        return h;
    }

    private static long mix(long h, long a, long b) {
        return (h * 31L + a) * 31L + b;
    }

    private void content(Canvas c, Mod m, float a) {
        switch (m.id) {
            case "orbit": {
                drawIcon(c, R.drawable.cc_phone, m.x + 26f, m.tcy, 20f, 0xFFFFFFFF, a);
                drawText(c, "Orbit", m.x + 44f, m.tcy + 5.5f, chipText, a);
                fill.setColor(orbitOn ? 0xFF30D158 : 0xFF8E8E93);
                fill.setAlpha(Math.round(255f * a));
                c.drawCircle(m.x + 100f, m.tcy, 4f, fill);
                drawText(c, orbitLine, m.x + 112f, m.tcy + 5f, sub, a);
                break;
            }
            case "settings":
                drawIcon(c, R.drawable.cc_gear, m.tcx, m.tcy, 22f, 0xFFFFFFFF, a);
                break;
            case "power":
                drawIcon(c, R.drawable.cc_power, m.tcx, m.tcy, 22f, 0xFFFFFFFF, a);
                break;
            case "close":
                drawIcon(c, R.drawable.cc_close, m.tcx, m.tcy, 22f, 0xFFFFFFFF, a);
                break;
            case "wifi":
                capsule(c, m, R.drawable.cc_wifi, "Wi-Fi", wifiLine, 0xFF30D158, wifiOn, a);
                break;
            case "bt":
                capsule(c, m, R.drawable.cc_bt, "Bluetooth", btLine, 0xFF0A84FF, btOn, a);
                break;
            case "cast":
                capsule(c, m, R.drawable.cc_cast, "Cast", "Ready as Family room", 0xFF0FA3B1, true, a);
                break;
            case "np":
                nowPlaying(c, m, a);
                break;
            case "display":
                slider(c, m, "Display", R.drawable.cc_sun_s, clamp(light.v, 0f, 100f), String.valueOf(lightPct), a);
                break;
            case "sound":
                slider(c, m, "Sound", muted ? R.drawable.cc_muted : R.drawable.cc_speaker, clamp(volume.v, 0f, 100f),
                        muted ? "Muted" : String.valueOf(volPct), a);
                break;
            case "scenes":
                scenes(c, m, a);
                break;
            case "notes":
                notes(c, m, a);
                break;
            default:
                round(c, m, a);
        }
    }

    private void capsule(Canvas c, Mod m, int icon, String name, String line, int color, boolean on, float a) {
        float cx = m.x + 36f, cy = m.tcy;
        fill.setColor(on ? 0xFFFFFFFF : 0x26FFFFFF);
        fill.setAlpha(Math.round((on ? 255f : 38f) * a));
        c.drawCircle(cx, cy, 24f, fill);
        drawIcon(c, icon, cx, cy, 24f, on ? color : 0xFFFFFFFF, a);
        drawText(c, name, m.x + 74f, cy - 3f, title, a);
        drawText(c, ellipsize(line, sub, 224f), m.x + 74f, cy + 18f, sub, a);
    }

    private void round(Canvas c, Mod m, float a) {
        boolean on = ("quiet".equals(m.id) && TvIsland.quiet) || ("sleep".equals(m.id) && service.ccSleepLeftMs() > 0L);
        if (on) {
            fill.setColor(0xFFFFFFFF);
            fill.setAlpha(Math.round(255f * a));
            c.drawCircle(m.tcx, m.tcy, 36f, fill);
        }
        drawIcon(c, m.icon, m.tcx, m.tcy, 28f, on ? m.color : 0xFFFFFFFF, a);
        String text = m.label;
        if ("sleep".equals(m.id) && on) text = "Sleep · " + Math.max(1L, (service.ccSleepLeftMs() + 59_999L) / 60_000L) + " min";
        label.setTextAlign(Paint.Align.CENTER);
        drawText(c, text, m.tcx, m.y + m.h + 25f, label, a);
        label.setTextAlign(Paint.Align.LEFT);
    }

    private void nowPlaying(Canvas c, Mod m, float a) {
        float ax = m.x + 20f, ay = m.y + 20f;
        r.set(ax, ay, ax + 80f, ay + 80f);
        if (art != null && !art.isRecycled()) {
            if (artFor != art) {
                // Made once per cover, not per frame.
                artFor = art;
                artShader = new BitmapShader(art, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
                Matrix mx = new Matrix();
                float sc = Math.max(80f / art.getWidth(), 80f / art.getHeight());
                mx.setScale(sc, sc);
                mx.postTranslate(ax + 40f - art.getWidth() * sc / 2f, ay + 40f - art.getHeight() * sc / 2f);
                artShader.setLocalMatrix(mx);
            }
            artPaint.setShader(artShader);
        } else {
            if (warm == null) warm = new RadialGradient(ax + 18f, ay + 12f, 110f, new int[]{0xFFFFC46B, 0xFFFF7A3D, 0xFFC8173F, 0xFF4C0A2B},
                    new float[]{0f, 0.34f, 0.68f, 1f}, Shader.TileMode.CLAMP);
            artPaint.setShader(warm);
        }
        artPaint.setAlpha(Math.round(255f * a));
        c.drawRoundRect(r, 18f, 18f, artPaint);
        if (art == null) drawIcon(c, R.drawable.cc_note, ax + 40f, ay + 40f, 32f, 0xF0FFFFFF, a);
        float tx = m.x + 116f;
        fill.setColor(0xFFFF3B30);
        fill.setAlpha(Math.round(255f * a));
        c.drawCircle(tx + 5f, m.y + 30f, 4f, fill);
        drawText(c, npApp.isEmpty() ? "Now playing" : npApp, tx + 16f, m.y + 34.5f, caps, a);
        if (!npTitle.equals(titleFor)) {
            titleFor = npTitle;
            titleLines = wrap(npTitle, big, 244f, 2);
        }
        String[] lines = titleLines;
        for (int i = 0; i < lines.length; i++) drawText(c, lines[i], tx, m.y + 62f + i * 23f, big, a);
        drawText(c, ellipsize(npSub, sub, 244f), tx, m.y + 64f + lines.length * 23f, sub, a);
        // progress
        float bx = m.x + 24f, bw = m.w - 48f, by = m.y + 134f;
        fill.setColor(0x2EFFFFFF);
        fill.setAlpha(Math.round(46f * a));
        r.set(bx, by, bx + bw, by + 5f);
        c.drawRoundRect(r, 2.5f, 2.5f, fill);
        float done = npDur > 0 ? clamp(npPos / (float) npDur, 0f, 1f) : 0f;
        if (done > 0f) {
            fill.setColor(0xFFFFFFFF);
            fill.setAlpha(Math.round(255f * a));
            r.set(bx, by, bx + bw * done, by + 5f);
            c.drawRoundRect(r, 2.5f, 2.5f, fill);
        }
        if (npDur <= 0 && LIVE_TV.equals(mediaPkg)) {
            // A channel has no length: say it is live instead of an empty line with no times.
            int keep = small.getColor();
            small.setColor(0xFFFF6B81);
            drawText(c, "\u25CF LIVE", bx, by + 22f, small, a);
            small.setColor(keep);
        }
        if (npDur > 0) {
            drawText(c, time(npPos), bx, by + 22f, small, a);
            small.setTextAlign(Paint.Align.RIGHT);
            drawText(c, time(npDur), bx + bw, by + 22f, small, a);
            // when it will be over, by the clock on the wall
            long rest = Math.max(0L, npDur - npPos);
            if (rest > 30_000L) {
                small.setTextAlign(Paint.Align.CENTER);
                drawText(c, "Ends " + clockOf(System.currentTimeMillis() + rest), bx + bw / 2f, by + 22f, small, a);
            }
            small.setTextAlign(Paint.Align.LEFT);
        }
        // buttons
        float cy = m.y + 198f;
        buttonGlyph(c, R.drawable.cc_back10, m.x + 56f, cy, 26f, a, "np-b10", true);
        buttonGlyph(c, R.drawable.cc_prev, m.x + 124f, cy, 24f, a, "np-prev", false);
        buttonGlyph(c, playing ? R.drawable.cc_pause : R.drawable.cc_play, m.x + 192f, cy, 30f, a, "np-play", false);
        buttonGlyph(c, R.drawable.cc_next, m.x + 260f, cy, 24f, a, "np-next", false);
        buttonGlyph(c, R.drawable.cc_fwd10, m.x + 328f, cy, 26f, a, "np-f10", true);
    }

    private void buttonGlyph(Canvas c, int icon, float cx, float cy, float size, float a, String id, boolean ten) {
        boolean f = id.equals(focus);
        float s = f ? 1.1f : 1f;
        drawIcon(c, icon, cx, cy, size * s, f ? 0xFFFFFFFF : 0xDBFFFFFF, a);
        if (ten) {
            tenText.setTextSize(7f * s * size / 24f * 1.05f);
            tenText.setTextAlign(Paint.Align.CENTER);
            drawText(c, "10", cx + (icon == R.drawable.cc_back10 ? 0.4f : -0.4f) * s, cy + 3f * s, tenText, a);
        }
    }

    private void slider(Canvas c, Mod m, String name, int icon, float value, String valueText, float a) {
        boolean f = m.id.equals(focus);
        float cy = m.tcy;
        drawText(c, name, m.x + 26f, cy + 5.5f, title, a);
        drawIcon(c, icon, m.x + 118f, cy, 20f, 0xADFFFFFF, a);
        float left = m.x + 146f, right = "sound".equals(m.id) ? m.x + m.w - 332f : m.x + m.w - 150f;
        float hh = f ? 16f : 10f;
        r.set(left, cy - hh / 2f, right, cy + hh / 2f);
        fill.setColor(0x29FFFFFF);
        fill.setAlpha(Math.round(41f * a));
        c.drawRoundRect(r, hh / 2f, hh / 2f, fill);
        float wv = (right - left) * clamp(value / 100f, 0f, 1f);
        if (wv > 0.5f) {
            r.set(left, cy - hh / 2f, left + Math.max(hh, wv), cy + hh / 2f);
            fill.setColor(0xFFFFFFFF);
            fill.setAlpha(Math.round(255f * a));
            c.drawRoundRect(r, hh / 2f, hh / 2f, fill);
        }
        sub.setTextAlign(Paint.Align.RIGHT);
        drawText(c, valueText, "sound".equals(m.id) ? m.x + m.w - 262f : m.x + m.w - 84f, cy + 5f, sub, a);
        sub.setTextAlign(Paint.Align.LEFT);
        if ("sound".equals(m.id)) {
            String out = outputName;
            float tw = chipText.measureText(out);
            float rx = m.x + m.w - 14f, lx = rx - tw - 54f;
            r.set(lx, cy - 20f, rx, cy + 20f);
            fill.setColor(0x1AFFFFFF);
            fill.setAlpha(Math.round(26f * a));
            c.drawRoundRect(r, 20f, 20f, fill);
            int oi = out.startsWith("Head") ? R.drawable.cc_headphones : out.startsWith("Sound") ? R.drawable.cc_soundbar : R.drawable.cc_speaker;
            drawIcon(c, oi, lx + 22f, cy, 18f, 0xFFFFFFFF, a);
            drawText(c, out, lx + 40f, cy + 5.5f, chipText, a);
        } else {
            drawIcon(c, R.drawable.cc_sun_l, m.x + m.w - 40f, cy, 24f, 0xFFFFFFFF, a);
        }
    }

    private void scenes(Canvas c, Mod m, float a) {
        drawText(c, "SCENES", m.x + 20f, m.y + 26f, caps, a);
        for (int i = 0; i < SCENES.length; i++) {
            float x = m.x + 16f + i * 180f, y = m.y + 40f;
            boolean on = scene == i;
            r.set(x, y, x + 168f, y + 48f);
            fill.setColor(on ? 0xFFFFFFFF : 0x14FFFFFF);
            fill.setAlpha(Math.round((on ? 255f : 20f) * a));
            c.drawRoundRect(r, 24f, 24f, fill);
            float tw = chipText.measureText(SCENES[i]);
            float x0 = x + 84f - (tw + 31f) / 2f;
            drawIcon(c, SCENE_ICONS[i], x0 + 11f, y + 24f, 22f, on ? 0xFFC2410C : 0xFFFFD60A, a);
            int keep = chipText.getColor();
            chipText.setColor(on ? 0xFF16161B : 0xFFFFFFFF);
            drawText(c, SCENES[i], x0 + 31f, y + 29.5f, chipText, a);
            chipText.setColor(keep);
        }
    }

    private void notes(Canvas c, Mod m, float a) {
        List<TvIsland.Note> list = notesNow;
        drawIcon(c, R.drawable.cc_bell, m.x + 27f, m.y + 22f, 15f, 0x75FFFFFF, a);
        drawText(c, "NOTIFICATIONS", m.x + 42f, m.y + 26f, caps, a);
        if (!list.isEmpty()) {
            String n = String.valueOf(list.size());
            float bw = Math.max(20f, caps.measureText(n) + 12f), bx = m.x + 42f + caps.measureText("NOTIFICATIONS") + 10f;
            r.set(bx, m.y + 12f, bx + bw, m.y + 32f);
            fill.setColor(0xFFFF375F);
            fill.setAlpha(Math.round(255f * a));
            c.drawRoundRect(r, 10f, 10f, fill);
            int keep = caps.getColor();
            caps.setColor(0xFFFFFFFF);
            caps.setTextAlign(Paint.Align.CENTER);
            drawText(c, n, bx + bw / 2f, m.y + 26.5f, caps, a);
            caps.setTextAlign(Paint.Align.LEFT);
            caps.setColor(keep);
        }
        // India playing: the score is the first line, ahead of everything else
        String[] score = cricket;
        int first = 0;
        if (score != null) {
            float y = m.y + 58f;
            drawIcon(c, R.drawable.cc_bat, m.x + 28f, y, 16f, 0xFF4F8BFF, a);
            drawText(c, ellipsize(score[0], chipText, 300f), m.x + 46f, y + 5f, chipText, a);
            small.setTextAlign(Paint.Align.RIGHT);
            drawText(c, ellipsize(score[1], small, 170f), m.x + m.w - 20f, y + 4.5f, small, a);
            small.setTextAlign(Paint.Align.LEFT);
            first = 1;
        }
        if (list.isEmpty() && score == null) {
            drawIcon(c, R.drawable.cc_check, m.x + 28f, m.y + 58f, 16f, 0x75FFFFFF, a);
            drawText(c, "You are all caught up", m.x + 46f, m.y + 63f, sub, a);
            return;
        }
        for (int i = 0; i < Math.min(2 - first, list.size()); i++) {
            TvIsland.Note note = list.get(i);
            float y = m.y + 58f + (i + first) * 30f;
            drawIcon(c, R.drawable.cc_sparkle, m.x + 28f, y, 16f, 0xFF64D2FF, a);
            drawText(c, ellipsize(note.title, chipText, 380f), m.x + 46f, y + 5f, chipText, a);
            small.setTextAlign(Paint.Align.RIGHT);
            drawText(c, clockOf(note.at), m.x + m.w - 20f, y + 4.5f, small, a);
            small.setTextAlign(Paint.Align.LEFT);
        }
    }

    private void header(Canvas c, float a, float dy) {
        float y = 92f + dy;
        drawText(c, clockText, 72f, y, clock, a);
        float w = clockWidth;
        drawText(c, ampmText, 72f + w + 6f, y, ampm, a);
        drawText(c, dateText, 72f + w + 60f, y - 26f, title, a);
        drawText(c, weatherText, 72f + w + 60f, y - 4f, sub, a);
    }

    private float clockWidth;
    private String weatherText = "";

    private void readClock() {
        Calendar now = Calendar.getInstance();
        int h = now.get(Calendar.HOUR);
        clockText = (h == 0 ? 12 : h) + ":" + String.format(Locale.ROOT, "%02d", now.get(Calendar.MINUTE));
        clockWidth = clock.measureText(clockText);
        ampmText = now.get(Calendar.AM_PM) == Calendar.PM ? "pm" : "am";
        dateText = String.format(Locale.ENGLISH, "%tA, %<te %<tB", now);
        weatherText = service.ccWeatherLine();
    }

    private void hint(Canvas c, float a) {
        String[][] parts = {{"OK", "Select"}, {"Hold OK", "More"}, {"Back", "Close"}};
        float total = 0f;
        for (String[] p : parts) total += caps.measureText(p[0]) + 16f + 8f + sub.measureText(p[1]) + 28f;
        float x = 640f - (total - 28f) / 2f, y = 684f;
        for (String[] p : parts) {
            float kw = caps.measureText(p[0]) + 16f;
            r.set(x, y - 16f, x + kw, y + 6f);
            fill.setColor(0x1AFFFFFF);
            fill.setAlpha(Math.round(26f * a));
            c.drawRoundRect(r, 7f, 7f, fill);
            drawText(c, p[0], x + 8f, y - 0.5f, caps, a);
            drawText(c, p[1], x + kw + 8f, y, small, a);
            x += kw + 8f + sub.measureText(p[1]) + 28f;
        }
    }

    // ---------------------------------------------------------------- the detail card

    private Detail lastDetail;

    private void detailContent(Canvas c, Detail d, float a) {
        float left = ctx - ctw / 2f, top = cty - cth / 2f;
        float cx = left + 22f + 26f, cy = top + 20f + 26f;
        fill.setColor(0xFFFFFFFF);
        fill.setAlpha(Math.round(255f * a));
        c.drawCircle(cx, cy, 26f, fill);
        drawIcon(c, d.icon, cx, cy, 26f, d.color, a);
        drawText(c, ellipsize(d.title, head, ctw - 120f), left + 88f, cy - 2f, head, a);
        drawText(c, ellipsize(d.sub, sub, ctw - 120f), left + 88f, cy + 20f, sub, a);
        if (d.custom == LYRICS) {
            drawLyrics(c, left, top, a);
            return;
        }
        if (d.custom == PHONE) {
            drawPhone(c, left, top, a);
            return;
        }
        for (int i = 0; i < d.items.size(); i++) {
            Item it = d.items.get(i);
            float iy = top + 88f + i * 54f, mid = iy + 25f, x = left + 28f;
            if (it.icon != 0) drawIcon(c, it.icon, x + 13f, mid, 22f, it.type == NOTE ? 0xFF64D2FF : 0xADFFFFFF, a);
            float tx = it.icon != 0 ? x + 40f : x;
            float maxW = ctw - (tx - left) - 90f;
            if (it.type == INFO) {
                drawText(c, ellipsize(it.label, sub, ctw - 56f), x, mid + 5f, sub, a);
                continue;
            }
            boolean two = it.sub != null && !it.sub.isEmpty();
            drawText(c, ellipsize(it.label, item, maxW), tx, two ? mid - 2f : mid + 6f, item, a);
            if (two) drawText(c, ellipsize(it.sub, small, maxW), tx, mid + 16f, small, a);
            float rx = left + ctw - 28f;
            if (it.type == RADIO && it.on) {
                fill.setColor(0xFF0A84FF);
                fill.setAlpha(Math.round(255f * a));
                c.drawCircle(rx - 13f, mid, 13f, fill);
                drawIcon(c, R.drawable.cc_check, rx - 13f, mid, 16f, 0xFFFFFFFF, a);
            } else if (it.type == TOGGLE) {
                r.set(rx - 46f, mid - 14f, rx, mid + 14f);
                fill.setColor(it.on ? 0xFF30D158 : 0x33FFFFFF);
                fill.setAlpha(Math.round((it.on ? 255f : 51f) * a));
                c.drawRoundRect(r, 14f, 14f, fill);
                fill.setColor(0xFFFFFFFF);
                fill.setAlpha(Math.round(255f * a));
                c.drawCircle(it.on ? rx - 14f : rx - 32f, mid, 11f, fill);
            } else if (it.type == ACTION) {
                drawIcon(c, R.drawable.cc_chev, rx - 9f, mid, 18f, 0x75FFFFFF, a);
            } else if (it.type == CYCLE && it.values != null) {
                // the value as a small glass pill, so it reads as something OK changes
                String v = it.values[it.index];
                float vw = chipText.measureText(v) + 28f;
                r.set(rx - vw, mid - 16f, rx, mid + 16f);
                fill.setColor(0x1FFFFFFF);
                fill.setAlpha(Math.round(31f * a));
                c.drawRoundRect(r, 16f, 16f, fill);
                chipText.setTextAlign(Paint.Align.CENTER);
                drawText(c, v, rx - vw / 2f, mid + 5.5f, chipText, a);
                chipText.setTextAlign(Paint.Align.LEFT);
            } else if (it.type == NOTE && it.right != null) {
                small.setTextAlign(Paint.Align.RIGHT);
                drawText(c, it.right, rx, mid + 4f, small, a);
                small.setTextAlign(Paint.Align.LEFT);
            }
        }
    }

    /** Where a card stands when open: centred, its height from its items, or its own size for a drawn card. */
    private void cardTarget(Detail d) {
        float h = d.h > 0f ? d.h : 88f + d.items.size() * 54f + 14f, w = d.w;
        float top = Math.round(Math.max(96f, 372f - h / 2f));
        ctx = 640f;
        cty = top + h / 2f;
        ctw = w;
        cth = h;
    }

    /** From one card straight to another (Now playing → Lyrics): the glass reshapes, the source tile stays hidden. */
    private void switchDetail(String kind) {
        Detail old = detail;
        if (old == null) return;
        Detail d = makeDetail(kind, old.from);
        if (d == null) return;
        float[] cr = cardRect();
        csx = cr[0];
        csy = cr[1];
        csw = cr[2];
        csh = cr[3];
        csr = cr[4];
        cardTarget(d);
        cardP.snap(0f).to(1f, 300f, 28f);
        detail = d;
        lastDetail = d;
        afterOpen(d);
        wake();
    }

    private void openDetail(String kind) {
        if (!open || detail != null) return;
        Target t = tById.get(focus);
        Mod m = byId.get(t.mod);
        Detail d = makeDetail(kind, t.id);
        if (d == null) return;
        csx = m.cx;
        csy = m.cy;
        csw = m.cw;
        csh = m.ch;
        csr = m.cr;
        cardTarget(d);
        cardSrc = m;
        cardClosing = false;
        cardP.snap(0f).to(1f, 270f, 26f);
        cardA.snap(1f);
        m.hide = true;
        m.vis.snap(0f);
        m.pr.snap(0f);
        rc.to(1f, 260f, 30f);
        detail = d;
        lastDetail = d;
        afterOpen(d);
        wake();
    }

    /** The focus on the chosen item (or the first that can take it), and the card's own work for drawn cards. */
    private void afterOpen(Detail d) {
        int first = -1;
        for (int i = 0; i < d.items.size(); i++) {
            Item it = d.items.get(i);
            if (!it.focusable()) continue;
            if (first < 0) first = i;
            if (it.type == RADIO && it.on) {
                first = i;
                break;
            }
        }
        d.focus = first;
        if (first >= 0) focusItem(first, true);
        else pillA.to(0f);
        if (d.custom == LYRICS) startLyrics();
        if (d.custom == PHONE) makeQr();
    }

    private void closeDetail(boolean fast) {
        Detail d = detail;
        if (d == null) return;
        Mod m = cardSrc;
        if (m != null) {
            m.place();
            csx = m.cx;
            csy = m.cy;
            csw = m.cw;
            csh = m.ch;
            csr = m.cr;
        }
        cardClosing = true;
        cardP.to(0f, fast ? 520f : 380f, fast ? 46f : 38f);
        rc.to(0f, 260f, 30f);
        detail = null;
        setFocus(d.from, true);
        wake();
    }

    private void focusItem(int i, boolean snap) {
        Detail d = detail;
        if (d == null || i < 0) return;
        d.focus = i;
        float top = cty - cth / 2f;
        placePill(ctx, top + 88f + i * 54f + 25f, ctw - 24f, 50f, 16f, snap);
        pillA.to(1f, 420f, 36f);
        wake();
    }

    private void moveItem(int step) {
        Detail d = detail;
        for (int i = d.focus + step; i >= 0 && i < d.items.size(); i += step) {
            if (d.items.get(i).focusable()) {
                focusItem(i, false);
                return;
            }
        }
        pillY.kick(step * 160f);
        wake();
    }

    private void chooseItem() {
        Detail d = detail;
        if (d == null || d.focus < 0) return;
        Item it = d.items.get(d.focus);
        pillP.to(0f);
        pillP.kick(9f);
        if (it.type == RADIO) {
            for (Item other : d.items) if (other.type == RADIO) other.on = other == it;
        } else if (it.type == TOGGLE) {
            it.on = !it.on;
        } else if (it.type == CYCLE && it.values != null) {
            it.index = (it.index + 1) % it.values.length;
        }
        if (it.act != null) it.act.run();
        wake();
    }

    private static Item cycle(int icon, String label, String sub, String[] values, int index) {
        Item it = new Item(CYCLE, icon, label, sub);
        it.values = values;
        it.index = Math.max(0, Math.min(values.length - 1, index));
        return it;
    }

    private Detail makeDetail(String kind, String from) {
        Detail d;
        switch (kind) {
            case "wifi": {
                d = new Detail(kind, R.drawable.cc_wifi, 0xFF30D158, "Wi-Fi", wifiOn ? "Connected" : "Not connected", from);
                for (String[] line : wifiDetails()) d.items.add(new Item(INFO, 0, line[0] + "   " + line[1], null));
                Item settings = new Item(ACTION, R.drawable.cc_gear, "Wi-Fi settings", "Join another network");
                settings.act = () -> closeThen(() -> service.ccOpen(SystemSettings.intent(service, Settings.ACTION_WIFI_SETTINGS)));
                d.items.add(settings);
                return d;
            }
            case "bt": {
                d = new Detail(kind, R.drawable.cc_bt, 0xFF0A84FF, "Bluetooth", btOn ? "On · visible as Family room" : "Off", from);
                for (String[] dev : bluetoothDevices()) {
                    Item it = new Item(ACTION, iconFor(dev[2]), dev[0], dev[1]);
                    it.act = () -> closeThen(() -> service.ccOpen(SystemSettings.intent(service, Settings.ACTION_BLUETOOTH_SETTINGS)));
                    d.items.add(it);
                }
                Item pair = new Item(ACTION, R.drawable.cc_plus, "Pair a new device", "Remotes and accessories");
                pair.act = () -> closeThen(() -> service.ccOpen(SystemSettings.intent(service, Settings.ACTION_BLUETOOTH_SETTINGS)));
                d.items.add(pair);
                return d;
            }
            case "cast": {
                d = new Detail(kind, R.drawable.cc_cast, 0xFF0FA3B1, "Cast to this TV", "Ready as Family room", from);
                d.items.add(new Item(INFO, 0, "On your phone, open Screen Cast and choose Family room.", null));
                Item go = new Item(ACTION, R.drawable.cc_cast, "Open Miracast", "Show your phone's screen here");
                go.act = () -> closeThen(() -> {
                    Intent i = AppSwitcher.launchIntent(service, CAST_APP);
                    if (i != null) service.ccOpen(i);
                });
                d.items.add(go);
                return d;
            }
            case "inputs": {
                d = new Detail(kind, R.drawable.cc_inputs, 0xFFFF9F0A, "Inputs", "Google TV", from);
                Item home = new Item(RADIO, R.drawable.cc_tv, "Google TV", "Home screen");
                home.on = true;
                home.act = () -> closeThen(service::ccHome);
                d.items.add(home);
                for (String[] in : inputs()) {
                    Item it = new Item(RADIO, R.drawable.cc_inputs, in[0], in[1]);
                    final String id = in[2];
                    it.act = () -> closeThen(() -> service.ccOpenInput(id));
                    d.items.add(it);
                    if (d.items.size() >= 7) break;
                }
                return d;
            }
            case "sleep": {
                long left = service.ccSleepLeftMs();
                d = new Detail(kind, R.drawable.cc_timer, 0xFFFF9F0A, "Sleep timer",
                        left > 0 ? "The TV sleeps in " + Math.max(1L, (left + 59_999L) / 60_000L) + " min" : "Off", from);
                int[] minutes = {0, 15, 30, 60, 90};
                int chosen = service.ccSleepChosen();
                for (int mins : minutes) {
                    Item it = new Item(RADIO, R.drawable.cc_timer, mins == 0 ? "Off" : mins + " minutes", null);
                    it.on = mins == chosen && !service.ccSleepAtEnd();
                    it.act = () -> {
                        service.ccSleepIn(mins);
                        if (detail != null) detail.sub = mins == 0 ? "Off" : "The TV sleeps in " + mins + " min";
                        toast(mins == 0 ? "Sleep timer off" : "The TV sleeps in " + mins + " minutes", R.drawable.cc_timer);
                    };
                    d.items.add(it);
                }
                // A video with a length: the TV sleeps right after it, not at a round number of minutes.
                long rest = remainingMs();
                if (rest > 60_000L) {
                    String at = clockOf(System.currentTimeMillis() + rest);
                    Item end = new Item(RADIO, R.drawable.cc_moon, "When this ends", "At " + at + ", after " + ellipsize(npTitle, small, 300f));
                    end.on = service.ccSleepAtEnd();
                    end.act = () -> {
                        long untilEnd = remainingMs();
                        service.ccSleepAfterMs(untilEnd + 20_000L);
                        if (detail != null) detail.sub = "The TV sleeps when this ends";
                        toast("The TV sleeps when this ends, at " + clockOf(System.currentTimeMillis() + untilEnd), R.drawable.cc_moon);
                    };
                    d.items.add(1, end);
                }
                return d;
            }
            case "outputs": {
                String now = service.ccOutput();
                d = new Detail(kind, R.drawable.cc_speaker, 0xFF0FA3B1, "Sound plays on", now, from);
                for (String[] out : service.ccOutputs()) {
                    Item it = new Item(RADIO, iconFor(out[1]), out[0], out[2]);
                    it.on = out[0].equals(now);
                    it.act = () -> toast("Change it in Sound settings", R.drawable.cc_gear);
                    d.items.add(it);
                }
                Item memory = new Item(TOGGLE, R.drawable.cc_speaker, "Remember each app's volume", "Netflix loud, YouTube soft: each comes back as you left it");
                memory.on = service.ccAppVolume();
                memory.act = () -> {
                    service.ccSetAppVolume(memory.on);
                    toast(memory.on ? "Each app keeps its own volume" : "One volume for every app", R.drawable.cc_speaker);
                };
                d.items.add(memory);
                Item s = new Item(ACTION, R.drawable.cc_gear, "Sound settings", "Speakers, soundbar, headphones");
                s.act = () -> closeThen(() -> service.ccOpen(SystemSettings.intent(service, Settings.ACTION_SOUND_SETTINGS)));
                d.items.add(s);
                return d;
            }
            case "nowplaying": {
                d = new Detail(kind, R.drawable.cc_note, accentA != 0 ? accentA : 0xFFFF3B30, npTitle,
                        npApp.isEmpty() ? "Nothing is playing" : npApp + (remainingMs() > 0 ? " · ends " + clockOf(System.currentTimeMillis() + remainingMs()) : ""), from);
                if (mediaPkg != null) {
                    Item openApp = new Item(ACTION, R.drawable.cc_tv, "Open " + (npApp.isEmpty() ? "the app" : npApp), "Back to it, full screen");
                    openApp.act = this::openPlayingApp;
                    d.items.add(openApp);
                }
                Item words = new Item(ACTION, R.drawable.cc_note, "Lyrics", "The words on screen, in time with the song");
                words.act = () -> switchDetail("lyrics");
                d.items.add(words);
                Item phone = new Item(ACTION, R.drawable.cc_phone, "Continue on your phone", "Scan a code: it opens there, from here");
                phone.act = () -> switchDetail("phone");
                d.items.add(phone);
                String[] pauses = {"Off", "15 min", "30 min", "60 min"};
                int[] pauseMins = {0, 15, 30, 60};
                int pi = 0;
                for (int i = 0; i < pauseMins.length; i++) if (pauseMins[i] == service.ccPauseChosen()) pi = i;
                Item pause = cycle(R.drawable.cc_timer, "Pause the video after", "The TV stays on; only the video stops", pauses, pi);
                pause.act = () -> {
                    int mins = pauseMins[pause.index];
                    service.ccPauseIn(mins);
                    toast(mins == 0 ? "Pause timer off" : "The video pauses in " + mins + " minutes", R.drawable.cc_timer);
                };
                d.items.add(pause);
                if (speedOk) {
                    String[] speeds = {"0.75×", "1×", "1.25×", "1.5×", "2×"};
                    float[] values = {0.75f, 1f, 1.25f, 1.5f, 2f};
                    int si = 1;
                    for (int i = 0; i < values.length; i++) if (Math.abs(values[i] - speedNow) < 0.01f) si = i;
                    Item speed = cycle(R.drawable.cc_sparkle, "Speed", "Faster or slower, same pitch", speeds, si);
                    speed.act = () -> {
                        setSpeed(values[speed.index]);
                        toast("Speed " + speeds[speed.index], R.drawable.cc_sparkle);
                    };
                    d.items.add(speed);
                } else {
                    d.items.add(new Item(INFO, 0, "Speed: " + (npApp.isEmpty() ? "this app" : npApp) + " keeps its own speed.", null));
                }
                Item subs = new Item(TOGGLE, R.drawable.cc_eye, "Subtitles", "In apps that follow the TV's subtitle setting");
                subs.on = service.ccCaptions();
                subs.act = () -> {
                    boolean done = service.ccSetCaptions(subs.on);
                    toast(!done ? "This TV keeps its subtitle setting locked" : subs.on ? "Subtitles on" : "Subtitles off", R.drawable.cc_eye);
                };
                d.items.add(subs);
                String[] sizes = {"Small", "Normal", "Large", "Huge"};
                float[] scales = {0.75f, 1f, 1.5f, 2f};
                int zi = 1;
                for (int i = 0; i < scales.length; i++) if (Math.abs(scales[i] - service.ccCaptionScale()) < 0.01f) zi = i;
                Item size = cycle(R.drawable.cc_eye, "Subtitle size", null, sizes, zi);
                size.act = () -> {
                    service.ccSetCaptionScale(scales[size.index]);
                    toast("Subtitles " + sizes[size.index].toLowerCase(Locale.ROOT), R.drawable.cc_eye);
                };
                d.items.add(size);
                return d;
            }
            case "lyrics": {
                d = new Detail(kind, R.drawable.cc_note, accentA != 0 ? accentA : 0xFFFF3B30, PanelMedia.cleanTitle(npTitle),
                        "Looking for the words…", from);
                d.custom = LYRICS;
                d.w = 700f;
                d.h = 470f;
                return d;
            }
            case "phone": {
                d = new Detail(kind, R.drawable.cc_phone, 0xFF30D158, "Continue on your phone", "Point the phone's camera at the code", from);
                d.custom = PHONE;
                d.w = 560f;
                d.h = 440f;
                return d;
            }
            case "bhakti": {
                d = new Detail(kind, R.drawable.cc_diya, 0xFFFF9F0A, "Bhakti", "Live, or on YouTube from the start", from);
                // The two devotional channels of Live TV first, when it is on the TV: on air now, nothing to pick.
                if (AppSwitcher.launchIntent(getContext(), LIVE_TV) != null) {
                    String[][] live = {{"Aastha", "aastha", "Live TV \u00B7 bhajan, satsang"}, {"Sanskar", "sanskar", "Live TV \u00B7 katha, aarti"}};
                    for (String[] l : live) {
                        Item it = new Item(ACTION, R.drawable.cc_tv, l[0] + " live", l[2]);
                        it.act = () -> {
                            Intent go = new Intent().setClassName(LIVE_TV, LIVE_TV_ACTIVITY).putExtra("channel", l[1])
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            closeThen(() -> service.ccOpen(go));
                        };
                        d.items.add(it);
                    }
                }
                String[][] lists = {
                        {"Hanuman Chalisa", "Hanuman Chalisa", "With the words on screen (Lyrics)"},
                        {"Morning aarti", "subah ki aarti", "Om Jai Jagdish Hare and more"},
                        {"Chhath geet", "chhath puja geet", "Sharda Sinha and others"},
                        {"Krishna bhajan", "krishna bhajan", null},
                        {"Ram bhajan", "ram bhajan", null},
                        {"Shiv bhajan", "shiv bhajan", null},
                };
                for (String[] l : lists) {
                    Item it = new Item(ACTION, R.drawable.cc_diya, l[0], l[2]);
                    it.act = () -> {
                        String link = SearchActivity.resultsLink(YOUTUBE, l[1]);
                        if (link == null) return;
                        Intent go = new Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(YOUTUBE);
                        closeThen(() -> service.ccOpen(go));
                    };
                    d.items.add(it);
                }
                return d;
            }
            case "notes": {
                List<TvIsland.Note> list = TvIsland.history();
                d = new Detail(kind, R.drawable.cc_bell, 0xFFFF375F, "Notifications",
                        list.isEmpty() ? "Nothing new" : list.size() + " since the TV came on", from);
                if (list.isEmpty()) d.items.add(new Item(INFO, 0, "You are all caught up.", null));
                for (int i = 0; i < Math.min(5, list.size()); i++) {
                    TvIsland.Note n = list.get(i);
                    Item it = new Item(NOTE, R.drawable.cc_sparkle, n.title, n.detail);
                    it.right = clockOf(n.at);
                    d.items.add(it);
                }
                if (!list.isEmpty()) {
                    Item clear = new Item(ACTION, R.drawable.cc_broom, "Clear all", null);
                    clear.act = () -> {
                        TvIsland.clearHistory();
                        notesNow = TvIsland.history();
                        closeDetail(false);
                        toast("Notifications cleared", R.drawable.cc_bell);
                    };
                    d.items.add(clear);
                }
                return d;
            }
            case "orbit": {
                d = new Detail(kind, R.drawable.cc_phone, 0xFF30D158, "Orbit", orbitOn ? "Your phone is linked to this TV" : "No phone linked yet", from);
                d.items.add(new Item(INFO, 0, orbitOn ? "Works on any network: at home, at work, anywhere." : "Open Orbit on your phone: Use from anywhere, Link.", null));
                if (!orbitOn) {
                    Item code = new Item(ACTION, R.drawable.cc_link, "Show the link code", "On Home, at the top");
                    code.act = () -> closeThen(service::ccHome);
                    d.items.add(code);
                }
                return d;
            }
            case "power": {
                d = new Detail(kind, R.drawable.cc_power, 0xFFFF3B30, "Power", "Family room TV", from);
                Item sleep = new Item(ACTION, R.drawable.cc_moon, "Sleep now", "Standby; the remote wakes it");
                sleep.act = () -> closeThen(service::ccSleepNow);
                Item restart = new Item(ACTION, R.drawable.cc_restart, "Restart", "Asks once more on the TV");
                restart.act = () -> closeThen(service::ccPowerMenu);
                d.items.add(sleep);
                d.items.add(restart);
                return d;
            }
            default:
                return null;
        }
    }

    private static int iconFor(String kind) {
        if (kind == null) return R.drawable.cc_speaker;
        switch (kind) {
            case "remote": return R.drawable.cc_remote;
            case "headphones": return R.drawable.cc_headphones;
            case "soundbar": return R.drawable.cc_soundbar;
            case "phone": return R.drawable.cc_phone;
            case "tv": return R.drawable.cc_tv;
            default: return R.drawable.cc_bt;
        }
    }

    // ---------------------------------------------------------------- focus and keys

    private void setFocus(String id, boolean quiet) {
        Target prev = tById.get(focus), next = tById.get(id);
        if (next == null) return;
        focus = id;
        for (Mod m : mods) {
            boolean on = m.id.equals(next.mod);
            m.inner = on && next.inner != null;
            m.f.to(on ? 1f : 0f, 430f, 30f);
        }
        Mod m = byId.get(next.mod);
        if (!quiet && (prev == null || !prev.mod.equals(next.mod))) m.sheenAt = SystemClock.uptimeMillis();
        if (next.inner != null) {
            float[] in = next.inner;
            boolean slide = prev != null && prev.inner != null && prev.mod.equals(next.mod) && pillA.v > 0.2f;
            placePill(in[0] + in[2] / 2f, in[1] + in[3] / 2f, in[2], in[3], in[4], !slide);
            pillA.to(1f, 420f, 36f);
        } else {
            pillA.to(0f, 600f, 50f);
        }
        wake();
    }

    private void placePill(float cx, float cy, float w, float h, float radius, boolean snap) {
        pillR = radius;
        if (snap) {
            pillX.snap(cx);
            pillY.snap(cy);
            pillW.snap(w * 0.86f).to(w);
            pillH.snap(h * 0.86f).to(h);
        } else {
            pillX.to(cx, 520f, 38f);
            pillY.to(cy, 520f, 38f);
            pillW.to(w, 520f, 38f);
            pillH.to(h, 520f, 38f);
        }
    }

    private float[] box(Target t) {
        if (t.inner != null) return new float[]{t.inner[0], t.inner[1], t.inner[2], t.inner[3]};
        Mod m = byId.get(t.mod);
        return new float[]{m.x, m.y, m.w, m.h};
    }

    private static boolean ahead(float[] a, float[] b, String dir) {
        float acx = a[0] + a[2] / 2f, acy = a[1] + a[3] / 2f, bcx = b[0] + b[2] / 2f, bcy = b[1] + b[3] / 2f;
        switch (dir) {
            case "right": return bcx > acx + 1f && b[0] + b[2] > a[0] + a[2] - 1f;
            case "left": return bcx < acx - 1f && b[0] < a[0] + 1f;
            case "down": return bcy > acy + 1f && b[1] + b[3] > a[1] + a[3] - 1f;
            default: return bcy < acy - 1f && b[1] < a[1] + 1f;
        }
    }

    private static float gap(float a0, float al, float b0, float bl) {
        return Math.max(0f, Math.max(a0, b0) - Math.min(a0 + al, b0 + bl));
    }

    private static String opposite(String dir) {
        switch (dir) {
            case "up": return "down";
            case "down": return "up";
            case "left": return "right";
            default: return "left";
        }
    }

    private void move(String dir) {
        Target cur = tById.get(focus);
        float[] a = box(cur);
        Target mem = cur.memory.get(dir);
        if (mem != null && ahead(a, box(mem), dir)) {
            mem.memory.put(opposite(dir), cur);
            setFocus(mem.id, false);
            return;
        }
        Target best = null;
        float bs = Float.MAX_VALUE, acx = a[0] + a[2] / 2f, acy = a[1] + a[3] / 2f;
        for (Target t : targets) {
            if (t == cur) continue;
            float[] own = box(t);
            Mod mb = byId.get(t.mod);
            // a button inside another tile is reached through that tile's edge, and the nearest button in it wins
            float[] b = t.inner != null && !t.mod.equals(cur.mod) ? new float[]{mb.x, mb.y, mb.w, mb.h} : own;
            if (!ahead(a, b, dir)) continue;
            float bcx = own[0] + own[2] / 2f, bcy = own[1] + own[3] / 2f, prim, side, off;
            if ("right".equals(dir)) {
                prim = Math.max(0f, b[0] - (a[0] + a[2]));
                side = gap(a[1], a[3], b[1], b[3]);
                off = Math.abs(bcy - acy);
            } else if ("left".equals(dir)) {
                prim = Math.max(0f, a[0] - (b[0] + b[2]));
                side = gap(a[1], a[3], b[1], b[3]);
                off = Math.abs(bcy - acy);
            } else if ("down".equals(dir)) {
                prim = Math.max(0f, b[1] - (a[1] + a[3]));
                side = gap(a[0], a[2], b[0], b[2]);
                off = Math.abs(bcx - acx);
            } else {
                prim = Math.max(0f, a[1] - (b[1] + b[3]));
                side = gap(a[0], a[2], b[0], b[2]);
                off = Math.abs(bcx - acx);
            }
            if (side > 160f) continue;
            float score = prim + side * 3f + off * 0.12f;
            if (score < bs) {
                bs = score;
                best = t;
            }
        }
        if (best != null) {
            best.memory.put(opposite(dir), cur);
            setFocus(best.id, false);
        } else {
            Mod m = byId.get(cur.mod);
            if ("left".equals(dir)) m.nx.kick(-230f);
            else if ("right".equals(dir)) m.nx.kick(230f);
            else if ("up".equals(dir)) m.ny.kick(-230f);
            else m.ny.kick(230f);
            wake();
        }
    }

    /**
     * The buttons that open and close the panel from anywhere: Settings and Menu (which of them a remote has varies),
     * and the TV+ button, whose app is switched off on this TV (scancode 396, VIDEO_APP_5, pressed 33 times on 10 Nov).
     */
    static boolean isPanelKey(KeyEvent e) {
        int code = e.getKeyCode(), scan = e.getScanCode();
        return code == KeyEvent.KEYCODE_SETTINGS || code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_VIDEO_APP_5
                || scan == 396 || scan == 577 || scan == 139 || scan == 127;
    }

    /** Keys while the panel is open: all of them are its own, but the volume keys move its Sound slider too. */
    boolean onKey(KeyEvent e) {
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        int code = e.getKeyCode();
        if (down && e.getRepeatCount() == 0) {
            android.util.Log.i("ControlCenter", "key " + KeyEvent.keyCodeToString(code) + " scan " + e.getScanCode());
        }
        if (isPanelKey(e)) {
            if (!down) close();
            return true;
        }
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (down && e.getRepeatCount() == 0) okPressed();
                else if (!down) okReleased(e.isCanceled());
                return true;
            case KeyEvent.KEYCODE_BACK:
                if (!down) {
                    if (detail != null) closeDetail(false);
                    else close();
                }
                return true;
            case KeyEvent.KEYCODE_HOME:
                if (!down) {
                    close();
                    service.ccHome();
                }
                return true;
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                if (down) adjust("sound", code == KeyEvent.KEYCODE_VOLUME_UP ? 5 : -5);
                return true;
            case KeyEvent.KEYCODE_VOLUME_MUTE:
                if (down && e.getRepeatCount() == 0) toggleMute();
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down) arrow(code, e.getRepeatCount());
                return true;
            default:
                // Settings, and the remote's other buttons, are kept from the app under the panel while it is open.
                return true;
        }
    }

    private void arrow(int code, int repeat) {
        if (!open) return;
        String dir = code == KeyEvent.KEYCODE_DPAD_UP ? "up" : code == KeyEvent.KEYCODE_DPAD_DOWN ? "down"
                : code == KeyEvent.KEYCODE_DPAD_LEFT ? "left" : "right";
        long now = SystemClock.uptimeMillis();
        if (detail != null) {
            if ("up".equals(dir) || "down".equals(dir)) {
                if (repeat > 0 && now - navAt < 110L) return;
                navAt = now;
                moveItem("down".equals(dir) ? 1 : -1);
            } else {
                pillX.kick("left".equals(dir) ? -140f : 140f);
                wake();
            }
            return;
        }
        Target t = tById.get(focus);
        if (t.slider != null && ("left".equals(dir) || "right".equals(dir))) {
            adjust(t.slider, "left".equals(dir) ? -5 : 5);
            return;
        }
        if (repeat > 0 && now - navAt < 130L) return;
        navAt = now;
        move(dir);
    }

    private void okPressed() {
        if (!open) return;
        okDown = true;
        okHeld = false;
        press(true);
        Target t = tById.get(focus);
        if (detail == null && t != null && t.hold != null) main.postDelayed(holdOk, 450L);
    }

    private void onHold() {
        if (!okDown || detail != null) return;
        okHeld = true;
        press(false);
        Target t = tById.get(focus);
        if (t != null && t.hold != null) t.hold.run();
    }

    private void okReleased(boolean canceled) {
        main.removeCallbacks(holdOk);
        if (!okDown) return;
        okDown = false;
        press(false);
        if (okHeld || canceled || !open) return;
        if (detail != null) {
            chooseItem();
            return;
        }
        Target t = tById.get(focus);
        if (t != null && t.ok != null) t.ok.run();
    }

    private void press(boolean down) {
        Target t = tById.get(focus);
        if (detail != null || (t != null && t.inner != null)) pillP.to(down ? 1f : 0f, 900f, 44f);
        else if (t != null) byId.get(t.mod).pr.to(down ? 1f : 0f, 900f, 44f);
        wake();
    }

    // ---------------------------------------------------------------- actions

    private void toast(String text, int icon) {
        if (!open) {
            TvIsland island = HomeKeyService.island();
            if (island != null) island.show(new TvIsland.Event("cc-toast", text, "", 0xFF74D1FF, TvIsland.ICON_NONE, null, null, 2600L));
            return;
        }
        toastText = text;
        toastIcon = icon;
        float w = chipText.measureText(text) + (icon != 0 ? 26f : 0f) + 44f;
        toastW.to(w, 420f, 30f);
        if (toastA.v < 0.05f) toastW.snap(Math.max(60f, w * 0.6f)).to(w);
        toastA.to(1f, 600f, 46f);
        toastT.to(0f, 900f, 60f);
        main.postDelayed(() -> toastT.to(1f, 420f, 36f), 90L);
        main.removeCallbacks(hideToast);
        main.postDelayed(hideToast, 2300L);
        wake();
    }

    private void endToast() {
        toastT.to(0f, 700f, 52f);
        toastW.to(128f, 360f, 32f);
        toastA.to(0f, 320f, 34f);
        wake();
    }

    private void openSettings(String vendorAction, String standardAction) {
        Intent vendor = new Intent(vendorAction);
        boolean has = service.getPackageManager().resolveActivity(vendor, 0) != null;
        Intent i = has ? vendor : SystemSettings.intent(service, standardAction);
        closeThen(() -> service.ccOpen(i));
    }

    private void startSaver() {
        closeThen(() -> service.ccOpen(new Intent(service, ClockActivity.class)));
    }

    private void toggleQuiet() {
        TvIsland.quiet = !TvIsland.quiet;
        toast(TvIsland.quiet ? "Quiet on: no pop-ups while you watch" : "Quiet off", R.drawable.cc_moon);
    }

    private void toggleEye() {
        boolean on = !service.ccEye();
        service.ccSetEye(on);
        toast(on ? "Eye comfort on: a warmer picture" : "Eye comfort off", R.drawable.cc_eye);
    }

    private void toggleMute() {
        AudioManager am = service.getSystemService(AudioManager.class);
        if (am == null) return;
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, 0);
        readVolume();
        volume.to(muted ? 0f : volPct);
        toast(muted ? "Sound off" : "Sound on · " + volPct, muted ? R.drawable.cc_muted : R.drawable.cc_speaker);
    }

    private void adjust(String which, int step) {
        Mod m = byId.get(which);
        if ("display".equals(which)) {
            lightPct = Math.max(10, Math.min(100, lightPct + step));
            service.ccSetLight(lightPct);
            light.to(lightPct);
        } else {
            AudioManager am = service.getSystemService(AudioManager.class);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if (muted && step > 0) am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
                int pct = Math.max(0, Math.min(100, volPct + step));
                am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(pct * max / 100f), 0);
                readVolume();
                volume.to(muted ? 0f : volPct);
            }
        }
        if (m != null) {
            m.pr.to(0f);
            m.pr.kick(2f);
        }
        wake();
    }

    private void applyScene(int i) {
        scene = i;
        if (i == 0) {
            MovieNight.start(service);
            TvIsland.quiet = true;
            lightPct = 55;
            service.ccSetLight(lightPct);
            light.to(lightPct);
            toast("Movie Night: lights down, Quiet on", R.drawable.cc_film);
        } else if (i == 1) {
            // The Bhakti corner: a card of the family's own bhajans, each one press away on YouTube.
            openDetail("bhakti");
        } else {
            service.ccSleepIn(30);
            TvIsland.quiet = true;
            lightPct = 35;
            service.ccSetLight(lightPct);
            light.to(lightPct);
            toast("Good Night: the TV sleeps in 30 minutes", R.drawable.cc_night);
        }
        wake();
    }

    private void openPlayingApp() {
        MediaController mc = session();
        if (mc == null) return;
        Intent i = AppSwitcher.launchIntent(service, mc.getPackageName());
        if (i != null) closeThen(() -> service.ccOpen(i));
    }

    private void playPause() {
        MediaController mc = session();
        if (mc == null) {
            toast("Nothing is playing", R.drawable.cc_note);
            return;
        }
        PlaybackState s = mc.getPlaybackState();
        if (s != null && s.getState() == PlaybackState.STATE_PLAYING) mc.getTransportControls().pause();
        else mc.getTransportControls().play();
        playing = !playing;
        wake();
    }

    private void transport(int key) {
        MediaController mc = session();
        if (mc == null) return;
        if (key == KeyEvent.KEYCODE_MEDIA_NEXT) mc.getTransportControls().skipToNext();
        else mc.getTransportControls().skipToPrevious();
        main.postDelayed(() -> {
            readMedia();
            invalidate();
        }, 600L);
    }

    private void seek(long by) {
        MediaController mc = session();
        if (mc == null) return;
        PlaybackState s = mc.getPlaybackState();
        if (s == null) return;
        long pos = Math.max(0L, position(s) + by);
        mc.getTransportControls().seekTo(pos);
        npPos = pos;
        wake();
    }

    // ---------------------------------------------------------------- what the TV knows

    /** India's match as the Island last told it (title, detail), or null. */
    private String[] cricket;

    private void readAll() {
        readClock();
        outputName = service.ccOutput();
        notesNow = TvIsland.history();
        cricket = CricketScore.scoreNow();
        readMedia();
        readVolume();
        volume.snap(muted ? 0f : volPct);
        lightPct = service.ccLight();
        light.snap(lightPct);
        readNetwork();
        readBluetooth();
        String orbit = service.ccOrbit();
        orbitOn = "Linked".equals(orbit);
        orbitLine = orbit == null ? "Off" : orbit;
    }

    private MediaController session() {
        MediaSessionManager msm = service.getSystemService(MediaSessionManager.class);
        if (msm == null) return null;
        try {
            List<MediaController> list = msm.getActiveSessions(new ComponentName(service, GuardRevival.class));
            MediaController first = null;
            for (MediaController mc : list) {
                if (first == null) first = mc;
                PlaybackState s = mc.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) return mc;
            }
            return first;
        } catch (SecurityException noListener) {
            return null;
        }
    }

    private static long position(PlaybackState s) {
        long pos = s.getPosition();
        if (s.getState() == PlaybackState.STATE_PLAYING && s.getLastPositionUpdateTime() > 0) {
            pos += (long) ((SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime()) * s.getPlaybackSpeed());
        }
        return pos;
    }

    private void readMedia() {
        MediaController mc = session();
        readAt = SystemClock.uptimeMillis();
        if (mc == null) {
            npTitle = "Nothing playing";
            npSub = "Your last app picks up here";
            npApp = "";
            npPos = npDur = 0;
            playing = false;
            art = null;
            mediaPkg = null;
            mediaId = null;
            speedOk = false;
            setAccent(0, 0);
            return;
        }
        MediaMetadata md = mc.getMetadata();
        PlaybackState s = mc.getPlaybackState();
        playing = s != null && s.getState() == PlaybackState.STATE_PLAYING;
        npPos = s != null ? position(s) : 0;
        mediaPkg = mc.getPackageName();
        speedOk = s != null && (s.getActions() & PlaybackState.ACTION_SET_PLAYBACK_SPEED) != 0;
        if (s != null && s.getPlaybackSpeed() > 0f) speedNow = s.getPlaybackSpeed();
        mediaId = md != null ? md.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) : null;
        if (mediaId == null && md != null && md.getDescription() != null) {
            Uri u = md.getDescription().getMediaUri();
            mediaId = md.getDescription().getMediaId() != null ? md.getDescription().getMediaId() : u != null ? u.toString() : null;
        }
        npDur = md != null ? md.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0;
        String t = md != null ? md.getString(MediaMetadata.METADATA_KEY_TITLE) : null;
        String a = md != null ? md.getString(MediaMetadata.METADATA_KEY_ARTIST) : null;
        if (a == null && md != null) a = md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
        npTitle = t != null && !t.isEmpty() ? t : "Playing";
        npSub = a != null ? a : "";
        try {
            PackageManager pm = service.getPackageManager();
            npApp = pm.getApplicationLabel(pm.getApplicationInfo(mc.getPackageName(), 0)).toString();
        } catch (PackageManager.NameNotFoundException gone) {
            npApp = "";
        }
        Bitmap b = null;
        String uri = null;
        if (md != null) {
            b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
            for (String k : new String[]{MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
                    MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI}) {
                if (uri == null) uri = md.getString(k);
            }
        }
        // What the app tells about its video (does YouTube name it?), once per title: read with `logcat -s ControlCenter`.
        String told = mediaPkg + " id=" + mediaId + " art=" + (b != null ? "bitmap" : uri != null ? "address" : "none");
        if (!told.equals(lastTold)) {
            lastTold = told;
            android.util.Log.i("ControlCenter", "session " + told);
        }
        if (b != null) {
            if (b != art) {
                art = b;
                takeColours(b);
            }
        } else if (uri != null && uri.startsWith("http") && !uri.equals(artUrl)) {
            // The cover only as an address (YouTube gives the video's picture this way): fetched once, off the main thread.
            artUrl = uri;
            final String want = uri;
            worker.execute(() -> {
                Bitmap got = PanelMedia.download(want, 320);
                if (got != null) main.post(() -> {
                    if (!want.equals(artUrl)) return;
                    art = got;
                    takeColours(got);
                    invalidate();
                });
            });
        } else if (uri == null) {
            art = null;
            setAccent(0, 0);
        }
    }

    /** The picture's two strongest colours: the glass takes a dark shade of them, the room behind a soft wash. */
    private void takeColours(Bitmap picture) {
        try {
            Bitmap soft = picture.getConfig() == Bitmap.Config.HARDWARE ? picture.copy(Bitmap.Config.ARGB_8888, false) : picture;
            int[] c = GalleryArt.accentsOf(soft);
            setAccent(c.length > 0 ? c[0] : 0, c.length > 1 ? c[1] : (c.length > 0 ? c[0] : 0));
        } catch (RuntimeException unreadable) {
            setAccent(0, 0);
        }
    }

    private void setAccent(int a, int b) {
        if (a == accentA && b == accentB) return;
        accentA = a;
        accentB = b;
        // the glass tint glides from the old shade to the new one
        float k = clamp(tintK.v, 0f, 1f);
        for (int i = 0; i < 3; i++) tintFrom[i] = lerp(tintFrom[i], tintTo[i], k);
        if (a == 0) {
            tintTo[0] = 0.085f;
            tintTo[1] = 0.088f;
            tintTo[2] = 0.11f;
        } else {
            tintTo[0] = 0.06f + 0.22f * Color.red(a) / 255f;
            tintTo[1] = 0.06f + 0.22f * Color.green(a) / 255f;
            tintTo[2] = 0.07f + 0.22f * Color.blue(a) / 255f;
        }
        tintK.snap(0f).to(1f, 120f, 22f);
        washFor = 0;
        wake();
    }

    /** How long is left of what is playing, from the last reading and the time since; 0 when it has no length. */
    private long remainingMs() {
        if (npDur <= 0) return 0L;
        long pos = npPos + (playing ? (long) ((SystemClock.uptimeMillis() - readAt) * speedNow) : 0L);
        return Math.max(0L, npDur - pos);
    }

    private void setSpeed(float speed) {
        MediaController mc = session();
        if (mc == null) return;
        mc.getTransportControls().setPlaybackSpeed(speed);
        speedNow = speed;
    }

    // ---------------------------------------------------------------- the words of the song

    private void startLyrics() {
        String key = npTitle + "|" + npSub;
        main.removeCallbacks(lyricTick);
        main.post(lyricTick);
        if (key.equals(lyricsFor) && (lyrics != null || lyricsLoading)) {
            showLyricsState();
            return;
        }
        lyricsFor = key;
        lyrics = null;
        if (PanelMedia.isChalisa(npTitle)) {
            lyrics = PanelMedia.chalisa();
            showLyricsState();
            lyricRow.snap(lyricIndex());
            return;
        }
        lyricsLoading = true;
        showLyricsState();
        final String title = npTitle, artist = npSub;
        final long dur = npDur;
        worker.execute(() -> {
            PanelMedia.Lyrics got = PanelMedia.fetch(title, artist, dur);
            main.post(() -> {
                if (!key.equals(lyricsFor)) return;
                lyricsLoading = false;
                lyrics = got;
                showLyricsState();
                lyricRow.snap(lyricIndex());
                wake();
            });
        });
    }

    private void showLyricsState() {
        if (detail == null || detail.custom != LYRICS) return;
        detail.sub = lyricsLoading ? "Looking for the words…" : lyrics == null ? "No words found for this one" : lyrics.source
                + (lyrics.synced ? "" : " · following the song's length");
    }

    /** Which line is being sung now, as a fraction between lines, so the words can glide. */
    private float lyricIndex() {
        PanelMedia.Lyrics l = lyrics;
        if (l == null || l.lines.isEmpty()) return 0f;
        long pos = npPos + (playing ? (long) ((SystemClock.uptimeMillis() - readAt) * speedNow) : 0L);
        int n = l.lines.size();
        if (!l.synced) {
            if (npDur <= 0) return 0f;
            return clamp(pos / (float) npDur * n, 0f, n - 1f);
        }
        int i = 0;
        while (i + 1 < n && l.lines.get(i + 1).at <= pos) i++;
        return i;
    }

    private void drawLyrics(Canvas c, float left, float top, float a) {
        PanelMedia.Lyrics l = lyrics;
        float mid = top + 88f + (cth - 88f) / 2f;
        if (l == null || l.lines.isEmpty()) {
            sub.setTextAlign(Paint.Align.CENTER);
            drawText(c, lyricsLoading ? "…" : "Try a song with a clearer title, or the Bhakti corner.", ctx, mid, sub, a);
            sub.setTextAlign(Paint.Align.LEFT);
            return;
        }
        int keep = c.save();
        c.clipRect(left + 12f, top + 84f, left + ctw - 12f, top + cth - 12f);
        float row = lyricRow.v, gap = 44f;
        int from = Math.max(0, (int) Math.floor(row) - 5), to = Math.min(l.lines.size() - 1, (int) Math.ceil(row) + 5);
        lyricNow.setTextAlign(Paint.Align.CENTER);
        lyricNear.setTextAlign(Paint.Align.CENTER);
        for (int i = from; i <= to; i++) {
            float d = i - row, y = mid + d * gap + 9f;
            float near = (float) Math.exp(-d * d * 1.6f);
            TextPaint p = Math.abs(d) < 0.5f ? lyricNow : lyricNear;
            String text = ellipsize(l.lines.get(i).text, p, ctw - 60f);
            float fadeEdge = clamp(1f - Math.abs(d) / 5.5f, 0f, 1f);
            drawText(c, text, ctx, y, p, a * Math.max(0.25f, near) * fadeEdge);
        }
        lyricNow.setTextAlign(Paint.Align.LEFT);
        lyricNear.setTextAlign(Paint.Align.LEFT);
        c.restoreToCount(keep);
    }

    // ---------------------------------------------------------------- the code for the phone

    private void makeQr() {
        long pos = npPos + (playing ? SystemClock.uptimeMillis() - readAt : 0L);
        qrLink = PanelMedia.phoneLink(mediaPkg, mediaId, npTitle, pos);
        try {
            qr = PortalQr.encode(qrLink);
        } catch (RuntimeException tooLong) {
            qr = null;
        }
        // One small picture of the code, drawn sharp and scaled: not a rectangle per module every frame.
        qrPicture = null;
        if (qr != null && qr.length > 0) {
            int n = qr.length;
            Bitmap b = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) b.setPixel(x, y, qr[y][x] ? 0xFF111216 : 0xFFFFFFFF);
            qrPicture = b;
        }
        if (detail != null) {
            detail.sub = PanelMedia.youTubeId(mediaId) != null && YOUTUBE.equals(mediaPkg)
                    ? "Opens in YouTube at " + time(pos) : "Opens a search for this title on the phone";
        }
    }

    private Bitmap qrPicture;
    private final Paint qrPaint = new Paint();

    private void drawPhone(Canvas c, float left, float top, float a) {
        Bitmap m = qrPicture;
        if (m == null) {
            sub.setTextAlign(Paint.Align.CENTER);
            drawText(c, "No code for this one", ctx, top + cth / 2f + 20f, sub, a);
            sub.setTextAlign(Paint.Align.LEFT);
            return;
        }
        float size = 250f, x0 = ctx - size / 2f, y0 = top + 104f;
        // dark modules on white with a quiet zone, the way every phone camera reads them
        r.set(x0 - 16f, y0 - 16f, x0 + size + 16f, y0 + size + 16f);
        fill.setColor(0xFFFFFFFF);
        fill.setAlpha(Math.round(255f * a));
        c.drawRoundRect(r, 18f, 18f, fill);
        qrPaint.setAlpha(Math.round(255f * a));
        qrPaint.setFilterBitmap(false);
        c.drawBitmap(m, null, new RectF(x0, y0, x0 + size, y0 + size), qrPaint);
        small.setTextAlign(Paint.Align.CENTER);
        drawText(c, ellipsize(npTitle, small, ctw - 60f), ctx, y0 + size + 46f, small, a);
        small.setTextAlign(Paint.Align.LEFT);
    }

    private void readVolume() {
        AudioManager am = service.getSystemService(AudioManager.class);
        if (am == null) return;
        int max = Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        volPct = Math.round(am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max);
        muted = am.isStreamMute(AudioManager.STREAM_MUSIC) || volPct == 0;
    }

    private void readNetwork() {
        ConnectivityManager cm = service.getSystemService(ConnectivityManager.class);
        Network n = cm != null ? cm.getActiveNetwork() : null;
        NetworkCapabilities caps = n != null ? cm.getNetworkCapabilities(n) : null;
        wifiOn = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        boolean wired = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
        if (!wifiOn) {
            wifiLine = wired ? "Ethernet connected" : "Not connected";
            return;
        }
        String ssid = ssid();
        wifiLine = ssid != null ? ssid + " · " + signal() : "Connected · " + signal();
    }

    private String ssid() {
        WifiManager wm = service.getSystemService(WifiManager.class);
        if (wm == null) return null;
        @SuppressWarnings("deprecation") WifiInfo info = wm.getConnectionInfo();
        String s = info != null ? info.getSSID() : null;
        if (s == null || s.isEmpty() || s.contains("unknown ssid")) return null;
        return s.startsWith("\"") && s.endsWith("\"") ? s.substring(1, s.length() - 1) : s;
    }

    private String signal() {
        WifiManager wm = service.getSystemService(WifiManager.class);
        if (wm == null) return "";
        @SuppressWarnings("deprecation") WifiInfo info = wm.getConnectionInfo();
        if (info == null) return "";
        int level = wm.calculateSignalLevel(info.getRssi()), max = Math.max(1, wm.getMaxSignalLevel());
        float q = level / (float) max;
        return q >= 0.75f ? "Strong" : q >= 0.5f ? "Good" : q >= 0.25f ? "Fair" : "Weak";
    }

    private List<String[]> wifiDetails() {
        List<String[]> out = new ArrayList<>();
        WifiManager wm = service.getSystemService(WifiManager.class);
        @SuppressWarnings("deprecation") WifiInfo info = wm != null ? wm.getConnectionInfo() : null;
        if (!wifiOn || info == null) {
            out.add(new String[]{"Network", wifiLine});
            return out;
        }
        String ssid = ssid();
        out.add(new String[]{"Network", ssid != null ? ssid : "Connected"});
        out.add(new String[]{"Signal", signal() + " (" + info.getRssi() + " dBm)"});
        int f = info.getFrequency();
        out.add(new String[]{"Band", (f >= 5900 ? "6 GHz" : f >= 4900 ? "5 GHz" : "2.4 GHz") + " · " + info.getLinkSpeed() + " Mbps"});
        String ip = address();
        if (ip != null) out.add(new String[]{"Address", ip});
        return out;
    }

    private String address() {
        ConnectivityManager cm = service.getSystemService(ConnectivityManager.class);
        Network n = cm != null ? cm.getActiveNetwork() : null;
        LinkProperties lp = n != null ? cm.getLinkProperties(n) : null;
        if (lp == null) return null;
        for (LinkAddress la : lp.getLinkAddresses()) {
            if (la.getAddress() instanceof Inet4Address) return la.getAddress().getHostAddress();
        }
        return null;
    }

    private boolean canBluetooth() {
        return service.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void readBluetooth() {
        BluetoothManager bm = service.getSystemService(BluetoothManager.class);
        BluetoothAdapter ad = bm != null ? bm.getAdapter() : null;
        btOn = ad != null && ad.isEnabled();
        if (!btOn) {
            btLine = "Off";
            return;
        }
        int connected = 0;
        String name = null;
        for (String[] d : bluetoothDevices()) {
            if (d[1].startsWith("Connected")) {
                connected++;
                if (name == null) name = d[0];
            }
        }
        btLine = connected == 0 ? "On" : connected == 1 ? "On · " + name : "On · " + connected + " devices";
    }

    /** Paired devices: name, "Connected" or "Paired", and a kind for the icon. */
    private List<String[]> bluetoothDevices() {
        List<String[]> out = new ArrayList<>();
        if (!canBluetooth()) return out;
        BluetoothManager bm = service.getSystemService(BluetoothManager.class);
        BluetoothAdapter ad = bm != null ? bm.getAdapter() : null;
        if (ad == null) return out;
        try {
            Set<BluetoothDevice> bonded = ad.getBondedDevices();
            if (bonded == null) return out;
            for (BluetoothDevice d : bonded) {
                String name = d.getName();
                if (name == null) name = d.getAddress();
                boolean on = false;
                try {
                    Object v = BluetoothDevice.class.getMethod("isConnected").invoke(d);
                    on = Boolean.TRUE.equals(v);
                } catch (ReflectiveOperationException | RuntimeException hidden) {
                    // not offered on this build: shown as paired
                }
                BluetoothClass bc = d.getBluetoothClass();
                int major = bc != null ? bc.getMajorDeviceClass() : 0;
                String kind = major == BluetoothClass.Device.Major.AUDIO_VIDEO ? (name.toLowerCase(Locale.ROOT).contains("bar") ? "soundbar" : "headphones")
                        : major == BluetoothClass.Device.Major.PHONE ? "phone"
                        : major == BluetoothClass.Device.Major.PERIPHERAL ? "remote" : "bt";
                out.add(new String[]{name, on ? "Connected" : "Paired", kind});
            }
        } catch (SecurityException noPermission) {
            // shown as no devices
        }
        return out;
    }

    /** HDMI and AV inputs the TV lists: name, what is plugged in, and the input's id. */
    private List<String[]> inputs() {
        List<String[]> out = new ArrayList<>();
        TvInputManager tim = service.getSystemService(TvInputManager.class);
        if (tim == null) return out;
        try {
            for (TvInputInfo info : tim.getTvInputList()) {
                if (!info.isPassthroughInput() || info.isHidden(service) || info.getParentId() != null) continue;
                CharSequence name = info.loadCustomLabel(service);
                if (name == null || name.length() == 0) name = info.loadLabel(service);
                int state = tim.getInputState(info.getId());
                String line = state == TvInputManager.INPUT_STATE_CONNECTED ? "Connected"
                        : state == TvInputManager.INPUT_STATE_CONNECTED_STANDBY ? "Connected, asleep" : "Nothing connected";
                out.add(new String[]{name.toString(), line, info.getId()});
            }
        } catch (RuntimeException unavailable) {
            // shown as Google TV only
        }
        return out;
    }

    // ---------------------------------------------------------------- small helpers

    private void drawIcon(Canvas c, int res, float cx, float cy, float size, int color, float a) {
        // One drawable per icon and size: a vector redraws its cached picture whenever its bounds change size.
        long key = ((long) res << 16) | Math.round(size * 4f);
        Drawable d = sized.get(key);
        if (d == null) {
            Drawable base = getContext().getDrawable(res);
            if (base == null) return;
            d = base.mutate();
            sized.put(key, d);
        }
        // The tint is opaque and the alpha carries the colour's own transparency, so it is applied once.
        d.setTint(color | 0xFF000000);
        d.setAlpha(Math.round(255f * a * (Color.alpha(color) / 255f)));
        int half = Math.round(size / 2f);
        d.setBounds(Math.round(cx) - half, Math.round(cy) - half, Math.round(cx) + half, Math.round(cy) + half);
        d.draw(c);
    }

    private static void drawText(Canvas c, String s, float x, float y, TextPaint p, float a) {
        if (s == null || s.isEmpty()) return;
        int keep = p.getAlpha();
        p.setAlpha(Math.round(keep * a));
        c.drawText(s, x, y, p);
        p.setAlpha(keep);
    }

    private static String ellipsize(String s, TextPaint p, float w) {
        if (s == null) return "";
        return TextUtils.ellipsize(s, p, w, TextUtils.TruncateAt.END).toString();
    }

    private static String[] wrap(String s, TextPaint p, float w, int lines) {
        if (p.measureText(s) <= w || lines == 1) return new String[]{ellipsize(s, p, w)};
        int cut = p.breakText(s, true, w, null);
        int space = s.lastIndexOf(' ', cut);
        if (space > 0) cut = space;
        String first = s.substring(0, cut).trim(), rest = s.substring(cut).trim();
        return new String[]{first, ellipsize(rest, p, w)};
    }

    private static String time(long ms) {
        long s = Math.max(0L, ms / 1000L), h = s / 3600L, m = (s % 3600L) / 60L, r = s % 60L;
        return h > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", h, m, r) : String.format(Locale.ROOT, "%d:%02d", m, r);
    }

    private static String clockOf(long at) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        int h = c.get(Calendar.HOUR);
        return (h == 0 ? 12 : h) + ":" + String.format(Locale.ROOT, "%02d", c.get(Calendar.MINUTE))
                + (c.get(Calendar.AM_PM) == Calendar.PM ? " pm" : " am");
    }

    private static float clamp(float v, float a, float b) {
        return v < a ? a : v > b ? b : v;
    }

    private static float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }

    private static float smooth(float a, float b, float x) {
        float t = clamp((x - a) / (b - a), 0f, 1f);
        return t * t * (3f - 2f * t);
    }

    // ---------------------------------------------------------------- the glass

    /** One tile of glass: it bends the blurred screen at its rim, lights its top-left edge, and casts a soft shadow. */
    private static final String GLASS = ""
            + "uniform shader back;\n"
            + "uniform float4 box;\n"
            + "uniform float4 look;\n"
            + "uniform float4 more;\n"
            + "uniform float3 tintc;\n"
            + "float sdRB(float2 p, float2 b, float r) {\n"
            + "  r = min(r, min(b.x, b.y)); float2 q = abs(p) - b + r;\n"
            + "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;\n"
            + "}\n"
            + "float2 nRB(float2 p, float2 b, float r) {\n"
            + "  r = min(r, min(b.x, b.y));\n"
            + "  float2 s = float2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);\n"
            + "  float2 q = abs(p) - b + r;\n"
            + "  if (q.x > 0.0 && q.y > 0.0) return normalize(q) * s;\n"
            + "  return q.x > q.y ? float2(s.x, 0.0) : float2(0.0, s.y);\n"
            + "}\n"
            // Positions stay float; colours are half, which this Mali runs at twice the rate. No pow(): powers by multiplying.
            + "half4 main(float2 xy) {\n"
            + "  float2 p = xy - box.xy;\n"
            + "  float d = sdRB(p, box.zw, look.x);\n"
            + "  half alpha = half(look.w); half focus = half(look.y);\n"
            + "  if (d > 0.0) {\n"
            + "    half sh = half(exp(-d * 0.1)) * 0.30 * alpha;\n"
            + "    half gl = half(exp(-d * 0.0833)) * 0.15 * focus * alpha;\n"
            + "    return half4(half3(0.80, 0.90, 1.0) * gl, sh + gl);\n"
            + "  }\n"
            + "  half cov = half(clamp(0.5 - d / more.w, 0.0, 1.0)) * alpha;\n"
            + "  float band = clamp(min(box.z, box.w) * 0.5, 6.0, 22.0);\n"
            + "  half e = half(clamp(1.0 + d / band, 0.0, 1.0));\n"
            + "  float2 n = nRB(p, box.zw, look.x);\n"
            + "  float bend = float(e * e * (0.55 + 0.45 * e)) * band * (0.95 + 0.3 * look.y);\n"
            + "  half3 g = back.eval(xy - n * bend).rgb;\n"
            + "  half l = dot(g, half3(0.2126, 0.7152, 0.0722));\n"
            + "  g = mix(half3(l), g, 1.45) * half(1.0 - more.z);\n"
            + "  g = mix(g, half3(tintc), half(more.y));\n"
            + "  g += 0.045 + 0.07 * focus + 0.13 * half(look.z);\n"
            + "  g += e * e * e * (0.07 + 0.07 * focus);\n"
            + "  half rim = half(smoothstep(-1.5 - 2.0 * more.w, -0.25 * more.w, d));\n"
            + "  half t1 = half(max(dot(n, float2(-0.5432, -0.8396)), 0.0));\n"
            + "  half t2 = half(max(dot(n, float2(0.5432, 0.8396)), 0.0));\n"
            + "  g += rim * (0.09 + 0.62 * t1 * sqrt(t1) + 0.32 * t2 * t2) * (0.62 + 0.5 * focus);\n"
            + "  if (more.x > 0.001 && more.x < 0.999) {\n"
            + "    float2 q = p / max(box.z, 1.0);\n"
            + "    float t = dot(q, float2(0.9138, 0.4061)) - mix(-1.8, 1.8, more.x);\n"
            + "    g += half(exp(-t * t * 9.0)) * 0.13 * focus;\n"
            + "  }\n"
            + "  return half4(g * cov, cov);\n"
            + "}\n";

    /** The focus inside a tile or a card: a lighter pane that slides from button to button. */
    private static final String PILL_SKSL = ""
            + "uniform float4 box;\n"
            + "uniform float4 look;\n"
            + "half4 main(float2 xy) {\n"
            + "  float2 p = xy - box.xy;\n"
            + "  float r = min(look.x, min(box.z, box.w));\n"
            + "  float2 q = abs(p) - box.zw + r;\n"
            + "  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;\n"
            + "  float cov = clamp(0.5 - d / look.w, 0.0, 1.0) * look.y;\n"
            + "  if (cov <= 0.0) return half4(0.0);\n"
            + "  float2 s = float2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);\n"
            + "  float2 n = (q.x > 0.0 && q.y > 0.0) ? normalize(q) * s : (q.x > q.y ? float2(s.x, 0.0) : float2(0.0, s.y));\n"
            + "  float rim = smoothstep(-1.2 - 1.6 * look.w, -0.2 * look.w, d);\n"
            + "  float s1 = pow(max(dot(n, float2(-0.5432, -0.8396)), 0.0), 1.4);\n"
            + "  float a = 0.13 + 0.10 * look.z + rim * (0.06 + 0.42 * s1);\n"
            + "  return half4(half3(a * cov), half(a * cov));\n"
            + "}\n";
}
