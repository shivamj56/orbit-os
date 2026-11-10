package com.gathin.tvhome;

import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.FrameLayout;
import android.widget.ImageView;

import java.io.IOException;
import java.util.function.Consumer;

/**
 * The owner's film, the first time Home comes up after each restart. It begins exactly where the stock boot animation ends.
 * That animation stays up until Home first draws, so Home does not draw until the film stands decoded on its first frame:
 * the logo keeps turning instead of freezing, and when it fades it fades into the same picture, already about to move. The
 * film ends on the line Home opens from. Any key skips it. Keyed on the boot count like Open on start and noted before it
 * plays, so that a crash in here cannot bring it back on every Home.
 *
 * <p>A TextureView and not a SurfaceView: on this TV the video layer has its own picture processing, which shows black as
 * grey, while a TextureView goes through the same path as the rest of Home. It also lets the picture dissolve into Home.
 */
final class BootIntro implements TextureView.SurfaceTextureListener, ViewTreeObserver.OnPreDrawListener {

    private static final String BOOT_KEY = "intro_boot";
    /** Long after a restart, the first Home of that boot is not the TV starting: the film would only be in the way. */
    private static final long LATEST_AFTER_BOOT_MS = 3L * 60L * 1000L;
    /** Where the picture starts handing over to Home. The sound rings on under Home to the end of the file. */
    private static final int LEAVE_AT_MS = 5640;
    /** The same for the short one on waking (res/raw/wake_sting): the film's last moments, so the line is left at 1.52 s. */
    private static final int WAKE_LEAVE_AT_MS = 1520;
    private static final long LEAVE_FADE_MS = 260L, SKIP_FADE_MS = 240L, WATCH_MS = 20L;
    /** The stock animation waits for Home's first draw, and that waits for the film, but not for ever. */
    private static final long LONGEST_HOLD_MS = 5000L;
    /** From Home's first frame to the stock animation's own fade being nearly over: the film starts moving under its last of it. */
    private static final long LOGO_FADE_MS = 550L;
    /** Should the decoder never start, Home must not stay hidden behind a still picture. */
    private static final long GIVE_UP_MS = 16000L;

    private final Activity activity;
    private final Consumer<Boolean> onLeaving;
    private final int film, leaveAtMs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable giveUp = this::stop;
    private final Runnable startFilm = this::startFilm;
    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            if (player == null || leaving) return;
            int position = player.getCurrentPosition();
            if (!shown && position > 0) {
                shown = true;
                main.removeCallbacks(giveUp);
            }
            if (position >= leaveAtMs) {
                leave(LEAVE_FADE_MS, false);
                return;
            }
            main.postDelayed(this, WATCH_MS);
        }
    };

    private GalleryHomeView home;
    private View decor;
    private FrameLayout cover;
    private ImageView still;
    private SurfaceTexture texture;
    private MediaPlayer player;
    private Surface surface;
    private ValueAnimator fade;
    private boolean prepared, frameReady, holding, logoGone, startWhenReady, started, shown, leaving;
    private long shownAt;

    /** The film, if this boot has not had it yet, already getting ready; null otherwise. {@code onLeaving} runs when Home should start to show: true when the film ran to its end. */
    static BootIntro ifDue(Activity activity, Consumer<Boolean> onLeaving) {
        int boot = OpenOnStart.boot(activity);
        if (boot < 0) return null;
        SharedPreferences prefs = activity.getSharedPreferences(OpenOnStart.BOOT_PREFS, Context.MODE_PRIVATE);
        if (prefs.getInt(BOOT_KEY, -1) == boot) return null;
        if (!prefs.edit().putInt(BOOT_KEY, boot).commit()) return null;
        if (SystemClock.elapsedRealtime() > LATEST_AFTER_BOOT_MS) return null;
        BootIntro intro = new BootIntro(activity, onLeaving);
        intro.prepare();
        return intro;
    }

    /** The short one, when the TV wakes up on Home: the S flashes up and runs back into the line Home opens from. */
    static BootIntro forWake(Activity activity, Consumer<Boolean> onLeaving, GalleryHomeView home) {
        BootIntro intro = new BootIntro(activity, onLeaving, R.raw.wake_sting, WAKE_LEAVE_AT_MS);
        intro.prepare();
        intro.show(home);
        return intro;
    }

    private BootIntro(Activity activity, Consumer<Boolean> onLeaving) {
        this(activity, onLeaving, R.raw.boot_intro, LEAVE_AT_MS);
    }

    private BootIntro(Activity activity, Consumer<Boolean> onLeaving, int film, int leaveAtMs) {
        this.activity = activity;
        this.onLeaving = onLeaving;
        this.film = film;
        this.leaveAtMs = leaveAtMs;
    }

    /** Starts on the film at once, before Home has any views: the decoder is the slow part, and it needs no window. */
    private void prepare() {
        texture = new SurfaceTexture(false);
        // Replaced by the view's own listener when it first draws; by then this has done its one job.
        texture.setOnFrameAvailableListener(t -> onFirstFrame(), main);
        surface = new Surface(texture);
        player = new MediaPlayer();
        try (AssetFileDescriptor file = activity.getResources().openRawResourceFd(film)) {
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build());
            player.setDataSource(file);
            player.setSurface(surface);
            player.setOnPreparedListener(mp -> {
                prepared = true;
                // A seek before the start brings the decoder up, shows the first frame and stays paused there, so that the
                // start itself is immediate.
                if (startWhenReady) startFilm();
                else mp.seekTo(0);
            });
            player.setOnInfoListener((mp, what, extra) -> {
                if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) hideStill();
                return false;
            });
            player.setOnCompletionListener(mp -> stop());
            player.setOnErrorListener((mp, what, extra) -> {
                stop();
                return true;
            });
            player.prepareAsync();
        } catch (IOException | RuntimeException noFilm) {
            stop();
        }
    }

    /** Over Home, once Home's views exist. At boot Home's first draw now waits for the film. */
    void show(GalleryHomeView home) {
        if (leaving || cover != null) return;
        this.home = home;
        shownAt = SystemClock.elapsedRealtime();
        cover = new FrameLayout(activity);
        cover.setBackgroundColor(Color.BLACK);
        // The fade at the end then costs no full-screen buffer. Under the film's last frames, black with a line, it looks the same.
        cover.forceHasOverlappingRendering(false);
        TextureView video = new TextureView(activity);
        video.setOpaque(true);
        video.setSurfaceTextureListener(this);
        video.setSurfaceTexture(texture);
        ViewGroup.LayoutParams fill = new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        cover.addView(video, new FrameLayout.LayoutParams(fill));
        activity.addContentView(cover, fill);
        decor = activity.getWindow().getDecorView();
        main.postDelayed(giveUp, GIVE_UP_MS);
        if (bootFinished()) {
            logoGone = true;
            if (frameReady) startFilm();
        } else {
            holding = true;
            decor.getViewTreeObserver().addOnPreDrawListener(this);
        }
    }

    private void onFirstFrame() {
        if (frameReady || player == null) return;
        frameReady = true;
        if (logoGone) startFilm();
    }

    /** Asked before each frame while Home has not drawn yet. Every "not yet" keeps the stock animation on the screen. */
    @Override
    public boolean onPreDraw() {
        if (!leaving && holding) {
            long now = SystemClock.elapsedRealtime();
            boolean homeReady = home != null && home.readyToOpen();
            if (now - shownAt < LONGEST_HOLD_MS && !(frameReady && homeReady)) return false;
            holding = false;
            // Home's first real frame, hidden under the film, and the film itself not quite opaque for that one frame, as it
            // will be while it fades: what the hand-over needs is made now, under the logo, and not at the hand-over.
            if (homeReady) {
                home.warmUp();
                cover.setAlpha(0.99f);
            }
            if (!frameReady) {
                // The decoder is late: the same picture as a still, one traversal later.
                still = new ImageView(activity);
                still.setScaleType(ImageView.ScaleType.FIT_XY);
                still.setImageResource(R.drawable.boot_intro_first);
                cover.addView(still, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                return false;
            }
        }
        decor.getViewTreeObserver().removeOnPreDrawListener(this);
        if (leaving) return true;
        decor.getViewTreeObserver().registerFrameCommitCallback(() -> {
            logoGone = true;
            if (cover != null && !leaving) cover.setAlpha(1f);
            main.postDelayed(startFilm, LOGO_FADE_MS);
        });
        return true;
    }

    private void startFilm() {
        if (player == null || leaving || started) return;
        if (!prepared) {
            startWhenReady = true;
            return;
        }
        started = true;
        player.start();
        main.post(watch);
    }

    private void hideStill() {
        if (still == null || cover == null) return;
        cover.removeView(still);
        still = null;
    }

    /** The film is still in front: keys are its to take, and Home stays asleep underneath. */
    boolean covering() {
        return cover != null && !leaving;
    }

    /** Any key, or Home pressed: cut to Home, with the sound fading out rather than ringing on. */
    void skip() {
        if (covering()) leave(SKIP_FADE_MS, true);
    }

    /** A pause before the film has moved is only the system settling after boot; after it, something else has come in front. */
    void onHomePaused() {
        if (shown) stop();
    }

    /** Everything goes, at once. Safe to call more than once. */
    void stop() {
        main.removeCallbacks(giveUp);
        main.removeCallbacks(watch);
        main.removeCallbacks(startFilm);
        holding = false;
        if (decor != null && decor.getViewTreeObserver().isAlive()) decor.getViewTreeObserver().removeOnPreDrawListener(this);
        if (fade != null) {
            fade.removeAllListeners();
            fade.cancel();
            fade = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (surface != null) {
            surface.release();
            surface = null;
        }
        if (cover != null) {
            ViewGroup parent = (ViewGroup) cover.getParent();
            if (parent != null) parent.removeView(cover);
            cover = null;
        }
        if (!leaving) {
            leaving = true;
            onLeaving.accept(false);
        }
    }

    private void leave(long fadeMs, boolean silence) {
        leaving = true;
        holding = false;
        main.removeCallbacks(giveUp);
        main.removeCallbacks(watch);
        main.removeCallbacks(startFilm);
        onLeaving.accept(!silence);
        if (cover == null) return;
        fade = ValueAnimator.ofFloat(1f, 0f).setDuration(fadeMs);
        fade.addUpdateListener(a -> {
            float v = (float) a.getAnimatedValue();
            cover.setAlpha(v);
            if (silence && player != null) player.setVolume(v, v);
        });
        fade.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator animation) {
                fade = null;
                // Kept in place but not drawn while the sound rings on: the player still holds its surface.
                if (silence || player == null) stop();
                else cover.setVisibility(View.INVISIBLE);
            }
        });
        fade.start();
    }

    /** Set by the system once the boot animation has gone. If it cannot be read, nothing is gained by waiting. */
    private static boolean bootFinished() {
        try {
            return "1".equals(Class.forName("android.os.SystemProperties").getMethod("get", String.class)
                    .invoke(null, "sys.boot_completed"));
        } catch (ReflectiveOperationException | RuntimeException cannotTell) {
            return true;
        }
    }

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture texture) {
        // Once the view has drawn, the frame listener set in prepare() is its own: a frame reaches here instead.
        onFirstFrame();
        hideStill();
    }
}
