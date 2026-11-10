package com.gathin.tvhome;

import android.app.ActivityOptions;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.text.format.DateFormat;
import android.view.Choreographer;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

import androidx.annotation.RequiresApi;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * The gallery home (config.xml gallery_home): the apps on the inside of a cylinder, a light in the middle that turns
 * the silver cards on its left into the full-colour cards on its right through a drop of glass, the greeting above,
 * the focused app's name and a liquid-glass search bar below. The light behind the row takes the focused app's colour.
 *
 * <p>Everything is one view drawn from {@link GalleryArt}'s ready-made pictures and shaders, so a frame is a couple of
 * dozen draws and no layout. Nothing is allocated while drawing, and when nothing moves no frame is asked for at all:
 * the panel's 60 Hz is the ceiling, and the point is to never miss one of them.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class GalleryHomeView extends View {

    interface Host {
        void onGalleryLaunch(AppAdapter.Entry entry, Bundle options);
        void onGalleryAppInfo(AppAdapter.Entry entry);
        void onGallerySearch(boolean voice);
        void onGalleryTopButton(int which);
        void onGalleryRecent(RecentVideos.Item item, ActivityOptions options);
    }

    static final int TOP_INPUTS = 0, TOP_WIFI = 1, TOP_SETTINGS = 2;

    /** The cylinder, in a 1280 x 720 design. Its radius is 1, so the focal length alone sets the size on screen. */
    private static final float FOCAL = 500f;
    private static final float STEP = (float) Math.toRadians(19.0);
    private static final float HALF_W = 0.150f;
    private static final float HALF_H = 0.205f;
    /** The focused card comes forward by this much, so focus shows even without the line. */
    private static final float LIFT = 0.115f;
    /** Cards inside their frames: how far the logo slides per card from the middle, in card pixels. */
    private static final float LOGO_PARALLAX = 8f;

    private static final float CENTER_Y = 368f;
    private static final float NAME_Y = 538f;
    private static final float PILL_Y = 604f;
    private static final float PILL_W = 620f;
    private static final float PILL_H = 60f;
    private static final float TOP_Y = 78f;
    private static final float TOP_R = 27f;
    private static final float[] TOP_X = {1039f, 1108f, 1177f};

    /** Critically damped: glides onto the card with no swing past it. About half a second from a standing start. */
    private static final float OMEGA = 12f;
    private static final long HOLD_FIRST_MS = 340L;
    private static final long HOLD_NEXT_MS = 135L;
    private static final long LONG_PRESS_MS = 650L;

    private static final int ZONE_RECENTS = -1, ZONE_CARDS = 0, ZONE_SEARCH = 1, ZONE_MIC = 2, ZONE_TOP = 3;

    /**
     * The recent videos, below Home: the inside of a ring of radius 1 again, but seen from above its middle, so the row
     * arcs over the text under it and its ends curve down and towards you. TILT is how much.
     */
    private static final float RIBBON_FOCAL = 560f;
    private static final float RIBBON_STEP = (float) Math.toRadians(22.0);
    private static final float RIBBON_HALF_W = 0.200f;
    private static final float RIBBON_HALF_H = RIBBON_HALF_W * RecentVideos.ART_H / RecentVideos.ART_W;
    private static final float RIBBON_TILT = 0.55f;
    private static final float RIBBON_LIFT = 0.40f;
    private static final float RIBBON_Y = 330f;
    private static final float RIBBON_TITLE_Y = 508f, RIBBON_LINE_Y = 544f;
    /** Slower than the row: going down a screen is a bigger move than going along it. */
    private static final float PAGE_OMEGA = 8.5f;

    private static final int FALLBACK_ACCENT = 0xFFA6FF3A;
    private static final int ROOM_W = 800, ROOM_H = 460, BLOOM_W = 84, BLOOM_H = 180, BAR_GLOW_W = 180, BAR_GLOW_H = 24;

    private final Host host;
    private final GallerySound sound;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Choreographer choreographer = Choreographer.getInstance();

    private List<GalleryArt.Card> cards = new ArrayList<>();
    private final Map<String, GalleryArt.Card> artCache = new HashMap<>();
    private String signature = "";
    private int buildGeneration;

    private RuntimeShader roomShader, bloomShader, barGlowShader;
    private Bitmap barGlass, orbGlass, headline;
    private String headlineKey = "";

    private float x;
    private float velocity;
    private int target;
    private float reveal;
    /** The first opening after the boot film: Home comes out of the line the film ended on, over a little more time. */
    private boolean opening;
    private boolean warming;
    /** 1 normally, lower during Movie Night. */
    private float nightDim = 1f;
    /** 0 normally, 1 while the TV Island speaks over the greeting. */
    private float islandK;
    private android.animation.ValueAnimator islandFade;
    private String greetingName = "";
    /** Today's festival, if Home dresses up for it (HomeDays); null on an ordinary day. */
    private HomeDays.Day festiveDay;
    private float lineFlare;
    private static final float OPENING_SECONDS = 1.35f;
    /** How much bigger an app's card is at the end of its way forward. */
    private static final float OPENING_ZOOM = 0.72f;
    private final RectF openingDst = new RectF();
    private final Paint openingPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private float energy;
    /** The "felt" part of a press: a short jolt of light and size that dies away in a fraction of a second. */
    private float kick;
    private float nameFade = 1f;
    private float cardsFocus = 1f, searchFocus, micFocus;
    private float press;
    private boolean okDown, okLongFired;
    private int zone = ZONE_CARDS;
    private String name = "", previousName = "";
    private String dateLine = "";

    private float barL, barR, barAlpha, topL, topR, topAlpha;

    private ScrollCue cue;
    private List<RecentVideos.Item> recents = new ArrayList<>();
    /** 0 on Home, 1 on the recent videos. */
    private float page, pageVelocity;
    private float ribbon, ribbonVelocity;
    private int ribbonTarget;
    private float ribbonFocus, ribbonFade = 1f;
    private String ribbonTitle = "", ribbonLine = "", ribbonOldTitle = "", ribbonOldLine = "";
    private Bitmap wordContinue, wordWatching;
    private final Paint artPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint rimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trackPaint = new Paint();
    private final Paint recentTitlePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint recentLinePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final float[] artSrc = {0, 0, RecentVideos.ART_W, 0, RecentVideos.ART_W, RecentVideos.ART_H, 0, RecentVideos.ART_H};

    private boolean animating;
    private boolean resumed;
    private long lastFrameNs;
    private int holdDirection;

    private float u = 1f, cx, cy;
    private float scanTop, scanBottom;
    private final RectF glowDst = new RectF(), bloomDst = new RectF(), barGlowDst = new RectF(), pill = new RectF(),
            micCircle = new RectF(), blob = new RectF();

    private float accentR, accentG, accentB, accent2R, accent2G, accent2B;
    private int accentInt = FALLBACK_ACCENT;

    private final Matrix matrix = new Matrix();
    private final float[] src = {0, 0, GalleryArt.CARD_W, 0, GalleryArt.CARD_W, GalleryArt.CARD_H, 0, GalleryArt.CARD_H};
    private final float[] dst = new float[8];

    private final Paint cardPaint = new Paint();
    private final Paint roomPaint = new Paint();
    private final Paint headlinePaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint glassPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint bloomPaint = new Paint();
    private final Paint linePaint = new Paint();
    private final Paint datePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint namePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint hintPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint blobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blobRim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dustNear = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dustFar = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final Path searchIcon = new Path(), micIcon = new Path();
    private final String hint = "Search apps, movies and shows";
    private final Drawable[] topIcons = new Drawable[3];
    private final boolean[] topIconDark = new boolean[3];

    private static final int DUST = 26;
    private final float[] dustBase = new float[DUST * 2];
    private final float[] dustNearPts = new float[DUST], dustFarPts = new float[DUST];

    private final RecentVideos.Listener recentsListener = new RecentVideos.Listener() {
        @Override
        public void onRecents(List<RecentVideos.Item> items) {
            setRecents(items);
        }

        @Override
        public void onRecentArt(RecentVideos.Item item) {
            invalidate();
        }
    };

    private final Runnable holdRepeat = new Runnable() {
        @Override
        public void run() {
            if (holdDirection == 0) return;
            move(holdDirection);
            postDelayed(this, HOLD_NEXT_MS);
        }
    };
    private final Runnable longPress = new Runnable() {
        @Override
        public void run() {
            okLongFired = true;
            press = 0f;
            if (zone == ZONE_CARDS && !cards.isEmpty()) {
                feel(GallerySound.SELECT, 1f);
                host.onGalleryAppInfo(currentCard().entry);
            }
        }
    };
    private final Runnable minuteTick = new Runnable() {
        @Override
        public void run() {
            refreshTexts();
            invalidate();
            postDelayed(this, 60_000L - System.currentTimeMillis() % 60_000L);
        }
    };

    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            if (!animating) return;
            if (covered) {
                animating = false;
                lastFrameNs = 0L;
                return;
            }
            // The vsync's own time, not the clock when this code happened to run: that is what keeps the steps even.
            float dt = lastFrameNs == 0L ? 1f / 60f : Math.min(0.05f, (now - lastFrameNs) / 1e9f);
            lastFrameNs = now;
            boolean busy = advance(dt);
            invalidate();
            if (busy) {
                choreographer.postFrameCallback(this);
            } else {
                animating = false;
                lastFrameNs = 0L;
            }
        }
    };

    GalleryHomeView(Context context, Host host) {
        super(context);
        alive = this;
        this.host = host;
        sound = new GallerySound(context);
        setFocusable(true);
        setFocusableInTouchMode(true);
        setDefaultFocusHighlightEnabled(false);

        Typeface light = context.getResources().getFont(R.font.inter_light);
        Typeface regular = context.getResources().getFont(R.font.inter_regular);
        datePaint.setTypeface(light);
        datePaint.setTextAlign(Paint.Align.CENTER);
        datePaint.setColor(0xFFB4B7BE);
        datePaint.setLetterSpacing(0.012f);
        namePaint.setTypeface(regular);
        namePaint.setTextAlign(Paint.Align.CENTER);
        namePaint.setColor(Color.WHITE);
        namePaint.setLetterSpacing(-0.012f);
        hintPaint.setTypeface(light);
        hintPaint.setLetterSpacing(0.002f);
        recentTitlePaint.setTypeface(regular);
        recentTitlePaint.setTextAlign(Paint.Align.CENTER);
        recentTitlePaint.setColor(Color.WHITE);
        recentTitlePaint.setLetterSpacing(-0.008f);
        recentLinePaint.setTypeface(light);
        recentLinePaint.setTextAlign(Paint.Align.CENTER);
        recentLinePaint.setColor(0xFFB9BDC6);
        rimPaint.setStyle(Paint.Style.STROKE);
        rimPaint.setStrokeWidth(3f);
        bloomPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.ADD));
        cardPaint.setColor(Color.WHITE);
        blobRim.setStyle(Paint.Style.STROKE);
        iconPaint.setStyle(Paint.Style.STROKE);
        iconPaint.setStrokeCap(Paint.Cap.ROUND);
        iconPaint.setStrokeJoin(Paint.Join.ROUND);
        dustNear.setStrokeCap(Paint.Cap.ROUND);
        dustFar.setStrokeCap(Paint.Cap.ROUND);

        topIcons[TOP_INPUTS] = context.getDrawable(R.drawable.ic_input).mutate();
        topIcons[TOP_WIFI] = context.getDrawable(R.drawable.ic_wifi).mutate();
        topIcons[TOP_SETTINGS] = context.getDrawable(R.drawable.ic_settings).mutate();
        for (Drawable d : topIcons) d.setTint(Color.WHITE);

        Random rnd = new Random(11);
        for (int i = 0; i < DUST * 2; i += 2) {
            dustBase[i] = rnd.nextFloat();
            dustBase[i + 1] = rnd.nextFloat();
        }
        refreshTexts();
    }

    // ---- content -------------------------------------------------------------------------------

    /** The apps in Home's order. The same apps again cost nothing; only a card not seen before is drawn. */
    void setEntries(List<AppAdapter.Entry> entries) {
        StringBuilder sb = new StringBuilder();
        for (AppAdapter.Entry e : entries) sb.append(e.component.flattenToShortString()).append('\n');
        String sig = sb.toString();
        if (sig.equals(signature) && cards.size() == entries.size()) return;
        signature = sig;
        final int generation = ++buildGeneration;
        final List<AppAdapter.Entry> list = new ArrayList<>(entries);
        final Map<String, GalleryArt.Card> known = new HashMap<>(artCache);
        Thread worker = new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY);
            final List<GalleryArt.Card> built = new ArrayList<>(list.size());
            for (AppAdapter.Entry e : list) {
                String key = e.component.flattenToShortString();
                GalleryArt.Card card = known.get(key);
                if (card == null) {
                    try {
                        card = GalleryArt.card(e);
                    } catch (RuntimeException ex) {
                        continue;   // one app's odd banner must not cost the whole Home
                    }
                }
                built.add(card);
            }
            main.post(() -> {
                if (generation != buildGeneration) return;
                applyCards(built);
            });
        }, "gallery-art");
        worker.start();
    }

    private void applyCards(List<GalleryArt.Card> built) {
        String focusedKey = cards.isEmpty() ? null : currentCard().key;
        cards = built;
        artCache.clear();
        for (GalleryArt.Card c : built) artCache.put(c.key, c);
        int index = 0;
        if (focusedKey != null) {
            for (int i = 0; i < built.size(); i++) {
                if (built.get(i).key.equals(focusedKey)) index = i;
            }
        }
        target = index;
        x = index;
        velocity = 0f;
        name = built.isEmpty() ? "" : currentCard().entry.label;
        previousName = "";
        nameFade = 1f;
        reveal = 0f;
        wake();
    }

    /** Another app needs the memory while Home is hidden: the next return draws the cards again. */
    void releaseArt() {
        buildGeneration++;
        cards = new ArrayList<>();
        artCache.clear();
        signature = "";
        RecentVideos.forget();
        setRecents(new ArrayList<>());
    }

    void setCue(ScrollCue cue) {
        this.cue = cue;
        // Never GONE: coming back from that lays out the whole of Home, in the middle of the opening after the film.
        cue.setVisibility(INVISIBLE);
    }

    private void setRecents(List<RecentVideos.Item> items) {
        // Someone on the page keeps their card when the list changes; anyone else finds it on what played last.
        String focused = zone != ZONE_RECENTS || recents.isEmpty() ? null
                : recents.get(Math.min(ribbonTarget, recents.size() - 1)).key();
        recents = items;
        int index = 0;
        for (int i = 0; focused != null && i < items.size(); i++) {
            if (items.get(i).key().equals(focused)) index = i;
        }
        ribbonTarget = index;
        ribbon = index;
        ribbonVelocity = 0f;
        if (items.isEmpty() && zone == ZONE_RECENTS) setZone(ZONE_SEARCH);
        ribbonFade = 1f;
        ribbonOldTitle = "";
        ribbonOldLine = "";
        readRibbonText();
        if (cue != null) {
            cue.setVisibility(items.isEmpty() ? INVISIBLE : VISIBLE);
            cue.setRunning(resumed && !items.isEmpty());
        }
        invalidate();
    }

    private void readRibbonText() {
        if (recents.isEmpty() || getWidth() == 0) {
            ribbonTitle = "";
            ribbonLine = "";
            return;
        }
        RecentVideos.Item item = recents.get(ribbonTarget);
        float room = 780f * u;
        ribbonTitle = TextUtils.ellipsize(item.title, new TextPaint(recentTitlePaint), room, TextUtils.TruncateAt.END).toString();
        StringBuilder line = new StringBuilder(item.appName);
        if (!item.detail.isEmpty()) line.append("   ·   ").append(item.detail);
        if (item.duration > 0L && item.position > 0L && item.position < item.duration) {
            long minutes = Math.max(1L, (item.duration - item.position) / 60_000L);
            line.append("   ·   ");
            if (minutes >= 60L) line.append(minutes / 60L).append(" h ").append(minutes % 60L).append(" min left");
            else line.append(minutes).append(" min left");
        }
        ribbonLine = TextUtils.ellipsize(line, new TextPaint(recentLinePaint), room, TextUtils.TruncateAt.END).toString();
    }

    private GalleryArt.Card currentCard() {
        return cards.get(Math.floorMod(target, cards.size()));
    }

    private void refreshTexts() {
        Calendar now = Calendar.getInstance();
        Context ctx = getContext();
        CharSequence date = DateFormat.format("EEEE, d MMMM", now);
        CharSequence time = DateFormat.getTimeFormat(ctx).format(now.getTime());
        dateLine = date + "   ·   " + time;
        String weather = Weather.text();
        if (!weather.isEmpty()) dateLine += "   ·   " + weather;
        int hour = now.get(Calendar.HOUR_OF_DAY);
        festiveDay = HomeDays.on(java.time.LocalDate.now());
        String title, line;
        if (festiveDay != null) {
            title = festiveDay.named ? named(festiveDay.title) : festiveDay.title;
            line = festiveDay.line;
        } else if (hour >= 5 && hour < 12) {
            title = "Good Morning";
            line = "Hello, I wish you a wonderful day";
        } else if (hour >= 12 && hour < 17) {
            title = "Good Afternoon";
            line = "Hello, I wish you a wonderful day";
        } else if (hour >= 17 && hour < 22) {
            title = "Good Evening";
            line = "Hello, I wish you a relaxing evening";
        } else {
            title = "Good Night";
            line = "Hello, I wish you a peaceful night";
        }
        if (festiveDay == null) title = named(title);
        String key = title + "|" + line;
        if (getWidth() > 0 && !key.equals(headlineKey)) {
            headlineKey = key;
            final String title2 = title, line2 = line;
            final float size = 52f * getWidth() / 1280f;
            new Thread(() -> {
                Bitmap made = GalleryArt.headline(ctx, title2, line2, size);
                main.post(() -> {
                    headline = made;
                    invalidate();
                });
            }, "gallery-headline").start();
        }
    }

    // ---- life ------------------------------------------------------------------------------------

    /** greeting_name: said after the greeting, "Good Evening, Shiv". */
    void setGreetingName(String name) {
        greetingName = name == null ? "" : name.trim();
        headlineKey = "";
        refreshTexts();
    }

    private String named(String title) {
        return greetingName.isEmpty() ? title : title + ", " + greetingName;
    }

    void openAfterFilm() {
        opening = true;
        onResumed();
    }

    boolean isOpening() {
        return opening;
    }

    /** The Home the helper's windows draw against: the one alive, if any. */
    private static GalleryHomeView alive;

    static GalleryHomeView alive() {
        return alive;
    }

    /** Where the middle card stands at rest, in screen pixels: the place an app goes back into. */
    void focusedCardRect(RectF out) {
        float halfW = HALF_W * FOCAL * (1f + LIFT) * u, halfH = HALF_H * FOCAL * (1f + LIFT) * u;
        out.set(cx - halfW, cy - halfH, cx + halfW, cy + halfH);
    }

    /** The card of this app, or null if it has none on Home. */
    GalleryArt.Card cardOf(String pkg) {
        for (GalleryArt.Card c : cards) if (c.entry.pkg.equals(pkg)) return c;
        return null;
    }

    /** When centreOn last put an app's card in the middle: the Home intent that follows must not take it away. */
    private long centredAtMs;
    /** Where the pointer's touch went down (onTouchEvent). */
    private float touchX, touchY;

    /** Puts this app's card in the middle at once, without a glide: Home is about to come back on it. */
    void centreOn(String pkg) {
        if (cards.isEmpty()) return;
        int n = cards.size(), now = Math.floorMod(target, n);
        for (int i = 0; i < n; i++) {
            if (cards.get(i).entry.pkg.equals(pkg)) {
                target += i - now;
                x = target;
                velocity = 0f;
                name = cards.get(i).entry.label;
                previousName = "";
                nameFade = 1f;
                setZone(ZONE_CARDS);
                centredAtMs = SystemClock.uptimeMillis();
                invalidate();
                return;
            }
        }
    }

    /** The TV Island is speaking at the top: the greeting sinks a little and fades out to make room, and comes back
     *  after. Dimmed but still there, it read as a double exposure behind the Island's words. */
    void setIslandOver(boolean over) {
        if (islandFade != null) islandFade.cancel();
        islandFade = android.animation.ValueAnimator.ofFloat(islandK, over ? 1f : 0f).setDuration(over ? 380L : 520L);
        islandFade.addUpdateListener(a -> {
            islandK = (float) a.getAnimatedValue();
            invalidate();
        });
        islandFade.start();
    }

    /** Movie Night: the room's light low, no dust in it, the words dimmer. */
    void setMovieNight(boolean on) {
        nightDim = on ? 0.4f : 1f;
        invalidate();
    }

    boolean isResumedNow() {
        return resumed;
    }

    /** Everything the first real frame needs has been made. */
    boolean readyToOpen() {
        return !cards.isEmpty() && roomShader != null && bloomShader != null && headline != null;
    }

    /** One whole Home drawn behind the film's opaque cover, so that nothing is made for the first time when it comes into view. */
    void warmUp() {
        warming = true;
        invalidate();
    }

    void onResumed() {
        resumed = true;
        requestFocus();
        refreshTexts();
        removeCallbacks(minuteTick);
        postDelayed(minuteTick, 60_000L - System.currentTimeMillis() % 60_000L);
        // Back on Home: the row opens up from slightly closed, and the light comes on.
        reveal = 0f;
        if (zone == ZONE_RECENTS) zone = ZONE_CARDS;
        page = 0f;
        pageVelocity = 0f;
        Weather.refresh(getContext(), () -> {
            refreshTexts();
            invalidate();
        });
        RecentVideos.load(getContext(), recentsListener);
        WatchHistory.setOnChange(() -> {
            if (resumed) RecentVideos.load(getContext(), recentsListener);
        });
        if (cue != null) cue.setRunning(!recents.isEmpty());
        wake();
    }

    void onPaused() {
        resumed = false;
        animating = false;
        lastFrameNs = 0L;
        choreographer.removeFrameCallback(frame);
        if (cue != null) cue.setRunning(false);
        WatchHistory.setOnChange(null);
        removeCallbacks(minuteTick);
        stopHold();
        removeCallbacks(longPress);
        okDown = false;
        press = 0f;
        // Whatever was moving is simply there on the way back.
        x = target;
        velocity = 0f;
        energy = 0f;
        kick = 0f;
    }

    /** The remote's Home with Home already in front: back to the first app, the short way round. */
    void onHomePressedOnHome() {
        setZone(ZONE_CARDS);
        // The helper has just put the app's card in the middle for the app to go back into: the app was in front,
        // even if Android had not stopped Home behind it yet (it waits for the app to settle, up to 10 s).
        if (SystemClock.uptimeMillis() - centredAtMs < 2000L) {
            centredAtMs = 0L;
            return;
        }
        if (cards.isEmpty()) return;
        int n = cards.size();
        int offset = Math.floorMod(target, n);
        if (offset != 0) move(offset <= n / 2 ? -offset : n - offset);
    }

    void shutdown() {
        if (alive == this) alive = null;
        buildGeneration++;
        onPaused();
        sound.release();
    }

    /** The row as it stands, in Home's own order, for the strip over a playing video (VideoShelf). */
    List<AppAdapter.Entry> rowEntries() {
        List<AppAdapter.Entry> out = new ArrayList<>();
        for (GalleryArt.Card c : cards) {
            AppAdapter.Entry e = c.entry;
            if (e.kind == AppAdapter.Entry.APP && e.pkg != null) out.add(e);
        }
        return out;
    }

    /** The Control Center covers Home: none of it is seen, so the room stops moving and leaves the GPU to the panel. */
    private boolean covered;

    void setCovered(boolean on) {
        if (covered == on) return;
        covered = on;
        // Not drawn at all while covered: the cue's bounce alone redrew the whole room every frame (Mali-G31, 10 Nov).
        View content = getRootView().findViewById(android.R.id.content);
        if (content != null) content.setVisibility(on ? INVISIBLE : VISIBLE);
        if (!on) wake();
    }

    private void wake() {
        if (animating || !resumed || covered) {
            invalidate();
            return;
        }
        animating = true;
        lastFrameNs = 0L;
        choreographer.postFrameCallback(frame);
    }

    /** What a press feels like on a TV with no motor to shake: a dry click and a short jolt of light and size. */
    private void feel(int click, float strength) {
        sound.play(click);
        kick = Math.max(kick, strength);
        wake();
    }

    // ---- motion ----------------------------------------------------------------------------------

    /** One frame's worth of everything that moves; false once it has all come to rest. */
    private boolean advance(float dt) {
        // The exact solution of a critically damped spring, not a step towards it: the same path for any frame
        // length, velocity kept across key presses, so quick presses blend into one glide.
        float error = x - target;
        float temp = (velocity + OMEGA * error) * dt;
        float decay = (float) Math.exp(-OMEGA * dt);
        velocity = (velocity - OMEGA * temp) * decay;
        x = target + (error + temp) * decay;
        boolean moving = Math.abs(x - target) > 0.0008f || Math.abs(velocity) > 0.004f;
        if (!moving) {
            x = target;
            velocity = 0f;
            if (!cards.isEmpty()) {
                // Keep the numbers small; the row is a loop, so a whole turn changes nothing on screen.
                int turns = Math.floorDiv(target, cards.size()) * cards.size();
                target -= turns;
                x = target;
            }
        }
        boolean busy = moving;
        energy = approach(energy, Math.min(1f, Math.abs(velocity) / 3f), 14f, dt);
        if (energy > 0.002f) busy = true;
        else energy = 0f;
        kick = approach(kick, 0f, 9f, dt);
        if (kick > 0.004f) busy = true;
        else kick = 0f;

        if (reveal < 1f) {
            reveal = Math.min(1f, reveal + dt / (opening ? OPENING_SECONDS : 0.42f));
            if (reveal >= 1f) opening = false;
            busy = true;
        }
        if (nameFade < 1f) {
            nameFade = Math.min(1f, nameFade + dt / 0.2f);
            busy = true;
        }
        if (ribbonFade < 1f) {
            ribbonFade = Math.min(1f, ribbonFade + dt / 0.2f);
            busy = true;
        }

        float pageGoal = zone == ZONE_RECENTS ? 1f : 0f;
        float pageError = page - pageGoal;
        float pageTemp = (pageVelocity + PAGE_OMEGA * pageError) * dt;
        float pageDecay = (float) Math.exp(-PAGE_OMEGA * dt);
        pageVelocity = (pageVelocity - PAGE_OMEGA * pageTemp) * pageDecay;
        page = pageGoal + (pageError + pageTemp) * pageDecay;
        if (Math.abs(page - pageGoal) > 0.0008f || Math.abs(pageVelocity) > 0.004f) {
            busy = true;
        } else {
            page = pageGoal;
            pageVelocity = 0f;
        }
        float ribbonError = ribbon - ribbonTarget;
        float ribbonTemp = (ribbonVelocity + OMEGA * ribbonError) * dt;
        float ribbonDecay = (float) Math.exp(-OMEGA * dt);
        ribbonVelocity = (ribbonVelocity - OMEGA * ribbonTemp) * ribbonDecay;
        ribbon = ribbonTarget + (ribbonError + ribbonTemp) * ribbonDecay;
        if (Math.abs(ribbon - ribbonTarget) > 0.0008f || Math.abs(ribbonVelocity) > 0.004f) {
            busy = true;
        } else {
            ribbon = ribbonTarget;
            ribbonVelocity = 0f;
        }
        float ribbonGoal = zone == ZONE_RECENTS && isFocused() ? 1f : 0f;
        ribbonFocus = approach(ribbonFocus, ribbonGoal, 13f, dt);
        if (Math.abs(ribbonFocus - ribbonGoal) > 0.002f) busy = true;
        else ribbonFocus = ribbonGoal;
        float cardsGoal = zone == ZONE_CARDS && isFocused() ? 1f : 0f;
        float searchGoal = zone == ZONE_SEARCH ? 1f : 0f;
        float micGoal = zone == ZONE_MIC ? 1f : 0f;
        float pressGoal = okDown && !okLongFired ? 1f : 0f;
        cardsFocus = approach(cardsFocus, cardsGoal, 13f, dt);
        searchFocus = approach(searchFocus, searchGoal, 16f, dt);
        micFocus = approach(micFocus, micGoal, 16f, dt);
        press = approach(press, pressGoal, 26f, dt);
        if (Math.abs(cardsFocus - cardsGoal) > 0.002f || Math.abs(searchFocus - searchGoal) > 0.002f
                || Math.abs(micFocus - micGoal) > 0.002f || Math.abs(press - pressGoal) > 0.002f) {
            busy = true;
        } else {
            cardsFocus = cardsGoal;
            searchFocus = searchGoal;
            micFocus = micGoal;
            press = pressGoal;
        }
        updateCue();
        return moveBlobs(dt) || busy;
    }

    /** It leaves with Home, faster than the rest, and it is stronger while the search bar, the step before it, has focus. */
    private void updateCue() {
        if (cue == null) return;
        float ease = 1f - (1f - reveal) * (1f - reveal) * (1f - reveal);
        float turned = page * page * (3f - 2f * page);
        cue.setAlpha(ease * Math.max(0f, 1f - turned * 3f));
        cue.setTranslationY(-turned * 300f * u);
        cue.setLevel(0.72f + 0.28f * Math.max(searchFocus, micFocus));
    }

    /**
     * The focus marks are drops of liquid: going to the next stop, the leading edge runs ahead and the trailing edge
     * catches up, so the mark stretches on the way and draws back together on arrival.
     */
    private boolean moveBlobs(float dt) {
        boolean busy = false;
        boolean inBar = zone == ZONE_SEARCH || zone == ZONE_MIC;
        if (inBar) {
            float goalL = zone == ZONE_MIC ? micCircle.left : pill.left + 5f * u;
            float goalR = zone == ZONE_MIC ? micCircle.right : micCircle.left - 6f * u;
            boolean rightward = goalR > barR;
            barL = approach(barL, goalL, rightward ? 13f : 30f, dt);
            barR = approach(barR, goalR, rightward ? 30f : 13f, dt);
            if (Math.abs(barL - goalL) > 0.3f * u || Math.abs(barR - goalR) > 0.3f * u) busy = true;
            else {
                barL = goalL;
                barR = goalR;
            }
        }
        float barGoal = inBar ? 1f : 0f;
        barAlpha = approach(barAlpha, barGoal, 18f, dt);
        if (Math.abs(barAlpha - barGoal) > 0.004f) busy = true;
        else barAlpha = barGoal;

        boolean inTop = zone >= ZONE_TOP;
        if (inTop) {
            float center = TOP_X[zone - ZONE_TOP] * u, r = TOP_R * u;
            boolean rightward = center + r > topR;
            topL = approach(topL, center - r, rightward ? 13f : 30f, dt);
            topR = approach(topR, center + r, rightward ? 30f : 13f, dt);
            if (Math.abs(topL - center + r) > 0.3f * u || Math.abs(topR - center - r) > 0.3f * u) busy = true;
            else {
                topL = center - r;
                topR = center + r;
            }
        }
        float topGoal = inTop ? 1f : 0f;
        topAlpha = approach(topAlpha, topGoal, 18f, dt);
        if (Math.abs(topAlpha - topGoal) > 0.004f) busy = true;
        else topAlpha = topGoal;
        return busy;
    }

    private static float approach(float value, float goal, float rate, float dt) {
        return value + (goal - value) * (1f - (float) Math.exp(-rate * dt));
    }

    private void move(int by) {
        if (zone == ZONE_RECENTS) {
            moveRibbon(by);
            return;
        }
        if (cards.isEmpty() || by == 0) return;
        target += by;
        String next = currentCard().entry.label;
        if (!next.equals(name)) {
            previousName = name;
            name = next;
            nameFade = 0f;
        }
        feel(GallerySound.TICK, 1f);
    }

    private void moveRibbon(int by) {
        int next = Math.max(0, Math.min(recents.size() - 1, ribbonTarget + by));
        if (next == ribbonTarget) return;
        ribbonTarget = next;
        ribbonOldTitle = ribbonTitle;
        ribbonOldLine = ribbonLine;
        ribbonFade = 0f;
        readRibbonText();
        feel(GallerySound.TICK, 1f);
    }

    private void setZone(int next) {
        if (zone == next) return;
        boolean wasBar = zone == ZONE_SEARCH || zone == ZONE_MIC;
        boolean wasTop = zone >= ZONE_TOP;
        if ((next == ZONE_SEARCH || next == ZONE_MIC) && !wasBar) {
            // The drop grows out of the middle of where it is going.
            float m = next == ZONE_MIC ? micCircle.centerX() : (pill.left + micCircle.left) / 2f;
            barL = m;
            barR = m;
        }
        if (next >= ZONE_TOP && !wasTop) {
            float m = TOP_X[next - ZONE_TOP] * u;
            topL = m;
            topR = m;
        }
        zone = next;
        feel(GallerySound.SOFT, 0.55f);
    }

    @Override
    protected void onFocusChanged(boolean gainFocus, int direction, Rect previouslyFocusedRect) {
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect);
        if (!gainFocus) {
            stopHold();
            okDown = false;
        }
        wake();
    }

    private void stopHold() {
        holdDirection = 0;
        removeCallbacks(holdRepeat);
    }

    // ---- remote ----------------------------------------------------------------------------------

    /**
     * Keys while the gallery has focus. A held arrow repeats from here, not from Android, so the row spins at the
     * same pace whether or not the remote's key helper is filtering keys.
     */
    boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = event.getAction() == KeyEvent.ACTION_UP;
        boolean first = down && event.getRepeatCount() == 0;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT: {
                int direction = code == KeyEvent.KEYCODE_DPAD_RIGHT ? 1 : -1;
                if (zone == ZONE_CARDS || zone == ZONE_RECENTS) {
                    if (first) {
                        move(direction);
                        holdDirection = direction;
                        removeCallbacks(holdRepeat);
                        postDelayed(holdRepeat, HOLD_FIRST_MS);
                    } else if (up) {
                        stopHold();
                    }
                } else if (first) {
                    if (zone == ZONE_SEARCH || zone == ZONE_MIC) {
                        setZone(direction > 0 ? ZONE_MIC : ZONE_SEARCH);
                    } else {
                        int next = Math.max(TOP_INPUTS, Math.min(TOP_SETTINGS, zone - ZONE_TOP + direction));
                        setZone(ZONE_TOP + next);
                    }
                }
                return true;
            }
            case KeyEvent.KEYCODE_DPAD_UP:
                if (first) {
                    if (zone == ZONE_CARDS) setZone(ZONE_TOP + TOP_SETTINGS);
                    else if (zone == ZONE_SEARCH || zone == ZONE_MIC) setZone(ZONE_CARDS);
                    else if (zone == ZONE_RECENTS) setZone(ZONE_SEARCH);
                    // Up once more at the top pulls the Control Center down out of the Island.
                    else if (zone >= ZONE_TOP) HomeKeyService.openControlCenter();
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (first) {
                    if (zone == ZONE_CARDS) setZone(ZONE_SEARCH);
                    else if (zone >= ZONE_TOP) setZone(ZONE_CARDS);
                    else if ((zone == ZONE_SEARCH || zone == ZONE_MIC) && !recents.isEmpty()) setZone(ZONE_RECENTS);
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                if (first) {
                    okDown = true;
                    okLongFired = false;
                    removeCallbacks(longPress);
                    if (zone == ZONE_CARDS) postDelayed(longPress, LONG_PRESS_MS);
                    wake();
                } else if (up) {
                    removeCallbacks(longPress);
                    boolean fire = okDown && !okLongFired;
                    okDown = false;
                    if (fire) activate();
                    wake();
                }
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (up) {
                    if (zone != ZONE_CARDS) setZone(ZONE_CARDS);
                    else onHomePressedOnHome();
                }
                return true;
            default:
                return false;
        }
    }

    /**
     * A tap, which on a TV is the Orbit phone app's pointer (its Cursor mode): a button at the top, the search pill or its
     * mic is that button; the middle card opens as OK opens it; another card turns the row to it. Only on the first page,
     * at rest; anything else is taken and ignored, so a tap never reaches what is drawn under it by mistake.
     */
    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
            touchX = e.getX();
            touchY = e.getY();
            return true;
        }
        if (e.getActionMasked() != MotionEvent.ACTION_UP) return true;
        // A swipe is the pointer's scroll, which Home has nothing for: not a tap where it ended.
        if (Math.hypot(e.getX() - touchX, e.getY() - touchY) <= 24f * u) tapAt(e.getX(), e.getY());
        return true;
    }

    /**
     * The phone's pointer clicked here (PointerCursor calls this directly: on a TV without a touch screen Android drops
     * the accessibility service's taps). Taken and ignored where nothing is.
     */
    void tapAt(float tx, float ty) {
        if (page > 0.05f || opening) return;
        requestFocus();
        for (int i = 0; i < TOP_X.length; i++) {
            if (Math.hypot(tx - TOP_X[i] * u, ty - TOP_Y * u) <= TOP_R * 1.35f * u) {
                setZone(ZONE_TOP + i);
                activate();
                return;
            }
        }
        float pillHalfW = PILL_W * u / 2f, pillHalfH = PILL_H * u / 2f;
        if (Math.abs(ty - PILL_Y * u) <= pillHalfH && Math.abs(tx - cx) <= pillHalfW) {
            setZone(tx >= cx + pillHalfW - 2f * pillHalfH ? ZONE_MIC : ZONE_SEARCH);
            activate();
            return;
        }
        if (cards.isEmpty() || Math.abs(ty - cy) > HALF_H * FOCAL * (1f + LIFT) * 1.15f * u) return;
        int middle = Math.round(x);
        for (int o = 0; o <= 4; o++) {
            for (int side = o == 0 ? 1 : -1; side <= 1; side += 2) {
                int slot = middle + side * o;
                if (!slotHolds(slot, tx)) continue;
                setZone(ZONE_CARDS);
                if (slot == target) activate();
                else move(slot - target);
                return;
            }
        }
    }

    /** Whether this slot's card covers the screen column tx, at rest: drawSlot's outline without the motion in it. */
    private boolean slotHolds(int slot, float tx) {
        float d = slot - x, theta = d * STEP;
        if (Math.abs(theta) > 1.32f) return false;
        float w = HALF_W * (1f + LIFT * (float) Math.exp(-d * d * 3.2f));
        float sin = (float) Math.sin(theta), cos = (float) Math.cos(theta);
        float zLeft = cos + w * sin, zRight = cos - w * sin;
        if (zLeft < 0.06f || zRight < 0.06f) return false;
        float f = FOCAL * u;
        return tx >= cx + f * (sin - w * cos) / zLeft && tx <= cx + f * (sin + w * cos) / zRight;
    }

    private void activate() {
        feel(GallerySound.SELECT, 1f);
        if (zone == ZONE_RECENTS) {
            if (recents.isEmpty()) return;
            float halfW = RIBBON_HALF_W * RIBBON_FOCAL * (1f + RIBBON_LIFT) * u;
            float halfH = RIBBON_HALF_H * RIBBON_FOCAL * (1f + RIBBON_LIFT) * u;
            float middle = RIBBON_Y * u;
            RecentVideos.Item item = recents.get(ribbonTarget);
            AppOpening opening = HomeKeyService.opening();
            Runnable open = () -> host.onGalleryRecent(item, ActivityOptions.makeCustomAnimation(getContext(), 0, 0));
            if (opening == null || item.art == null || !opening.begin(this, item.art, item.pkg, open)) {
                host.onGalleryRecent(item, ActivityOptions.makeScaleUpAnimation(this, Math.round(cx - halfW),
                        Math.round(middle - halfH), Math.round(halfW * 2), Math.round(halfH * 2)));
            }
        } else if (zone == ZONE_SEARCH) {
            host.onGallerySearch(false);
        } else if (zone == ZONE_MIC) {
            host.onGallerySearch(true);
        } else if (zone >= ZONE_TOP) {
            host.onGalleryTopButton(zone - ZONE_TOP);
        } else if (!cards.isEmpty()) {
            // The app grows out of its card: our own way forward where the helper is there to keep it on top, else Android's.
            GalleryArt.Card card = currentCard();
            AppOpening opening = HomeKeyService.opening();
            Runnable open = () -> host.onGalleryLaunch(card.entry, ActivityOptions.makeCustomAnimation(getContext(), 0, 0).toBundle());
            if (opening == null || !opening.begin(this, card, card.entry.pkg, open)) {
                float halfW = HALF_W * FOCAL * (1f + LIFT) * u, halfH = HALF_H * FOCAL * (1f + LIFT) * u;
                Bundle options = ActivityOptions.makeScaleUpAnimation(this, Math.round(cx - halfW), Math.round(cy - halfH),
                        Math.round(halfW * 2), Math.round(halfH * 2)).toBundle();
                host.onGalleryLaunch(card.entry, options);
            }
        }
    }

    // ---- layout ----------------------------------------------------------------------------------

    @Override
    protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        super.onSizeChanged(w, h, oldW, oldH);
        u = w / 1280f;
        cx = w / 2f;
        cy = CENTER_Y * u;
        float cardHalf = HALF_H * FOCAL * (1f + LIFT) * u;
        scanTop = cy - cardHalf - 20f * u;
        scanBottom = cy + cardHalf + 12f * u;

        datePaint.setTextSize(17f * u);
        namePaint.setTextSize(34f * u);
        hintPaint.setTextSize(19.5f * u);
        blobRim.setStrokeWidth(1.4f * u);
        iconPaint.setStrokeWidth(2.1f * u);
        dustNear.setStrokeWidth(2.6f * u);
        dustFar.setStrokeWidth(1.7f * u);
        recentTitlePaint.setTextSize(31f * u);
        recentLinePaint.setTextSize(18.5f * u);
        readRibbonText();

        float pillTop = PILL_Y * u - PILL_H * u / 2f;
        pill.set(cx - PILL_W * u / 2f, pillTop, cx + PILL_W * u / 2f, pillTop + PILL_H * u);
        float inset = 6f * u, side = PILL_H * u - inset * 2f;
        micCircle.set(pill.right - inset - side, pill.top + inset, pill.right - inset, pill.bottom - inset);
        barGlowDst.set(cx - 200f * u, pill.top - 17f * u, cx + 200f * u, pill.top + 17f * u);

        linePaint.setShader(new LinearGradient(0, scanTop, 0, scanBottom,
                new int[]{0x00FFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0x00FFFFFF},
                new float[]{0f, 0.1f, 0.5f, 0.9f, 1f}, Shader.TileMode.CLAMP));

        buildIcons();
        float glowW = 1180f * u, glowH = 680f * u;
        glowDst.set(cx - glowW / 2f, cy - glowH / 2f, cx + glowW / 2f, cy + glowH / 2f);
        float bloomH = (scanBottom - scanTop) * 1.34f, middle = (scanTop + scanBottom) / 2f;
        bloomDst.set(cx - 84f * u, middle - bloomH / 2f, cx + 84f * u, middle + bloomH / 2f);
        float icon = 25f * u;
        for (int i = 0; i < 3; i++) {
            int ix = Math.round(TOP_X[i] * u), iy = Math.round(TOP_Y * u), half = Math.round(icon / 2f);
            topIcons[i].setBounds(ix - half, iy - half, ix + half, iy + half);
        }

        headlineKey = "";
        refreshTexts();
        final int barW = Math.round(pill.width()), barH = Math.round(pill.height()), orb = Math.round(TOP_R * u * 2f);
        final float wordSize = 70f * u;
        final Context ctx = getContext();
        new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY);
            Bitmap wordOne = GalleryArt.word(ctx, "Continue", wordSize);
            Bitmap wordTwo = GalleryArt.word(ctx, "Watching", wordSize);
            Bitmap room = GalleryArt.roomMask(ROOM_W, ROOM_H);
            RuntimeShader roomMade = GalleryArt.roomShader(room);
            RuntimeShader bloomMade = GalleryArt.tintShader(GalleryArt.bloomMask(BLOOM_W, BLOOM_H));
            RuntimeShader barGlowMade = GalleryArt.tintShader(GalleryArt.barGlowMask(BAR_GLOW_W, BAR_GLOW_H));
            Bitmap bar = GalleryArt.glass(barW, barH, barH / 2f);
            Bitmap round = GalleryArt.glass(orb, orb, orb / 2f);
            main.post(() -> {
                wordContinue = wordOne;
                wordWatching = wordTwo;
                roomShader = roomMade;
                bloomShader = bloomMade;
                barGlowShader = barGlowMade;
                barGlass = bar;
                orbGlass = round;
                roomPaint.setShader(roomShader);
                invalidate();
            });
        }, "gallery-room").start();
    }

    private void buildIcons() {
        searchIcon.reset();
        float sy = pill.centerY(), sx = pill.left + 30f * u, r = 8f * u;
        searchIcon.addCircle(sx, sy - 1f * u, r, Path.Direction.CW);
        searchIcon.moveTo(sx + r * 0.72f, sy - 1f * u + r * 0.72f);
        searchIcon.lineTo(sx + r * 1.5f, sy - 1f * u + r * 1.5f);

        micIcon.reset();
        float mx = micCircle.centerX(), my = micCircle.centerY();
        float capsuleW = 5.2f * u, capsuleTop = my - 11.5f * u, capsuleBottom = my + 2.8f * u;
        micIcon.addRoundRect(mx - capsuleW, capsuleTop, mx + capsuleW, capsuleBottom, capsuleW, capsuleW, Path.Direction.CW);
        float arc = 9.2f * u;
        micIcon.moveTo(mx - arc, my - 2f * u);
        micIcon.cubicTo(mx - arc, my + 12f * u, mx + arc, my + 12f * u, mx + arc, my - 2f * u);
        micIcon.moveTo(mx, my + 8.6f * u);
        micIcon.lineTo(mx, my + 12.4f * u);
    }

    // ---- drawing ---------------------------------------------------------------------------------

    /** The light follows the row: between two apps it is on its way from one app's colour to the other's. */
    private void updateAccent() {
        if (cards.isEmpty()) {
            setAccent(FALLBACK_ACCENT, FALLBACK_ACCENT, FALLBACK_ACCENT, FALLBACK_ACCENT, 0f);
            return;
        }
        int n = cards.size();
        int whole = (int) Math.floor(x);
        float t = x - whole;
        t = t * t * (3f - 2f * t);
        GalleryArt.Card a = cards.get(Math.floorMod(whole, n)), b = cards.get(Math.floorMod(whole + 1, n));
        setAccent(a.accent, b.accent, a.accent2, b.accent2, t);
        if (festiveDay != null) {
            // Half the app's colour, half the day's: the row still says which app, the room says which day.
            accentR = mix(accentR, Color.red(festiveDay.glow) / 255f, 0.5f);
            accentG = mix(accentG, Color.green(festiveDay.glow) / 255f, 0.5f);
            accentB = mix(accentB, Color.blue(festiveDay.glow) / 255f, 0.5f);
            accent2R = mix(accent2R, Color.red(festiveDay.glow2) / 255f, 0.6f);
            accent2G = mix(accent2G, Color.green(festiveDay.glow2) / 255f, 0.6f);
            accent2B = mix(accent2B, Color.blue(festiveDay.glow2) / 255f, 0.6f);
            accentInt = Color.rgb(Math.round(accentR * 255f), Math.round(accentG * 255f), Math.round(accentB * 255f));
        }
    }

    /** Below Home the light takes the colours of the videos instead, the same way, and it turns over as the page does. */
    private void leanAccentToRibbon() {
        if (page > 0.001f && !recents.isEmpty()) {
            int whole = Math.max(0, Math.min(recents.size() - 1, (int) Math.floor(ribbon)));
            int nextOne = Math.min(recents.size() - 1, whole + 1);
            float t = Math.max(0f, Math.min(1f, ribbon - whole));
            t = t * t * (3f - 2f * t);
            RecentVideos.Item a = recents.get(whole), b = recents.get(nextOne);
            accentR = mix(accentR, mix(Color.red(a.accent), Color.red(b.accent), t) / 255f, page);
            accentG = mix(accentG, mix(Color.green(a.accent), Color.green(b.accent), t) / 255f, page);
            accentB = mix(accentB, mix(Color.blue(a.accent), Color.blue(b.accent), t) / 255f, page);
            accent2R = mix(accent2R, mix(Color.red(a.accent2), Color.red(b.accent2), t) / 255f, page);
            accent2G = mix(accent2G, mix(Color.green(a.accent2), Color.green(b.accent2), t) / 255f, page);
            accent2B = mix(accent2B, mix(Color.blue(a.accent2), Color.blue(b.accent2), t) / 255f, page);
            accentInt = Color.rgb(Math.round(accentR * 255f), Math.round(accentG * 255f), Math.round(accentB * 255f));
        }
        if (cue != null) {
            cue.setColours(accentInt, Color.rgb(Math.round(accent2R * 255f), Math.round(accent2G * 255f), Math.round(accent2B * 255f)));
        }
    }

    private void setAccent(int a, int b, int a2, int b2, float t) {
        accentR = mix(Color.red(a), Color.red(b), t) / 255f;
        accentG = mix(Color.green(a), Color.green(b), t) / 255f;
        accentB = mix(Color.blue(a), Color.blue(b), t) / 255f;
        accent2R = mix(Color.red(a2), Color.red(b2), t) / 255f;
        accent2G = mix(Color.green(a2), Color.green(b2), t) / 255f;
        accent2B = mix(Color.blue(a2), Color.blue(b2), t) / 255f;
        accentInt = Color.rgb(Math.round(accentR * 255f), Math.round(accentG * 255f), Math.round(accentB * 255f));
    }

    private static float mix(float a, float b, float t) {
        return a + (b - a) * t;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (warming) {
            // Hidden under the film: part-way through the opening, twice, and then at rest. A half-faded draw is a different
            // shader from a full one, and each of them would otherwise be made in the middle of the opening itself.
            warming = false;
            opening = true;
            reveal = 0.3f;
            drawHome(c);
            reveal = 0.6f;
            drawHome(c);
            opening = false;
            reveal = 1f;
            drawHome(c);
            reveal = 0f;
            // Back to nothing at all: every frame of the film replays whatever is recorded here.
            postInvalidateOnAnimation();
            return;
        }
        drawHome(c);
    }

    private void drawHome(Canvas c) {
        float ease = 1f - (1f - reveal) * (1f - reveal) * (1f - reveal);
        int alpha = Math.round(255f * ease);
        updateAccent();
        leanAccentToRibbon();

        // After the film: the line alone on black, as the film left it. It flares, the row opens outward from it to both
        // sides, the monochrome half and the colour half, and everything else comes up last.
        float opened = 1f, cardsEase = ease, restEase = ease;
        lineFlare = 0f;
        if (opening) {
            float x0 = Math.min(1f, Math.max(0f, (reveal - 0.1f) / 0.46f));
            opened = 1f - (1f - x0) * (1f - x0) * (1f - x0);
            cardsEase = smooth(0.08f, 0.34f, reveal);
            restEase = smooth(0.44f, 0.92f, reveal);
            float flare = (reveal - 0.24f) / 0.17f;
            lineFlare = (float) Math.exp(-flare * flare);
        }
        drawRoom(c, cardsEase * nightDim);
        drawDust(c, nightDim < 1f ? 0f : restEase);

        float turned = page * page * (3f - 2f * page);
        float homeEase = ease * Math.max(0f, 1f - turned * 1.5f);
        if (homeEase > 0.003f || opening) {
            float restHome = opening ? restEase : homeEase;
            int homeAlpha = Math.round(255f * restHome);
            int save = c.save();
            // Home rises out of the way more slowly than the page comes up: it is further back.
            c.translate(0f, -turned * 300f * u);
            drawHeadline(c, restHome, Math.round(homeAlpha * (0.5f + 0.5f * nightDim)));
            if (!cards.isEmpty()) {
                // Slightly closed at first, then the row opens to its full curve.
                float spread = opening ? 0.72f + 0.28f * opened : 0.86f + 0.14f * ease;
                cardPaint.setAlpha(opening ? Math.round(255f * cardsEase) : homeAlpha);
                int wide = opening && opened < 1f ? c.save() : -1;
                float reachOut = opened * getWidth() / 2f;
                if (wide >= 0) c.clipRect(cx - reachOut, 0f, cx + reachOut, getHeight());
                int middle = Math.round(x);
                drawSlot(c, middle, spread);
                int reach = turned > 0.2f ? 2 : 4;
                for (int o = 1; o <= reach; o++) {
                    drawSlot(c, middle + o, spread);
                    drawSlot(c, middle - o, spread);
                }
                if (wide >= 0) {
                    c.restoreToCount(wide);
                    // two edges of light running out ahead of the row
                    linePaint.setAlpha(Math.round(190f * (1f - opened) * cardsEase));
                    c.drawRect(cx - reachOut - 1.1f * u, scanTop, cx - reachOut + 1.1f * u, scanBottom, linePaint);
                    c.drawRect(cx + reachOut - 1.1f * u, scanTop, cx + reachOut + 1.1f * u, scanBottom, linePaint);
                }
            }
            drawScanLine(c, homeEase);
            drawName(c, restHome);
            drawSearch(c, restHome, homeAlpha);
            drawTopButtons(c, homeAlpha);
            c.restoreToCount(save);
        }
        if (turned > 0.003f) drawRecents(c, turned, ease);
    }

    /**
     * The recent videos, after the owner's reference: the big words come in from both sides, and the row of pictures
     * swings up from below along its arc while the page turns.
     */
    private void drawRecents(Canvas c, float turned, float ease) {
        float rest = 1f - turned;
        int alpha = Math.round(255f * ease * Math.min(1f, turned * 1.5f));
        if (wordContinue != null && wordWatching != null) {
            headlinePaint.setAlpha(alpha);
            c.drawBitmap(wordContinue, cx - 112f * u - wordContinue.getWidth() / 2f - rest * 620f * u, 26f * u, headlinePaint);
            c.drawBitmap(wordWatching, cx + 112f * u - wordWatching.getWidth() / 2f + rest * 620f * u, 92f * u, headlinePaint);
        }
        if (recents.isEmpty()) return;
        float middleY = RIBBON_Y * u + rest * 300f * u;
        float tilt = RIBBON_TILT * (1f + rest * 0.9f);
        int middle = Math.round(ribbon);
        // From the ends in: the one in focus overlaps its neighbours a little.
        for (int o = 3; o >= 1; o--) {
            drawRibbonCard(c, middle - o, middleY, tilt, rest, alpha);
            drawRibbonCard(c, middle + o, middleY, tilt, rest, alpha);
        }
        drawRibbonCard(c, middle, middleY, tilt, rest, alpha);

        float t = ribbonFade * ribbonFade * (3f - 2f * ribbonFade);
        float rise = rest * 60f * u;
        if (t < 1f && !ribbonOldTitle.isEmpty()) {
            recentTitlePaint.setAlpha(Math.round(alpha * (1f - t)));
            recentLinePaint.setAlpha(Math.round(alpha * (1f - t)));
            c.drawText(ribbonOldTitle, cx, RIBBON_TITLE_Y * u - 7f * u * t + rise, recentTitlePaint);
            c.drawText(ribbonOldLine, cx, RIBBON_LINE_Y * u - 7f * u * t + rise, recentLinePaint);
        }
        recentTitlePaint.setAlpha(Math.round(alpha * t));
        recentLinePaint.setAlpha(Math.round(alpha * t));
        c.drawText(ribbonTitle, cx, RIBBON_TITLE_Y * u + 9f * u * (1f - t) + rise, recentTitlePaint);
        c.drawText(ribbonLine, cx, RIBBON_LINE_Y * u + 9f * u * (1f - t) + rise, recentLinePaint);
    }

    private void drawRibbonCard(Canvas c, int slot, float middleY, float tilt, float rest, int alpha) {
        if (slot < 0 || slot >= recents.size()) return;
        RecentVideos.Item item = recents.get(slot);
        if (item.art == null) return;
        float d = slot - ribbon;
        float theta = (d + rest * 2.4f) * RIBBON_STEP;
        if (Math.abs(theta) > 1.25f) return;
        float near = (float) Math.exp(-d * d * 3f);
        float scale = 1f + (RIBBON_LIFT * ribbonFocus + 0.03f * kick) * near - 0.03f * press * near;
        float w = RIBBON_HALF_W * scale, h = RIBBON_HALF_H * scale;
        float sin = (float) Math.sin(theta), cos = (float) Math.cos(theta);
        float xLeft = sin - w * cos, zLeft = cos + w * sin;
        float xRight = sin + w * cos, zRight = cos - w * sin;
        if (zLeft < 0.12f || zRight < 0.12f) return;
        float f = RIBBON_FOCAL * u;
        float sxLeft = cx + f * xLeft / zLeft, sxRight = cx + f * xRight / zRight;
        if (sxRight < 0f || sxLeft > getWidth()) return;
        // Everything nearer than the row's middle drops by how much nearer it is: that is the tilt of the ring.
        float dropLeft = tilt * (1f - zLeft), dropRight = tilt * (1f - zRight);
        dst[0] = sxLeft;
        dst[1] = middleY + f * (dropLeft - h) / zLeft;
        dst[2] = sxRight;
        dst[3] = middleY + f * (dropRight - h) / zRight;
        dst[4] = sxRight;
        dst[5] = middleY + f * (dropRight + h) / zRight;
        dst[6] = sxLeft;
        dst[7] = middleY + f * (dropLeft + h) / zLeft;
        matrix.setPolyToPoly(artSrc, 0, dst, 0, 4);

        int save = c.save();
        c.concat(matrix);
        artPaint.setAlpha(Math.round(alpha * (0.62f + 0.38f * near)));
        c.drawBitmap(item.art, 0f, 0f, artPaint);
        float progress = item.progress();
        float inset = 16f, barTop = RecentVideos.ART_H - 13f;
        if (progress >= 0f) {
            trackPaint.setColor(0x66FFFFFF);
            trackPaint.setAlpha(Math.round(alpha * 0.4f));
            c.drawRect(inset, barTop, RecentVideos.ART_W - inset, barTop + 4f, trackPaint);
            trackPaint.setColor(item.accent);
            trackPaint.setAlpha(alpha);
            c.drawRect(inset, barTop, inset + (RecentVideos.ART_W - inset * 2f) * progress, barTop + 4f, trackPaint);
        }
        float ring = near * ribbonFocus;
        if (ring > 0.01f) {
            rimPaint.setColor(accentInt);
            rimPaint.setAlpha(Math.round(alpha * ring));
            c.drawRoundRect(1.5f, 1.5f, RecentVideos.ART_W - 1.5f, RecentVideos.ART_H - 1.5f,
                    RecentVideos.ART_RADIUS, RecentVideos.ART_RADIUS, rimPaint);
        }
        c.restoreToCount(save);
    }

    private void drawRoom(Canvas c, float ease) {
        if (roomShader == null || ease <= 0f) return;
        float level = ease * (0.60f + 0.07f * energy + 0.09f * kick);
        roomShader.setFloatUniform("left", accent2R, accent2G, accent2B);
        roomShader.setFloatUniform("right", accentR, accentG, accentB);
        roomShader.setFloatUniform("room", ROOM_W, level);
        int save = c.save();
        c.translate(glowDst.left, glowDst.top);
        c.scale(glowDst.width() / ROOM_W, glowDst.height() / ROOM_H);
        c.drawRect(0f, 0f, ROOM_W, ROOM_H, roomPaint);
        c.restoreToCount(save);
    }

    private void drawDust(Canvas c, float ease) {
        if (ease <= 0f) return;
        // The furthest layer: the same scroll moves it least, which is what makes the row read as depth.
        float width = 960f * u, height = 400f * u, left = cx - width / 2f, top = cy - height / 2f;
        for (int i = 0; i < DUST; i += 2) {
            dustNearPts[i] = left + wrap(dustBase[i * 2] - x * 0.022f) * width;
            dustNearPts[i + 1] = top + dustBase[i * 2 + 1] * height;
            dustFarPts[i] = left + wrap(dustBase[i * 2 + 2] - x * 0.009f) * width;
            dustFarPts[i + 1] = top + dustBase[i * 2 + 3] * height;
        }
        dustNear.setColor(accentInt);
        dustFar.setColor(festiveDay != null ? festiveDay.glow2 : accentInt);
        dustNear.setAlpha(Math.round(170f * ease));
        dustFar.setAlpha(Math.round(96f * ease));
        c.drawPoints(dustFarPts, dustFar);
        c.drawPoints(dustNearPts, dustNear);
    }

    private static float wrap(float v) {
        return v - (float) Math.floor(v);
    }

    private void drawHeadline(Canvas c, float ease, int alpha) {
        // The words sit far behind the cards, so they drift a little the other way while the row moves. At rest they
        // sit on whole pixels, which keeps the type sharp.
        float drift = Math.max(-16f, Math.min(16f, -velocity * 4.2f)) * u;
        float rise = (1f - ease) * 12f * u + islandK * 18f * u;
        alpha = Math.round(alpha * (1f - islandK));
        if (headline != null) {
            headlinePaint.setAlpha(alpha);
            c.drawBitmap(headline, Math.round(cx - headline.getWidth() / 2f) + drift, Math.round(22f * u) + rise, headlinePaint);
        }
        datePaint.setAlpha(Math.round(alpha * 0.82f));
        c.drawText(dateLine, cx + drift * 0.6f, 150f * u + rise, datePaint);
    }

    private void drawSlot(Canvas c, int slot, float spread) {
        GalleryArt.Card card = cards.get(Math.floorMod(slot, cards.size()));
        float d = slot - x;
        float theta = d * STEP * spread;
        if (Math.abs(theta) > 1.32f) return;
        float near = (float) Math.exp(-d * d * 3.2f);
        // Liquid: the cards lean into the speed, a little wider and shorter, and settle back as the row slows.
        float squash = Math.min(0.06f, Math.abs(velocity) * 0.011f);
        float scale = 1f + (LIFT * cardsFocus + 0.022f * kick) * near - 0.035f * press * near;
        float w = HALF_W * scale * (1f + squash), h = HALF_H * scale * (1f - squash * 0.45f);
        float sin = (float) Math.sin(theta), cos = (float) Math.cos(theta);

        float xLeft = sin - w * cos, zLeft = cos + w * sin;
        float xRight = sin + w * cos, zRight = cos - w * sin;
        if (zLeft < 0.06f || zRight < 0.06f) return;
        float f = FOCAL * u;
        float sxLeft = cx + f * xLeft / zLeft, sxRight = cx + f * xRight / zRight;
        if (sxRight < 0f || sxLeft > getWidth()) return;
        float hLeft = f * h / zLeft, hRight = f * h / zRight;

        dst[0] = sxLeft;
        dst[1] = cy - hLeft;
        dst[2] = sxRight;
        dst[3] = cy - hRight;
        dst[4] = sxRight;
        dst[5] = cy + hRight;
        dst[6] = sxLeft;
        dst[7] = cy + hLeft;
        matrix.setPolyToPoly(src, 0, dst, 0, 4);

        // Where the screen's centre line falls on this card. Vertical lines stay vertical on a cylinder, so one number
        // says it: the point of the card where x is 0, at -tan(theta) along it.
        float split = GalleryArt.CARD_W * (w - sin / cos) / (2f * w);
        split = Math.max(-4000f, Math.min(4000f, split));
        float shift = Math.max(-card.logoRoom, Math.min(card.logoRoom, -d * LOGO_PARALLAX));
        RuntimeShader s = card.shader;
        s.setFloatUniform("motion", split, shift, x * 1.7f, energy);
        s.setFloatUniform("look", 214f + d * 150f, Math.min(0.30f, Math.abs(d) * 0.085f));
        s.setFloatUniform("light", accentR, accentG, accentB);
        cardPaint.setShader(s);
        int save = c.save();
        c.concat(matrix);
        c.drawRect(0f, 0f, GalleryArt.CARD_W, GalleryArt.CARD_H, cardPaint);
        c.restoreToCount(save);
    }

    /**
     * An app opening, drawn in AppOpening's window over Home. It starts as the very card in the row. Home goes dark behind it,
     * the colour wipes across it through the same glass as the row's line, and it comes forward and stays there with its light
     * behind it, a gloss passing over it, until the app is ready. open 0 to 1 is the way forward, waited the seconds since then.
     */
    void drawOpening(Canvas c, GalleryArt.Card card, float open, float waited) {
        c.drawColor(Color.argb(Math.round(255f * smooth(0f, 0.62f, open)), 0, 0, 0));
        // The app's own colour alone, and a breath of it once the card has arrived.
        setAccent(card.accent, card.accent, card.accent, card.accent, 0f);
        drawRoom(c, smooth(0.1f, 0.5f, open) * (0.62f - 0.22f * smooth(0.5f, 1f, open)));
        float zoom = 1f + OPENING_ZOOM * open + 0.008f * Math.min(waited, 5f);
        float w = HALF_W * (1f + LIFT) * zoom * FOCAL * u, h = HALF_H * (1f + LIFT) * zoom * FOCAL * u;
        float middle = cy + (360f * u - cy) * open;
        RuntimeShader s = card.shader;
        s.setFloatUniform("motion", GalleryArt.CARD_W * (0.5f - 1.25f * open), 0f, x * 1.7f, 0f);
        float sweep = (waited / 1.5f) % 1f;
        s.setFloatUniform("look", 214f + 620f * sweep * sweep, 0f);
        s.setFloatUniform("light", accentR, accentG, accentB);
        cardPaint.setShader(s);
        cardPaint.setAlpha(255);
        int save = c.save();
        c.translate(cx - w, middle - h);
        c.scale(2f * w / GalleryArt.CARD_W, 2f * h / GalleryArt.CARD_H);
        c.drawRect(0f, 0f, GalleryArt.CARD_W, GalleryArt.CARD_H, cardPaint);
        c.restoreToCount(save);
    }

    /** The same for a video from the recents page: its picture comes forward until it fills the screen. */
    void drawOpeningPicture(Canvas c, Bitmap picture, float open, float waited) {
        c.drawColor(Color.argb(Math.round(255f * smooth(0f, 0.62f, open)), 0, 0, 0));
        float startW = RIBBON_HALF_W * RIBBON_FOCAL * (1f + RIBBON_LIFT) * u, startH = RIBBON_HALF_H * RIBBON_FOCAL * (1f + RIBBON_LIFT) * u;
        float grow = 1f + 0.004f * Math.min(waited, 5f);
        float w = (startW + (cx - startW) * open) * grow, h = (startH + (360f * u - startH) * open) * grow;
        float middle = RIBBON_Y * u + (360f * u - RIBBON_Y * u) * open;
        openingDst.set(cx - w, middle - h, cx + w, middle + h);
        c.drawBitmap(picture, null, openingDst, openingPaint);
    }

    private void drawScanLine(Canvas c, float ease) {
        float strength = Math.min(1f, ease * (0.44f + 0.38f * cardsFocus + 0.14f * energy + 0.30f * kick));
        // Straight after the film the line is as bright as the film left it, and only then settles.
        if (opening) strength = Math.max(strength, 1f - smooth(0.46f, 0.96f, reveal));
        float flare = lineFlare;
        if (bloomShader != null) {
            bloomShader.setFloatUniform("tint", accentR, accentG, accentB, Math.min(1f, strength * (1f + flare)));
            bloomPaint.setShader(bloomShader);
            int save = c.save();
            c.scale(1f + 2.4f * flare, 1f + 0.5f * flare, cx, (scanTop + scanBottom) / 2f);
            c.translate(bloomDst.left, bloomDst.top);
            c.scale(bloomDst.width() / BLOOM_W, bloomDst.height() / BLOOM_H);
            c.drawRect(0f, 0f, BLOOM_W, BLOOM_H, bloomPaint);
            c.restoreToCount(save);
        }
        linePaint.setAlpha(Math.round(255f * strength));
        float half = 1.1f * u * (1f + 1.5f * flare);
        int save = c.save();
        c.scale(1f, 1f + 0.34f * flare, cx, (scanTop + scanBottom) / 2f);
        c.drawRect(cx - half, scanTop, cx + half, scanBottom, linePaint);
        c.restoreToCount(save);
    }

    private static float smooth(float from, float to, float v) {
        float t = Math.max(0f, Math.min(1f, (v - from) / (to - from)));
        return t * t * (3f - 2f * t);
    }

    private void drawName(Canvas c, float ease) {
        float base = NAME_Y * u;
        float t = nameFade * nameFade * (3f - 2f * nameFade);
        if (t < 1f && !previousName.isEmpty()) {
            namePaint.setAlpha(Math.round(255f * ease * (1f - t)));
            c.drawText(previousName, cx, base - 7f * u * t, namePaint);
        }
        namePaint.setAlpha(Math.round(255f * ease * t));
        c.drawText(name, cx, base + 9f * u * (1f - t), namePaint);
    }

    private void drawSearch(Canvas c, float ease, int alpha) {
        float focus = Math.max(searchFocus, micFocus);
        float radius = pill.height() / 2f;
        if (barGlass != null) {
            glassPaint.setAlpha(alpha);
            c.drawBitmap(barGlass, pill.left, pill.top, glassPaint);
        }
        if (barGlowShader != null) {
            barGlowShader.setFloatUniform("tint", accentR, accentG, accentB, ease * (0.62f + 0.38f * focus));
            bloomPaint.setShader(barGlowShader);
            int save = c.save();
            c.translate(barGlowDst.left, barGlowDst.top);
            c.scale(barGlowDst.width() / BAR_GLOW_W, barGlowDst.height() / BAR_GLOW_H);
            c.drawRect(0f, 0f, BAR_GLOW_W, BAR_GLOW_H, bloomPaint);
            c.restoreToCount(save);
        }
        if (barAlpha > 0.004f) {
            // The drop of focus: clear glass over the field, solid light over the mic.
            float inner = radius - 5f * u;
            blob.set(barL, pill.top + 5f * u, barR, pill.bottom - 5f * u);
            blobPaint.setColor(mixArgb(0x24FFFFFF, accentInt, micFocus));
            blobPaint.setAlpha(Math.round(Color.alpha(blobPaint.getColor()) * barAlpha * ease));
            c.drawRoundRect(blob, inner, inner, blobPaint);
            blobRim.setColor(accentInt);
            blobRim.setAlpha(Math.round(230f * barAlpha * ease));
            c.drawRoundRect(blob, inner, inner, blobRim);
        }

        iconPaint.setColor(mixArgb(0xFFA4A8AF, 0xFFFFFFFF, searchFocus));
        iconPaint.setAlpha(alpha);
        c.drawPath(searchIcon, iconPaint);
        hintPaint.setColor(mixArgb(0xFF9A9EA6, 0xFFF5F6F8, searchFocus));
        hintPaint.setAlpha(alpha);
        c.drawText(hint, pill.left + 54f * u, pill.centerY() + hintPaint.getTextSize() * 0.35f, hintPaint);

        iconPaint.setColor(mixArgb(0xFFDADDE2, 0xFF08090B, micFocus));
        iconPaint.setAlpha(alpha);
        c.drawPath(micIcon, iconPaint);
    }

    private void drawTopButtons(Canvas c, int alpha) {
        float r = TOP_R * u, y = TOP_Y * u;
        if (orbGlass != null) {
            glassPaint.setAlpha(alpha);
            for (float tx : TOP_X) c.drawBitmap(orbGlass, tx * u - r, y - r, glassPaint);
        }
        if (topAlpha > 0.004f) {
            blob.set(topL, y - r, topR, y + r);
            blobPaint.setColor(Color.WHITE);
            blobPaint.setAlpha(Math.round(255f * topAlpha * (alpha / 255f)));
            c.drawRoundRect(blob, r, r, blobPaint);
        }
        int focused = zone >= ZONE_TOP ? zone - ZONE_TOP : -1;
        for (int i = 0; i < 3; i++) {
            boolean dark = i == focused && topAlpha > 0.5f;
            if (dark != topIconDark[i]) {
                topIconDark[i] = dark;
                topIcons[i].setTint(dark ? 0xFF08090B : Color.WHITE);
            }
            topIcons[i].setAlpha(alpha);
            topIcons[i].draw(c);
        }
    }

    private static int mixArgb(int a, int b, float t) {
        return Color.argb(Math.round(mix(Color.alpha(a), Color.alpha(b), t)), Math.round(mix(Color.red(a), Color.red(b), t)),
                Math.round(mix(Color.green(a), Color.green(b), t)), Math.round(mix(Color.blue(a), Color.blue(b), t)));
    }
}
