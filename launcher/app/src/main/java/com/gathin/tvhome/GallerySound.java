package com.gathin.tvhome;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

/**
 * What the remote feels like. This TV has no vibration motor and neither has its remote (`cmd vibrator_manager list`
 * says "No vibrator found"), so each action answers with a short, dry click instead, the way a well-made switch does.
 * The sounds are synthesised, a few KB each, and follow the TV's volume. config.xml gallery_sounds turns them off.
 */
final class GallerySound {
    static final int TICK = 0, SELECT = 1, SOFT = 2, DETENT = 3;

    private static final float[] GAIN = {0.50f, 0.74f, 0.50f, 0.42f};

    private final SoundPool pool;
    private final int[] ids = new int[4];
    private final boolean enabled;

    GallerySound(Context context) {
        enabled = context.getResources().getBoolean(R.bool.gallery_sounds);
        pool = new SoundPool.Builder().setMaxStreams(4).setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()).build();
        if (!enabled) return;
        ids[TICK] = pool.load(context, R.raw.gs_tick, 1);
        ids[SELECT] = pool.load(context, R.raw.gs_select, 1);
        ids[SOFT] = pool.load(context, R.raw.gs_soft, 1);
        ids[DETENT] = pool.load(context, R.raw.gs_detent, 1);
    }

    void play(int sound) {
        if (!enabled) return;
        float gain = GAIN[sound];
        pool.play(ids[sound], gain, gain, 1, 0, 1f);
    }

    void release() {
        pool.release();
    }
}
