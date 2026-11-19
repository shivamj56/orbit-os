package com.gathin.tvhome;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/**
 * The end of a trial (TrialMode): a few seconds that say what happens next, then the TV's own home screen. OK, Back
 * or the time running out all go there. Nothing here changes the TV: what comes next is chosen on the phone.
 */
public final class TrialEndActivity extends Activity {
    private static final long STAY_MS = 10_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::tick;
    private TextView leaving;
    private long leaveAt;
    private boolean left;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TrialMode.markOver(this);
        float dp = getResources().getDisplayMetrics().density;
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF090C16);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.START);
        int width = Math.min(getResources().getDisplayMetrics().widthPixels - Math.round(96 * dp), Math.round(640 * dp));

        TextView brand = text(R.string.font_medium, 15, 0xFF74D1FF);
        brand.setText(getString(R.string.app_name).toUpperCase(Locale.ROOT));
        brand.setLetterSpacing(0.16f);
        column.addView(brand);
        TextView title = text(R.string.font_light, 44, 0xFFFFFFFF);
        title.setText(R.string.trial_end_title);
        column.addView(title, spaced(10, dp));
        TextView body = text(R.string.font_regular, 21, 0xE6FFFFFF);
        body.setText(R.string.trial_end_body);
        body.setLineSpacing(0, 1.25f);
        column.addView(body, spaced(18, dp));
        TextView next = text(R.string.font_regular, 19, 0xA6FFFFFF);
        next.setText(R.string.trial_end_next);
        next.setLineSpacing(0, 1.25f);
        column.addView(next, spaced(14, dp));
        leaving = text(R.string.font_medium, 17, 0xFF74D1FF);
        column.addView(leaving, spaced(30, dp));

        root.addView(column, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(root);
    }

    private TextView text(int font, float sp, int color) {
        TextView t = new TextView(this);
        t.setTypeface(UiFont.get(this, font));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        return t;
    }

    private static LinearLayout.LayoutParams spaced(int top, float dp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = Math.round(top * dp);
        return lp;
    }

    @Override
    protected void onResume() {
        super.onResume();
        leaveAt = SystemClock.elapsedRealtime() + STAY_MS;
        tick();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
        // Home, or another app over this screen: the TV is the person's again, so this one is done.
        if (!isFinishing()) finish();
    }

    private void tick() {
        long ms = leaveAt - SystemClock.elapsedRealtime();
        if (ms <= 0) {
            leave();
            return;
        }
        leaving.setText(getString(R.string.trial_end_leaving, (int) ((ms + 999) / 1000)));
        handler.postDelayed(tick, TrialMode.nextTick(ms));
    }

    private void leave() {
        if (left) return;
        left = true;
        handler.removeCallbacks(tick);
        TrialMode.openTvHome(this);
        finish();
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                leave();
                return true;
            default:
                return super.onKeyUp(keyCode, event);
        }
    }

    @Override
    public void onBackPressed() {
        leave();
    }
}
