package com.gathin.tvhome;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RuntimeShader;
import android.graphics.Shader;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Choreographer;
import android.view.View;

import androidx.annotation.RequiresApi;

/**
 * The one arrow under the search bar: there is more below. It keeps falling and fading, with the colours of Home's light
 * flowing through it. It is its own small view on purpose: this is the only thing that moves on an idle Home, and this way
 * a frame of it redraws this little patch and not the whole gallery. It runs at half the panel's rate for the same reason.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class ScrollCue extends View {

    /** A design size, in a 1280 x 720 screen. */
    static final int VIEW_W = 96, VIEW_H = 60;
    private static final float WIDE = 44f, TALL = 19f, STROKE = 3.7f;
    private static final long PERIOD_NS = 1_900_000_000L;
    private static final long NEXT_FRAME_MS = 22L;

    private static final String SKSL = ""
            + "uniform shader core;\n"
            + "uniform shader halo;\n"
            + "uniform float3 first;\n"
            + "uniform float3 second;\n"
            + "uniform float3 look;\n"
            + "float4 main(float2 p) {\n"
            + "  float a = core.eval(p).a;\n"
            + "  float h = halo.eval(p).a;\n"
            + "  float flow = 0.5 + 0.5 * sin(6.2832 * (p.x / look.y - look.x));\n"
            + "  float3 c = mix(mix(first, second, flow), float3(1.0), a * 0.2);\n"
            + "  float o = (a + h * 0.70 * (1.0 - a)) * look.z;\n"
            + "  return float4(c * o, o);\n"
            + "}\n";

    private final Paint paint = new Paint();
    private final float u;
    private RuntimeShader shader;
    private float r1 = 0f, g1 = 0.78f, b1 = 1f, r2 = 0.48f, g2 = 0.36f, b2 = 1f;
    private float level = 0.72f;
    private float phase;
    private boolean running;

    private final Choreographer.FrameCallback frame = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long now) {
            if (!running) return;
            phase = (now % PERIOD_NS) / (float) PERIOD_NS;
            invalidate();
            Choreographer.getInstance().postFrameCallbackDelayed(this, NEXT_FRAME_MS);
        }
    };

    ScrollCue(Context context) {
        super(context);
        u = context.getResources().getDisplayMetrics().widthPixels / 1280f;
        setFocusable(false);
        final int w = Math.round(VIEW_W * u), h = Math.round(VIEW_H * u);
        final Handler main = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            Path arrow = new Path();
            float mx = w / 2f, my = h / 2f, halfW = WIDE * u / 2f, halfH = TALL * u / 2f;
            arrow.moveTo(mx - halfW, my - halfH);
            arrow.lineTo(mx, my + halfH);
            arrow.lineTo(mx + halfW, my - halfH);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeJoin(Paint.Join.ROUND);
            p.setStrokeWidth(STROKE * u);
            p.setColor(Color.WHITE);
            Bitmap core = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            new Canvas(core).drawPath(arrow, p);
            Bitmap halo = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            p.setMaskFilter(new BlurMaskFilter(7.5f * u, BlurMaskFilter.Blur.NORMAL));
            p.setStrokeWidth(STROKE * 1.5f * u);
            new Canvas(halo).drawPath(arrow, p);
            RuntimeShader made = new RuntimeShader(SKSL);
            made.setInputShader("core", child(GalleryArt.gpu(core)));
            made.setInputShader("halo", child(GalleryArt.gpu(halo)));
            main.post(() -> {
                shader = made;
                paint.setShader(shader);
                invalidate();
            });
        }, "scroll-cue").start();
    }

    private static BitmapShader child(Bitmap b) {
        BitmapShader s = new BitmapShader(b, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        s.setFilterMode(BitmapShader.FILTER_MODE_LINEAR);
        return s;
    }

    void setRunning(boolean run) {
        if (run == running) return;
        running = run;
        Choreographer choreographer = Choreographer.getInstance();
        choreographer.removeFrameCallback(frame);
        if (run) choreographer.postFrameCallback(frame);
    }

    void setColours(int first, int second) {
        r1 = Color.red(first) / 255f;
        g1 = Color.green(first) / 255f;
        b1 = Color.blue(first) / 255f;
        r2 = Color.red(second) / 255f;
        g2 = Color.green(second) / 255f;
        b2 = Color.blue(second) / 255f;
    }

    /** Stronger while the search bar has focus: the arrow is the next step from there. */
    void setLevel(float strength) {
        level = strength;
    }

    @Override
    protected void onDraw(Canvas c) {
        if (shader == null) return;
        float eased = phase * phase * (3f - 2f * phase);
        float fade = (float) Math.sin(Math.PI * phase);
        shader.setFloatUniform("first", r1, g1, b1);
        shader.setFloatUniform("second", r2, g2, b2);
        shader.setFloatUniform("look", phase, getWidth(), level * fade);
        int save = c.save();
        c.translate(0f, (-10f + 20f * eased) * u);
        c.drawRect(0f, 0f, getWidth(), getHeight(), paint);
        c.restoreToCount(save);
    }
}
