package com.gathin.tvhome;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextClock;
import android.widget.TextView;

import java.io.IOException;
import java.util.Calendar;
import java.util.Locale;

/**
 * The gallery Home's screensaver: the owner's S in chrome, turning slowly in the dark, with the time under it and the date
 * and the weather under that. The S is a 20-second film made to loop without a seam (res/raw/ambient_loop, rendered by
 * work/family-room/intro3 with loop=20); only the words are drawn here. No sound.
 */
final class AmbientS implements TextureView.SurfaceTextureListener {

    private final Context context;
    private final FrameLayout root;
    private final TextView date;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable minute = new Runnable() {
        @Override
        public void run() {
            updateDate();
            main.postDelayed(this, 60_000L - System.currentTimeMillis() % 60_000L + 200L);
        }
    };
    private MediaPlayer player;
    private Surface surface;
    private boolean running;

    AmbientS(Context context) {
        this.context = context;
        float u = context.getResources().getDisplayMetrics().heightPixels / 720f;
        root = new FrameLayout(context);
        root.setBackgroundColor(Color.BLACK);
        TextureView video = new TextureView(context);
        video.setOpaque(true);
        video.setSurfaceTextureListener(this);
        root.addView(video, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextClock clock = new TextClock(context);
        clock.setFormat12Hour("h:mm");
        clock.setFormat24Hour("HH:mm");
        clock.setTypeface(context.getResources().getFont(R.font.inter_thin));
        clock.setTextSize(TypedValue.COMPLEX_UNIT_PX, 118f * u);
        clock.setLetterSpacing(-0.02f);
        clock.setIncludeFontPadding(false);
        clock.setTextColor(Color.WHITE);
        // Bright at the top of the figures, a little grey at their foot, like the words of the film.
        clock.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> clock.getPaint().setShader(new LinearGradient(
                0, 0, 0, b - t, 0xFFFFFFFF, 0xFFB9BFCC, Shader.TileMode.CLAMP)));
        FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        at.topMargin = Math.round(452f * u);
        root.addView(clock, at);

        date = new TextView(context);
        date.setTypeface(context.getResources().getFont(R.font.inter_light));
        date.setTextSize(TypedValue.COMPLEX_UNIT_PX, 17f * u);
        date.setLetterSpacing(0.3f);
        date.setTextColor(0xFF8F98A8);
        FrameLayout.LayoutParams under = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        under.topMargin = Math.round(596f * u);
        root.addView(date, under);
        updateDate();
    }

    View view() {
        return root;
    }

    void start() {
        running = true;
        main.post(minute);
        Weather.refresh(context, this::updateDate);
        if (player != null && !player.isPlaying()) player.start();
    }

    void stop() {
        running = false;
        main.removeCallbacks(minute);
        if (player != null) {
            player.release();
            player = null;
        }
        if (surface != null) {
            surface.release();
            surface = null;
        }
    }

    private void updateDate() {
        String line = DateFormat.format(DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEEdMMMM"), Calendar.getInstance()).toString();
        String weather = Weather.text();
        if (!weather.isEmpty()) line += "   ·   " + weather;
        date.setText(line.toUpperCase(Locale.getDefault()));
    }

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
        if (player != null) return;
        surface = new Surface(texture);
        player = new MediaPlayer();
        try (AssetFileDescriptor film = context.getResources().openRawResourceFd(R.raw.ambient_loop)) {
            player.setDataSource(film);
            player.setSurface(surface);
            player.setLooping(true);
            player.setVolume(0f, 0f);
            player.setOnPreparedListener(mp -> {
                if (running) mp.start();
            });
            player.setOnErrorListener((mp, what, extra) -> true);   // then only the words stay, on black
            player.prepareAsync();
        } catch (IOException | RuntimeException noFilm) {
            player.release();
            player = null;
        }
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        stop();
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture texture) {
    }
}
