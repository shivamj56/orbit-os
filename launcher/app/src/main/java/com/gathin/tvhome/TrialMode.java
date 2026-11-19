package com.gathin.tvhome;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/**
 * Trying Orbit before setting it up (phone/SPEC.md, "Trying Orbit before setting it up"). The phone installs Orbit
 * Home as an ordinary app and starts it with {@link #EXTRA_SECONDS} (setup/tv/orbit-setup.sh, cmd_trial). The TV's
 * own home screen stays Home, so the remote's Home button goes back to it at any time. While the trial is on, Home
 * shows how long is left at its foot ({@link Pill}). When the time is up it says what comes next
 * ({@link TrialEndActivity}), opens the TV's own home screen and closes. Opened again later from the TV's list of
 * apps, it only says that again: what happens next is chosen on the phone.
 *
 * <p>The setup itself ends a trial for good: it starts Home with {@link #EXTRA_SET_UP}. Orbit Home becoming the TV's
 * Home ends it too, whichever way that happened.
 */
final class TrialMode {
    private static final String TAG = "TrialMode";

    /** The trial's length in seconds; starts a trial. Sent with {@link #EXTRA_ID}. */
    static final String EXTRA_SECONDS = "dev.shiv.orbit.home.extra.TRIAL_SECONDS";
    /** Which start of a trial this is: the same intent delivered again (Android restarting the app) does not start
     *  the trial over. */
    static final String EXTRA_ID = "dev.shiv.orbit.home.extra.TRIAL_ID";
    /** The phone's "End the trial now". */
    static final String EXTRA_END = "dev.shiv.orbit.home.extra.TRIAL_END";
    /** Sent by the setup's own starts of Home: Orbit stays, so a trial is over for good. */
    static final String EXTRA_SET_UP = "dev.shiv.orbit.home.extra.SET_UP";

    static final long MIN_MS = 60_000L;
    static final long MAX_MS = 60L * 60_000L;
    static final long DEFAULT_MS = 15L * 60_000L;

    private static final String PREFS = "orbit_trial";
    private static final String KEY_ID = "id";
    private static final String KEY_UNTIL = "until";
    private static final String KEY_LENGTH = "length";
    private static final String KEY_OVER = "over";

    enum State { NONE, ON, OVER }

    private TrialMode() {}

    // ---- the arithmetic (plain, for the JVM tests) ----

    /** The length asked for, in ms: a minute to an hour, and 15 minutes when nothing sensible was asked. */
    static long lengthOf(int seconds) {
        if (seconds <= 0) return DEFAULT_MS;
        return Math.max(MIN_MS, Math.min(MAX_MS, seconds * 1000L));
    }

    /** What is left of a trial of {@code length} ms that ends at {@code until}, at {@code now} (both on the wall
     *  clock). A clock set back cannot make it longer than it was. */
    static long remaining(long until, long length, long now) {
        if (until <= 0 || length <= 0) return 0;
        return Math.max(0, Math.min(length, until - now));
    }

    /** "14:59": the minutes and seconds left, rounded up, so the last second shows 0:01 and the end 0:00. */
    static String clock(long ms, Locale locale) {
        long s = (Math.max(0, ms) + 999) / 1000;
        return String.format(locale, "%d:%02d", s / 60, s % 60);
    }

    /** The next tick: on the next whole second of what is left, so the clock never skips one. */
    static long nextTick(long left) {
        long part = left % 1000;
        return part == 0 ? 1000 : part;
    }

    // ---- the trial on this TV ----

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Where the trial stands, after what {@code intent} says. SET_UP, or Orbit Home being the TV's Home, ends a trial
     * for good. A new TRIAL_ID with TRIAL_SECONDS starts one, and TRIAL_END ends the one that is on. Without a trial
     * this is NONE, and Home is Home as ever.
     */
    static State read(Context ctx, Intent intent) {
        SharedPreferences p = prefs(ctx);
        if (intent != null && intent.getBooleanExtra(EXTRA_SET_UP, false)) {
            clear(p);
            return State.NONE;
        }
        if (intent != null && intent.hasExtra(EXTRA_SECONDS)) {
            String id = String.valueOf(intent.getStringExtra(EXTRA_ID));
            if (!id.equals(p.getString(KEY_ID, null))) {
                long length = lengthOf(intent.getIntExtra(EXTRA_SECONDS, 0));
                p.edit().putString(KEY_ID, id).putLong(KEY_LENGTH, length)
                        .putLong(KEY_UNTIL, System.currentTimeMillis() + length).putBoolean(KEY_OVER, false).commit();
            }
        }
        if (!p.contains(KEY_UNTIL)) return State.NONE;
        if (isHome(ctx)) {
            clear(p);
            return State.NONE;
        }
        if (intent != null && intent.getBooleanExtra(EXTRA_END, false)) markOver(ctx);
        return p.getBoolean(KEY_OVER, false) || left(ctx) <= 0 ? State.OVER : State.ON;
    }

    /** The ms left of the trial that is on (0 without one). */
    static long left(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return remaining(p.getLong(KEY_UNTIL, 0), p.getLong(KEY_LENGTH, 0), System.currentTimeMillis());
    }

    static void markOver(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (p.contains(KEY_UNTIL) && !p.getBoolean(KEY_OVER, false)) p.edit().putBoolean(KEY_OVER, true).commit();
    }

    private static void clear(SharedPreferences p) {
        if (!p.getAll().isEmpty()) p.edit().clear().commit();
    }

    /** Orbit Home is the TV's Home: set up, not tried. */
    static boolean isHome(Context ctx) {
        ResolveInfo home = ctx.getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
        return home != null && home.activityInfo != null && ctx.getPackageName().equals(home.activityInfo.packageName);
    }

    /** The TV's own home screen, as the remote's Home button opens it (the setup's trial made sure it is Home). */
    static void openTvHome(Context ctx) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(home);
        } catch (RuntimeException e) {
            Log.w(TAG, "the TV's own home screen did not open", e);
        }
    }

    // ---- the pill on Home ----

    /** "Trying Orbit · 14:59 left", at the foot of Home while a trial is on. It counts while Home is in front, and
     *  calls {@code over} when the time is up. It never takes focus: the remote moves through Home as ever. */
    static final class Pill {
        private final Activity activity;
        private final LinearLayout view;
        private final TextView time;
        private final Runnable over;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Runnable tick = this::tick;

        Pill(Activity activity, ViewGroup root, Runnable over) {
            this.activity = activity;
            this.over = over;
            float dp = activity.getResources().getDisplayMetrics().density;
            view = new LinearLayout(activity);
            view.setOrientation(LinearLayout.HORIZONTAL);
            view.setGravity(Gravity.CENTER_VERTICAL);
            view.setFocusable(false);
            view.setPadding(Math.round(20 * dp), Math.round(9 * dp), Math.round(20 * dp), Math.round(9 * dp));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(0xE00B1020);
            bg.setCornerRadius(999f);
            bg.setStroke(Math.max(1, Math.round(dp)), 0x40FFFFFF);
            view.setBackground(bg);
            time = text(activity, R.string.font_medium, 17, 0xFFFFFFFF);
            TextView hint = text(activity, R.string.font_regular, 15, 0xB3FFFFFF);
            hint.setText(R.string.trial_pill_hint);
            View dot = new View(activity);
            GradientDrawable round = new GradientDrawable();
            round.setShape(GradientDrawable.OVAL);
            round.setColor(0xFF74D1FF);
            dot.setBackground(round);
            int d = Math.round(7 * dp);
            LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(d, d);
            dotLp.setMarginEnd(Math.round(11 * dp));
            view.addView(dot, dotLp);
            view.addView(time);
            LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            hintLp.setMarginStart(Math.round(16 * dp));
            view.addView(hint, hintLp);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            lp.bottomMargin = Math.round(24 * dp);
            root.addView(view, lp);
        }

        private static TextView text(Context ctx, int font, float sp, int color) {
            TextView t = new TextView(ctx);
            t.setTypeface(UiFont.get(ctx, font));
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
            t.setTextColor(color);
            t.setSingleLine(true);
            t.setFocusable(false);
            return t;
        }

        /** Home is in front: count from now. */
        void resume() {
            handler.removeCallbacks(tick);
            tick();
        }

        /** Home went behind: nothing to count on screen. */
        void pause() {
            handler.removeCallbacks(tick);
        }

        void remove() {
            pause();
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
        }

        private void tick() {
            long left = left(activity);
            if (left <= 0) {
                over.run();
                return;
            }
            time.setText(activity.getString(R.string.trial_pill, clock(left, Locale.getDefault())));
            handler.postDelayed(tick, nextTick(left));
        }
    }
}
