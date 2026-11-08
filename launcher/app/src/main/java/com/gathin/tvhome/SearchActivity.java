package com.gathin.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Search on Home. Google TV's own search shows its results on the stock launcher's home screen (docs/TROUBLESHOOTING.md,
 * "Google Assistant is having trouble"), so with that launcher off every search for a film or a show ends in an error.
 * This asks the same question of the apps: the words go straight into the search of an app that takes them from outside,
 * and any other app, or one whose name was typed, is a card that opens it. Speech comes from the same recogniser the
 * Assistant uses, which works without that launcher.
 */
public class SearchActivity extends Activity {

    static final String EXTRA_VOICE = "voice";
    private static final int VOICE_REQUEST = 41;
    private static final String KATNISS = "com.google.android.katniss";
    private static final String GOOGLE_TTS = "com.google.android.tts";

    /**
     * Apps in the order they are offered, what the card says, and the address that does it; all tried on this TV. JioHotstar
     * opens its search page but leaves the box empty. Netflix, Sony LIV and Zee5 have no way in, so they only open.
     */
    private static final String[][] TARGETS = {
            {"com.google.android.youtube.tv", "Results in YouTube", "https://www.youtube.com/results?search_query="},
            {"com.amazon.amazonvideo.livingroom", "Results in Prime Video", "https://app.primevideo.com/search?phrase="},
            {"in.startv.hotstar", "Open its search", "https://www.hotstar.com/in/explore?search_query="},
            {"com.netflix.ninja", "Open app", ""},
            {"com.sonyliv", "Open app", ""},
            {"com.graymatrix.did", "Open app", ""},
    };

    private static final class App {
        String pkg, name;
        Drawable banner;
        Intent launch;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<App> apps = new ArrayList<>();
    private EditText field;
    private LinearLayout row;
    private TextView heading;
    private GallerySound sound;
    private float u;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        u = getResources().getDisplayMetrics().widthPixels / 1280f;
        sound = new GallerySound(this);
        Typeface regular = getResources().getFont(R.font.inter_regular);
        Typeface light = getResources().getFont(R.font.inter_light);

        FrameLayout root = new FrameLayout(this);
        GradientDrawable backdrop = new GradientDrawable();
        backdrop.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        backdrop.setGradientRadius(760f * u);
        backdrop.setGradientCenter(0.5f, 0.22f);
        backdrop.setColors(new int[]{0xFF0B2A3A, 0xFF0A0E1C, 0xFF040507});
        root.setBackground(backdrop);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        field = new EditText(this);
        field.setTypeface(regular);
        field.setTextSize(0, 27f * u);
        field.setTextColor(Color.WHITE);
        field.setHintTextColor(0xFF9CA3AF);
        field.setHint("Search movies, shows and apps");
        field.setSingleLine(true);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        field.setPadding(Math.round(30f * u), 0, Math.round(30f * u), 0);
        field.setGravity(Gravity.CENTER_VERTICAL);
        field.setBackground(glass(36f * u, 0x26FFFFFF, 0x66FFFFFF));
        LinearLayout.LayoutParams fieldSize = new LinearLayout.LayoutParams(Math.round(780f * u), Math.round(72f * u));
        fieldSize.topMargin = Math.round(40f * u);
        column.addView(field, fieldSize);

        heading = new TextView(this);
        heading.setTypeface(light);
        heading.setTextSize(0, 19f * u);
        heading.setTextColor(0xFFB9BDC6);
        heading.setSingleLine(true);
        heading.setEllipsize(TextUtils.TruncateAt.END);
        heading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headingSize = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingSize.topMargin = Math.round(22f * u);
        column.addView(heading, headingSize);

        HorizontalScrollView scroller = new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);
        scroller.setClipToPadding(false);
        scroller.setFocusable(false);
        row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setClipChildren(false);
        row.setClipToPadding(false);
        int side = Math.round(28f * u);
        row.setPadding(side, Math.round(14f * u), side, Math.round(14f * u));
        scroller.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroller.setClipChildren(false);
        column.addView(scroller, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);

        field.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                showResults();
            }
        });
        field.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (actionId == EditorInfo.IME_ACTION_SEARCH || enter) {
                goToResults();
                return true;
            }
            return false;
        });

        new Thread(() -> {
            List<App> found = readApps();
            main.post(() -> {
                apps.clear();
                apps.addAll(found);
                showResults();
            });
        }, "search-apps").start();

        field.requestFocus();
        if (savedInstanceState == null && getIntent().getBooleanExtra(EXTRA_VOICE, false)) listen();
        else showKeyboard();
        showResults();
    }

    @Override
    protected void onDestroy() {
        sound.release();
        super.onDestroy();
    }

    private GradientDrawable glass(float radius, int fill, int line) {
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(radius);
        d.setColor(fill);
        d.setStroke(Math.max(1, Math.round(1.4f * u)), line);
        return d;
    }

    private void showKeyboard() {
        field.post(() -> {
            field.requestFocus();
            InputMethodManager ime = getSystemService(InputMethodManager.class);
            if (ime != null) ime.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    private void hideKeyboard() {
        InputMethodManager ime = getSystemService(InputMethodManager.class);
        if (ime != null) ime.hideSoftInputFromWindow(field.getWindowToken(), 0);
    }

    private void goToResults() {
        if (row.getChildCount() == 0) return;
        hideKeyboard();
        row.getChildAt(0).requestFocus();
    }

    /** The recogniser's own screen listens and hands back the words. Not the chooser: two apps answer this. */
    private void listen() {
        for (String pkg : new String[]{KATNISS, GOOGLE_TTS}) {
            Intent speech = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .setPackage(pkg)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            try {
                startActivityForResult(speech, VOICE_REQUEST);
                return;
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                // The other one, and if neither, the keyboard: it has a mic of its own.
            }
        }
        showKeyboard();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE_REQUEST) return;
        ArrayList<String> words = resultCode == RESULT_OK && data != null
                ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        if (words == null || words.isEmpty() || TextUtils.isEmpty(words.get(0))) {
            showKeyboard();
            return;
        }
        field.setText(words.get(0));
        field.setSelection(field.length());
        field.post(this::goToResults);
    }

    @Override
    public void onBackPressed() {
        // From the results back to the words first, and only then out.
        if (getCurrentFocus() != field && !TextUtils.isEmpty(field.getText())) {
            showKeyboard();
            return;
        }
        super.onBackPressed();
    }

    private List<App> readApps() {
        PackageManager pm = getPackageManager();
        List<App> found = new ArrayList<>();
        Intent leanback = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        for (ResolveInfo info : pm.queryIntentActivities(leanback, 0)) {
            String pkg = info.activityInfo.packageName;
            if (pkg.equals(getPackageName())) continue;
            App app = new App();
            app.pkg = pkg;
            app.name = info.loadLabel(pm).toString();
            Drawable banner = info.activityInfo.loadBanner(pm);
            app.banner = banner != null ? banner : info.loadIcon(pm);
            app.launch = pm.getLeanbackLaunchIntentForPackage(pkg);
            found.add(app);
        }
        return found;
    }

    private App app(String pkg) {
        for (App app : apps) {
            if (app.pkg.equals(pkg)) return app;
        }
        return null;
    }

    private void showResults() {
        String words = field.getText().toString().trim();
        View focused = getCurrentFocus();
        boolean inResults = focused != null && focused != field;
        row.removeAllViews();
        if (words.isEmpty()) {
            heading.setText("Type a name, then press the keyboard's search key");
            return;
        }
        heading.setText("Results for “" + words + "”");
        String lower = words.toLowerCase(Locale.ROOT);
        List<String> shown = new ArrayList<>();
        for (App app : apps) {
            if (app.name.toLowerCase(Locale.ROOT).contains(lower)) {
                row.addView(card(app, "Open", null));
                shown.add(app.pkg);
            }
        }
        for (String[] target : TARGETS) {
            App app = app(target[0]);
            if (app == null || shown.contains(app.pkg)) continue;
            row.addView(card(app, target[1], target[2].isEmpty() ? null : target[2] + Uri.encode(words)));
        }
        if (inResults && row.getChildCount() > 0) row.getChildAt(0).requestFocus();
    }

    private View card(App app, String what, String link) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setFocusable(true);
        card.setClickable(true);
        LinearLayout.LayoutParams cardSize = new LinearLayout.LayoutParams(Math.round(186f * u), ViewGroup.LayoutParams.WRAP_CONTENT);
        cardSize.leftMargin = Math.round(9f * u);
        cardSize.rightMargin = Math.round(9f * u);
        card.setLayoutParams(cardSize);

        FrameLayout picture = new FrameLayout(this);
        picture.setClipToOutline(true);
        picture.setBackground(glass(16f * u, 0x33000000, 0x33FFFFFF));
        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setImageDrawable(app.banner);
        picture.addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        View ring = new View(this);
        ring.setBackground(glass(16f * u, Color.TRANSPARENT, 0xFF19F7E6));
        ring.setVisibility(View.INVISIBLE);
        picture.addView(ring, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        card.addView(picture, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(105f * u)));

        TextView name = new TextView(this);
        name.setTypeface(getResources().getFont(R.font.inter_regular));
        name.setTextSize(0, 18f * u);
        name.setTextColor(Color.WHITE);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setText(app.name);
        LinearLayout.LayoutParams nameSize = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nameSize.topMargin = Math.round(9f * u);
        card.addView(name, nameSize);

        TextView line = new TextView(this);
        line.setTypeface(getResources().getFont(R.font.inter_light));
        line.setTextSize(0, 14.5f * u);
        line.setTextColor(0xFF9CA3AF);
        line.setSingleLine(true);
        line.setText(what);
        card.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        card.setOnFocusChangeListener((v, hasFocus) -> {
            ring.setVisibility(hasFocus ? View.VISIBLE : View.INVISIBLE);
            float scale = hasFocus ? 1.08f : 1f;
            v.animate().scaleX(scale).scaleY(scale).setDuration(140L).start();
            if (hasFocus) sound.play(GallerySound.TICK);
        });
        card.setOnClickListener(v -> {
            sound.play(GallerySound.SELECT);
            open(app, link);
        });
        return card;
    }

    private void open(App app, String link) {
        Intent intent = link != null
                ? new Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(app.pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                : app.launch;
        if (intent == null) return;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
            finish();
        } catch (ActivityNotFoundException | SecurityException refused) {
            if (app.launch == null) return;
            try {
                startActivity(app.launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                finish();
            } catch (ActivityNotFoundException | SecurityException alsoRefused) {
                // The card stays; there is nothing else to try.
            }
        }
    }
}
