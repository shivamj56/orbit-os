package com.gathin.tvhome;

import android.app.ActivityOptions;
import android.content.Context;
import android.os.SystemClock;

import java.util.List;

/**
 * Movie Night, from the remote's TV+ button (the button of the Xiaomi TV+ app, which is gone): Home's light goes low, the
 * film left unfinished carries on where it stopped, and the TV Island keeps notifications to itself until the film is over.
 * It ends when Home is in front again (the film is over, or was left), on the same button, or after four hours.
 */
final class MovieNight {

    private static final long FILM_MS = 40L * 60L * 1000L, LONGEST_MS = 4L * 60L * 60L * 1000L, SETTLE_MS = 20_000L;
    private static boolean on;
    private static long since;

    private MovieNight() {
    }

    static boolean on() {
        if (on && SystemClock.elapsedRealtime() - since > LONGEST_MS) on = false;
        return on;
    }

    static void toggle(Context service) {
        if (on()) end(true);
        else start(service);
    }

    static void start(Context service) {
        on = true;
        since = SystemClock.elapsedRealtime();
        TvIsland island = HomeKeyService.island();
        if (island != null) {
            island.show(new TvIsland.Event("movie", "Movie Night", "Notifications paused until the film ends", 0xFFE9B3FF,
                    TvIsland.ICON_FILM, null, null, 2600L));
        }
        GalleryHomeView home = GalleryHomeView.alive();
        if (home != null) home.setMovieNight(true);
        final Context app = service.getApplicationContext();
        new Thread(() -> {
            List<RecentVideos.Item> items = RecentVideos.readNow(app);
            RecentVideos.Item film = null;
            // A film left part way, the newest first; failing that, whatever played last.
            for (RecentVideos.Item i : items) {
                if (i.duration >= FILM_MS && i.position > 0L && i.position < i.duration * 0.95f) {
                    film = i;
                    break;
                }
            }
            if (film == null && !items.isEmpty()) film = items.get(0);
            if (film != null) RecentVideos.open(app, film, ActivityOptions.makeCustomAnimation(app, android.R.anim.fade_in, 0));
        }, "movie-night").start();
    }

    static void end(boolean say) {
        if (!on) return;
        on = false;
        GalleryHomeView home = GalleryHomeView.alive();
        if (home != null) home.setMovieNight(false);
        TvIsland island = HomeKeyService.island();
        if (say && island != null) {
            island.show(new TvIsland.Event("movie", "Movie Night ended", "Notifications are back", 0xFFE9B3FF,
                    TvIsland.ICON_FILM, null, null, 2200L));
        }
    }

    /** Home is in front again a while after it began: the film is over, or was left. */
    static void onHomeResumed() {
        if (on() && SystemClock.elapsedRealtime() - since > SETTLE_MS) end(true);
    }
}
