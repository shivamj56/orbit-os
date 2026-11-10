package com.gathin.tvhome;

import android.service.dreams.DreamService;

/**
 * Screensaver: the launcher's thin clock and date on black, over a slow ambient glow (ClockScene).
 * No network, no images: cheap enough for a 1 GB TV.
 */
public class ClockDream extends DreamService {

    private ClockScene scene;
    /** gallery_home: the owner's S instead of the drifting clock. */
    private AmbientS ambient;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);   // any key wakes the TV back to where it was
        setFullscreen(true);
        setScreenBright(false);
        if (getResources().getBoolean(R.bool.gallery_home)) {
            ambient = new AmbientS(this);
            setContentView(ambient.view());
            return;
        }
        setContentView(R.layout.dream_clock);
        ClockFormat.apply(getWindow().getDecorView(), Config.load(this).clockFormat);
        scene = new ClockScene(getWindow().getDecorView());
        scene.useHomeWallpaper(this);
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        if (ambient != null) ambient.start();
        else scene.start();
    }

    @Override
    public void onDreamingStopped() {
        if (ambient != null) ambient.stop();
        else scene.stop();
        super.onDreamingStopped();
    }

    @Override
    public void onDetachedFromWindow() {
        if (ambient != null) ambient.stop();
        if (scene != null) scene.stop();
        super.onDetachedFromWindow();
    }
}
