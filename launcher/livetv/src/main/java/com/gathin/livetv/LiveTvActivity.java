package com.gathin.livetv;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Live TV: free Hindi channels from their own broadcasters, full screen. Up and Down change the channel (the banner
 * shows the next one at once, the stream follows when the presses stop), OK opens the guide, numbers type a channel,
 * and the last channel comes back next time. A stream that fails or stalls hands over to the channel's next one; when
 * none plays the banner says so instead of spinning. Pay channels have no free stream and open in their own app.
 *
 * Its media session tells Home what is on: the Control Center's Now Playing shows the channel (next and previous change
 * it), Home during a channel brings the apps shelf over it, and recents bring it back on the same channel.
 */
@OptIn(markerClass = UnstableApi.class)
public final class LiveTvActivity extends Activity implements GuideView.Listener {

    /** The channel to open on (its id from channels.json), e.g. from the Control Center's Bhakti card. */
    public static final String EXTRA_CHANNEL = "channel";

    private static final long ZAP_SETTLE_MS = 450L, DIGITS_MS = 1500L, FIRST_STALL_MS = 15_000L, STALL_MS = 12_000L;
    /** The daily list and the check wait until the first channel has settled: they share the TV's slow CPU and line. */
    private static final long BACK_AGAIN_MS = 2200L, REFRESH_DELAY_MS = 25_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private List<Channels.Channel> channels = new ArrayList<>();
    private SharedPreferences prefs;
    private AspectFrame frame;
    private SurfaceView surface;
    private GuideView guide;
    private ExoPlayer player;
    private MediaSession session;

    private int current = -1, pending = -1, previous = -1;
    private int attempt, pass;
    private boolean readyOnce, started;
    private long backAt;
    private String typed = "";
    private final Map<String, DefaultHttpDataSource.Factory> sources = new HashMap<>();

    private final Runnable tunePending = () -> {
        if (pending >= 0) tune(pending);
    };
    private final Runnable stalled = () -> failed();
    private final Runnable typedDone = this::typedChannel;
    private final Runnable retry = this::playStream;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("livetv", MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        frame = new AspectFrame(this);
        surface = new SurfaceView(this);
        frame.addView(surface, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(frame, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        guide = new GuideView(this, this);
        root.addView(guide, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        channels = Channels.load(this);
        guide.setChannels(channels);
        current = startIndex(getIntent());
        if (current >= 0) Channels.loadLogos(this, channels.subList(current, current + 1));
        new Thread(() -> {
            Channels.loadLogos(this, channels);
            main.post(guide::invalidate);
        }, "logos").start();

        session = new MediaSession(this, "LiveTV");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                resume();
            }

            @Override
            public void onPause() {
                pause();
            }

            @Override
            public void onSkipToNext() {
                zap(1, true);
            }

            @Override
            public void onSkipToPrevious() {
                zap(-1, true);
            }

            @Override
            public void onStop() {
                finish();
            }
        });
    }

    /** The channel asked for, else the last one watched, else the first that is not a pay channel. */
    private int startIndex(Intent intent) {
        String want = intent == null ? null : intent.getStringExtra(EXTRA_CHANNEL);
        int at = indexOf(want);
        if (at < 0) at = indexOf(prefs.getString("last", null));
        if (at < 0) at = step(-1, 1);
        return at;
    }

    private int indexOf(String id) {
        if (id == null) return -1;
        for (int i = 0; i < channels.size(); i++) {
            Channels.Channel ch = channels.get(i);
            if (ch.id.equals(id) && !ch.paid()) return i;
        }
        return -1;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        int at = indexOf(intent.getStringExtra(EXTRA_CHANNEL));
        if (at >= 0 && at != current && player != null) {
            guide.closeGuide();
            tune(at);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
        makePlayer();
        if (current >= 0) tune(current);
        session.setActive(true);
        main.postDelayed(this::refresh, REFRESH_DELAY_MS);
    }

    /** Away from Live TV (Home, another app, standby): the stream stops, so no data and no decoder are kept busy. */
    @Override
    protected void onStop() {
        started = false;
        main.removeCallbacksAndMessages(null);
        releasePlayer();
        sessionState(PlaybackState.STATE_STOPPED);
        session.setActive(false);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        session.release();
        super.onDestroy();
    }

    // ---- the player ------------------------------------------------------------------------------

    private void makePlayer() {
        if (player != null) return;
        DefaultTrackSelector tracks = new DefaultTrackSelector(this);
        // The panel is 1280 x 720: take the stream nearest that size, not a bigger one the TV only shrinks.
        tracks.setParameters(tracks.buildUponParameters()
                .setViewportSizeToPhysicalDisplaySize(this, true)
                .setPreferredAudioLanguage("hi")
                .build());
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                // Start after one second of picture, keep 15 to 30 s in hand, at most 24 MB (a low-memory TV).
                .setBufferDurationsMs(15_000, 30_000, 1_000, 2_500)
                .setTargetBufferBytes(24 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();
        player = new ExoPlayer.Builder(this, new DefaultRenderersFactory(this).setEnableDecoderFallback(true))
                .setTrackSelector(tracks)
                .setLoadControl(load)
                .build();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setVideoSurfaceView(surface);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    main.removeCallbacks(stalled);
                } else if (state == Player.STATE_BUFFERING) {
                    main.removeCallbacks(stalled);
                    main.postDelayed(stalled, readyOnce ? STALL_MS : FIRST_STALL_MS);
                } else if (state == Player.STATE_ENDED) {
                    // A live stream that "ends" has lost its feed: try again from the live edge.
                    failed();
                }
                sessionState(playbackState());
            }

            @Override
            public void onRenderedFirstFrame() {
                readyOnce = true;
                main.removeCallbacks(stalled);
                pass = 0;
                Format f = player == null ? null : player.getVideoFormat();
                if (current >= 0) {
                    // It plays, so whatever the last check said, it is on air.
                    channels.get(current).offAir = false;
                    channels.get(current).checkFailed = false;
                    guide.invalidate();
                    guide.banner(channels.get(current), GuideView.LIVE);
                    if (f != null) guide.setQuality(f.height);
                }
            }

            @Override
            public void onVideoSizeChanged(VideoSize size) {
                if (size.width > 0 && size.height > 0) frame.setAspect(size.width * size.pixelWidthHeightRatio / size.height);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                sessionState(playbackState());
            }

            @Override
            public void onPlayerError(PlaybackException e) {
                if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
                    // Fell behind the live window (a long stall): back to the live edge, same stream.
                    player.seekToDefaultPosition();
                    player.prepare();
                    return;
                }
                failed();
            }
        });
    }

    private void releasePlayer() {
        if (player == null) return;
        player.release();
        player = null;
    }

    private int playbackState() {
        if (player == null) return PlaybackState.STATE_STOPPED;
        if (player.getPlaybackState() == Player.STATE_BUFFERING) return PlaybackState.STATE_BUFFERING;
        if (player.getPlaybackState() == Player.STATE_IDLE) return PlaybackState.STATE_STOPPED;
        return player.getPlayWhenReady() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
    }

    /** Puts the channel on: its first stream, the banner saying so, the session telling Home. */
    private void tune(int index) {
        if (index < 0 || index >= channels.size()) return;
        Channels.Channel ch = channels.get(index);
        main.removeCallbacks(tunePending);
        pending = -1;
        if (ch.paid()) {
            openApp(ch);
            return;
        }
        if (index != current) previous = current;
        current = index;
        prefs.edit().putString("last", ch.id).apply();
        guide.setPlaying(current);
        attempt = 0;
        pass = 0;
        readyOnce = false;
        guide.banner(ch, GuideView.CONNECTING);
        sessionMetadata(ch);
        playStream();
    }

    private void playStream() {
        if (player == null || current < 0) return;
        Channels.Channel ch = channels.get(current);
        if (ch.streams.isEmpty()) {
            offAir(ch);
            return;
        }
        Channels.Stream s = ch.streams.get(Math.min(attempt, ch.streams.size() - 1));
        MediaItem item = new MediaItem.Builder()
                .setUri(s.url)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                // Catch up gently after a stall instead of jumping: at most 2% faster than real time.
                .setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setMaxPlaybackSpeed(1.02f).setMinPlaybackSpeed(0.98f).build())
                .build();
        player.setMediaSource(new HlsMediaSource.Factory(source(s)).setAllowChunklessPreparation(true).createMediaSource(item));
        player.prepare();
        player.play();
        main.removeCallbacks(stalled);
        main.postDelayed(stalled, FIRST_STALL_MS);
    }

    /** One HTTP factory per kind of stream (its own referrer and user agent), kept for the next time. */
    private DefaultHttpDataSource.Factory source(Channels.Stream s) {
        String key = s.referrer + "\n" + s.userAgent;
        DefaultHttpDataSource.Factory f = sources.get(key);
        if (f != null) return f;
        f = new DefaultHttpDataSource.Factory()
                .setUserAgent(s.userAgent != null ? s.userAgent : Channels.UA)
                .setConnectTimeoutMs(8000)
                .setReadTimeoutMs(8000)
                .setAllowCrossProtocolRedirects(true);
        if (s.referrer != null) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Referer", s.referrer);
            f.setDefaultRequestProperties(headers);
        }
        sources.put(key, f);
        return f;
    }

    /** This stream did not play (an error, or a stall too long): the channel's next one, then all of them once more. */
    private void failed() {
        main.removeCallbacks(stalled);
        if (player == null || current < 0) return;
        Channels.Channel ch = channels.get(current);
        if (!online()) {
            player.stop();
            guide.banner(ch, GuideView.NO_NET);
            sessionState(PlaybackState.STATE_ERROR);
            main.removeCallbacks(retry);
            main.postDelayed(retry, 10_000L);
            return;
        }
        attempt++;
        if (attempt < ch.streams.size()) {
            playStream();
            return;
        }
        if (pass == 0) {
            pass = 1;
            attempt = 0;
            main.removeCallbacks(retry);
            main.postDelayed(retry, 2500L);
            return;
        }
        offAir(ch);
    }

    private void offAir(Channels.Channel ch) {
        ch.offAir = true;
        if (player != null) player.stop();
        guide.banner(ch, GuideView.OFF_AIR);
        guide.invalidate();
        sessionState(PlaybackState.STATE_ERROR);
    }

    private boolean online() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        return cm == null || cm.getActiveNetwork() != null;
    }

    private void pause() {
        if (player == null) return;
        player.pause();
        if (current >= 0) guide.banner(channels.get(current), GuideView.PAUSED);
        sessionState(PlaybackState.STATE_PAUSED);
    }

    /** Back to live: a paused live stream picks up at the live edge, not where it stopped. */
    private void resume() {
        if (player == null || current < 0) return;
        if (player.getPlaybackState() == Player.STATE_IDLE) {
            tune(current);
            return;
        }
        player.seekToDefaultPosition();
        player.play();
        guide.banner(channels.get(current), GuideView.LIVE);
    }

    // ---- changing the channel --------------------------------------------------------------------

    /** The next channel up or down that has a free stream and answered the last check. */
    private int step(int from, int dir) {
        int n = channels.size();
        if (n == 0) return -1;
        int at = from;
        for (int k = 0; k < n; k++) {
            at = Math.floorMod(at + dir, n);
            Channels.Channel ch = channels.get(at);
            if (!ch.paid() && !ch.offAir) return at;
        }
        // Everything off air (no internet): plain next, so the keys still move.
        at = from;
        for (int k = 0; k < n; k++) {
            at = Math.floorMod(at + dir, n);
            if (!channels.get(at).paid()) return at;
        }
        return -1;
    }

    /** Up/Down: the banner names the next channel at once; it is tuned when the presses stop. */
    private void zap(int dir, boolean now) {
        int from = pending >= 0 ? pending : current;
        int next = step(from, dir);
        if (next < 0) return;
        if (now) {
            tune(next);
            return;
        }
        pending = next;
        guide.banner(channels.get(next), GuideView.ZAPPING);
        main.removeCallbacks(tunePending);
        main.postDelayed(tunePending, ZAP_SETTLE_MS);
    }

    private void typedChannel() {
        String t = typed;
        typed = "";
        guide.digits("");
        int want;
        try {
            want = Integer.parseInt(t);
        } catch (NumberFormatException none) {
            return;
        }
        for (int i = 0; i < channels.size(); i++) {
            if (channels.get(i).num == want) {
                tune(i);
                return;
            }
        }
        guide.toast("There is no channel " + want);
    }

    private void openApp(Channels.Channel ch) {
        Intent go = getPackageManager().getLeanbackLaunchIntentForPackage(ch.app);
        if (go == null) go = getPackageManager().getLaunchIntentForPackage(ch.app);
        if (go == null) {
            guide.toast(ch.appName + " is not on this TV. It is in the Play Store");
            return;
        }
        try {
            startActivity(go.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException gone) {
            guide.toast(ch.appName + " did not open");
        }
    }

    @Override
    public void onPick(int index) {
        guide.closeGuide();
        if (index == current && player != null && player.getPlaybackState() != Player.STATE_IDLE) {
            guide.banner(channels.get(current), readyOnce ? GuideView.LIVE : GuideView.CONNECTING);
            return;
        }
        tune(index);
    }

    // ---- the remote ------------------------------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        int code = e.getKeyCode();
        if (guide.guideOpen()) {
            if (guide.guideKey(code)) return true;
            return super.dispatchKeyEvent(e);
        }
        if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
            if (typed.length() >= 2) typed = "";
            typed += (char) ('0' + code - KeyEvent.KEYCODE_0);
            guide.digits(typed);
            main.removeCallbacks(typedDone);
            main.postDelayed(typedDone, typed.length() >= 2 ? 300L : DIGITS_MS);
            return true;
        }
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
                zap(1, false);
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                zap(-1, false);
                return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                zap(1, true);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                zap(-1, true);
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (pending >= 0) {
                    tune(pending);
                } else if (guide.bannerShown() && guide.bannerState() == GuideView.PAUSED) {
                    resume();
                } else {
                    guide.openGuide();
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_GUIDE:
                guide.openGuide();
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_INFO:
                if (current >= 0) {
                    Channels.Channel ch = channels.get(current);
                    guide.banner(ch, ch.offAir ? GuideView.OFF_AIR : readyOnce ? GuideView.LIVE : GuideView.CONNECTING);
                }
                return true;
            case KeyEvent.KEYCODE_LAST_CHANNEL:
                if (previous >= 0) tune(previous);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (player != null && player.getPlayWhenReady()) pause(); else resume();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                pause();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                resume();
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (pending >= 0) {
                    // Changed the mind while zapping: stay on what is playing.
                    main.removeCallbacks(tunePending);
                    pending = -1;
                    if (current >= 0) guide.banner(channels.get(current), readyOnce ? GuideView.LIVE : GuideView.CONNECTING);
                    return true;
                }
                // Twice to leave, so a stray press never drops the news halfway.
                long now = SystemClock.uptimeMillis();
                if (now - backAt < BACK_AGAIN_MS) {
                    finish();
                    return true;
                }
                backAt = now;
                if (current >= 0) guide.banner(channels.get(current), GuideView.EXIT);
                return true;
            default:
                return super.dispatchKeyEvent(e);
        }
    }

    // ---- what Home is told -----------------------------------------------------------------------

    private void sessionMetadata(Channels.Channel ch) {
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, ch.name)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Live TV · " + ch.group)
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, "livetv:" + ch.id);
        Bitmap art = sessionArt(ch);
        if (art != null) md.putBitmap(MediaMetadata.METADATA_KEY_ART, art);
        session.setMetadata(md.build());
        Intent back = new Intent(this, LiveTvActivity.class).putExtra(EXTRA_CHANNEL, ch.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        session.setSessionActivity(PendingIntent.getActivity(this, 1, back,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    }

    /** A plain copy of the logo: a GPU-only bitmap cannot travel to Home's process. */
    private static Bitmap sessionArt(Channels.Channel ch) {
        if (ch.logo == null) return null;
        try {
            return ch.logo.copy(Bitmap.Config.ARGB_8888, false);
        } catch (RuntimeException noCopy) {
            return null;
        }
    }

    private void sessionState(int state) {
        if (session == null) return;
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, state == PlaybackState.STATE_PLAYING ? 1f : 0f)
                .build());
    }

    // ---- the daily list --------------------------------------------------------------------------

    private void refresh() {
        if (!started) return;
        List<Channels.Channel> snapshot = new ArrayList<>(channels);
        Thread t = new Thread(() -> {
            Channels.Update u = Channels.refresh(this, snapshot);
            if (u == null) return;
            main.post(() -> {
                u.apply(channels);
                guide.setChannels(channels);
            });
        }, "livetv-refresh");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    /** The picture at its own shape, centred: 4:3 channels get bars at the sides instead of being stretched. */
    static final class AspectFrame extends FrameLayout {
        private float aspect = 16f / 9f;

        AspectFrame(android.content.Context c) {
            super(c);
        }

        void setAspect(float a) {
            if (a <= 0f || Math.abs(a - aspect) < 0.01f) return;
            aspect = a;
            requestLayout();
        }

        @Override
        protected void onMeasure(int widthSpec, int heightSpec) {
            int w = MeasureSpec.getSize(widthSpec), h = MeasureSpec.getSize(heightSpec);
            if (w > 0 && h > 0) {
                if (w / (float) h > aspect) w = Math.round(h * aspect); else h = Math.round(w / aspect);
            }
            super.onMeasure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY));
        }
    }
}
