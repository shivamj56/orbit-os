package com.gathin.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.UserManager;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.ViewConfiguration;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.json.JSONObject;

/**
 * Sends the remote's Home button to this launcher on remotes that emit KEYCODE_ALL_APPS for Home
 * (Xiaomi sticks and boxes). Android TV 9 routes that key only to the system-image launcher, so once
 * the stock launcher is disabled the button does nothing. Every other key passes through untouched.
 *
 * With stock_home_redirect set, it also sends the stock launcher's home screen back here, for firmware that turns
 * that launcher on again after it was disabled (XGIMI's xrmservice does, on its own remote keys), or that cannot be
 * disabled at all, and a short press of Home opens this launcher even when the stock home is already on screen.
 *
 * With power_on_home set, a Live TV window (live_tv_package) that the firmware opens by itself at power-on is sent
 * back here too, until the first key press after boot or after the screen turns on (Changhong / Homwee boards).
 * With power_on_home_always set, Home comes up at every power-on whatever is in front, for TVs that resume their
 * last source: a Philips back on an HDMI input sends no window event until the input has a picture.
 *
 * With home_long_press_home set, it takes every Home press, so one held past the long-press timeout opens this launcher
 * instead of Android's ALL_APPS action, which nothing answers once the stock launcher is disabled (Philips TPM191E).
 *
 * Enable over adb:
 *   settings put secure enabled_accessibility_services dev.shiv.orbit.home/com.gathin.tvhome.HomeKeyService
 *   settings put secure accessibility_enabled 1
 */
public class HomeKeyService extends AccessibilityService {

    /** restore_key_services was on when the config was read: this helper is noted for ServiceRepair. */
    private boolean repairRecord;
    /** Remote buttons that should open Settings (config.xml, settings_key_scancodes and settings_key_keycodes). */
    private int[] settingsScancodes = new int[0];
    private int[] settingsKeycodes = new int[0];
    private boolean settingsPanel;
    /** consume_volume_keys: Volume Up/Down go to VolumeKeys instead of on to the firmware. */
    private boolean consumeVolumeKeys;
    /** gallery_home: the owner's volume slider, in this service's window; null where it does not apply. */
    private VolumeSlider volumeSlider;
    /** app_keys, the same maps InputKeyService reads, for setups that run only this service. */
    private Map<Integer, String> appKeys = Collections.emptyMap();
    private Map<Integer, String> appScancodes = Collections.emptyMap();
    private Map<Integer, String> holdAppKeys = Collections.emptyMap();
    private Map<Integer, String> holdAppScancodes = Collections.emptyMap();

    /** Waits for the user to unlock when Android binds this service at boot; null once the config is read. */
    private BroadcastReceiver unlockReceiver;
    /** The stock launcher's HOME activities (stock_home_redirect), disabled ones included. */
    private final Set<String> stockHome = new HashSet<>();
    /** stock_home_redirect, the stock launcher's package. */
    private String stockHomePackage = "";
    /** power_on_home: the Live TV package to send back to Home, empty when off; armed until this uptime or a key. */
    private String powerOnLiveTv = "";
    private long powerOnUntil;
    /** home_long_press_home: this service takes every Home press, held ones included. */
    private boolean homeLongPressHome;
    /** app_keys "front:" entries, and the package of the activity in front, from window changes while there are any. */
    private Map<Integer, String> frontAppKeys = Collections.emptyMap();
    private Map<Integer, String> frontAppScancodes = Collections.emptyMap();
    private String frontPackage = "";
    /** power_on_home_always: Home at every power-on, not only over Live TV. */
    private boolean powerOnAlways;
    /** power_on_home: re-arms after the screen turns on; null unless the key is on. */
    private BroadcastReceiver screenOnReceiver;
    /** Stops key filtering while a game controller is connected; null unless gamepad_passthrough and key_filter, or before the unlock. */
    private GamepadPassthrough gamepads;
    /** Screen-off receiver while guard_off_in_standby is set; null otherwise. */
    private BroadcastReceiver standbyExit;
    /** disableSelf is how this service leaves for standby, not the user turning it off. */
    private boolean steppingOut;
    /** The bound helper, so the opt-in broadcast can arm it without waiting for a new connection. */
    private static HomeKeyService running;
    private AppOpening opening;
    private TvIsland island;
    private IslandEvents islandEvents;
    /** gallery_home: the Home key puts the app back into its card (AppReturn), held it shows the recent apps (AppSwitcher). */
    private AppReturn appReturn;
    private AppSwitcher switcher;
    /** The package of the activity in front, from window events; "" before the first one. */
    private String frontActivity = "";
    private final Map<String, Boolean> launchable = new java.util.HashMap<>();
    private boolean homeHeldOpened;
    /** The Home key is down (from its press to its release), so its release can be told from a Home press of its own. */
    private boolean homeKeyHeld;
    /** The remote's TV+ button, left without its app: Movie Night, or India's match while one is on. */
    private int[] movieNightScancodes = new int[0];
    /** The phone's door into the TV (PhonePortal): a page on the home Wi-Fi, paired once with a code shown here. */
    private PhonePortal portal;
    /** The ring the Orbit app moves in its Cursor mode. */
    private PointerCursor pointer;
    /** Orbit from anywhere: the phone's commands through Firebase; null without a Firebase project in the theme. */
    private OrbitCloud cloud;
    /** Help mode (phone/SPEC.md): the screen, a couple of times a second, for the owner's phone. */
    private HelpMode help;
    private MemoryClear memoryClear;
    /** The Control Center: the remote's Settings button, or Up at the top of Home. */
    private ControlCenter controlCenter;
    /** Home pressed while a video plays: the apps over the video, which keeps playing (no picture-in-picture here). */
    private VideoShelf shelf;
    /** Eye comfort and the Control Center's Display level, over everything on screen. */
    private ScreenTint tint;
    /** The Control Center's sleep timer: minutes chosen, and when it runs out (elapsedRealtime), or 0. */
    private int sleepChosen;
    private long sleepAt;
    private final Runnable sleepWarn = () -> {
        if (island != null) island.show(new TvIsland.Event("cc-sleep", "The TV sleeps in a minute", "Sleep timer",
                0xFFFF9F0A, TvIsland.ICON_NONE, null, null, 8000L));
    };
    private final Runnable sleepNow = () -> {
        sleepChosen = 0;
        sleepAt = 0L;
        // The lock action is the power button's short press on this firmware: on a TV already off it would wake it.
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && pm.isInteractive()) performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
    };
    private final Runnable homeHeld = this::openSwitcher;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = this;
        settingsScancodes = getResources().getIntArray(R.array.settings_key_scancodes);
        // The service is directBootAware: Android 11 skips a service that is not while the user is still
        // locked at boot, writes accessibility_enabled=0 and, on TCL G03 firmware, never binds it after the
        // unlock. Config.load reads credential-protected storage, so wait for the unlock before reading it.
        UserManager users = getSystemService(UserManager.class);
        if (users.isUserUnlocked()) {
            loadConfig();
            return;
        }
        unlockReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                stopWaitingForUnlock();
                loadConfig();
            }
        };
        registerReceiver(unlockReceiver, new IntentFilter(Intent.ACTION_USER_UNLOCKED));
        // The unlock may have happened between the check and the registration.
        if (users.isUserUnlocked()) {
            stopWaitingForUnlock();
            loadConfig();
        }
    }

    private void stopWaitingForUnlock() {
        if (unlockReceiver == null) return;
        unregisterReceiver(unlockReceiver);
        unlockReceiver = null;
    }

    /** The opt-in broadcast: arm this binding now, or drop the receiver if the opt-in was turned off. */
    static void applyStandbyOptIn() {
        HomeKeyService service = running;
        if (service == null) return;
        if (GuardKeep.offInStandby(service)) service.armStandbyExit();
        else service.disarmStandbyExit();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        RemoteKeys.release(this);
        stopWaitingForUnlock();
        if (screenOnReceiver != null) unregisterReceiver(screenOnReceiver);
        if (standbyExit != null) {
            try {
                unregisterReceiver(standbyExit);
            } catch (RuntimeException ignored) {
            }
            standbyExit = null;
        }
        if (gamepads != null) gamepads.stop();
        if (consumeVolumeKeys) VolumeKeys.stop();
        if (opening != null) {
            opening.release();
            opening = null;
        }
        if (islandEvents != null) {
            islandEvents.stop();
            islandEvents = null;
        }
        CricketScore.stop(this);
        if (cloud != null) {
            cloud.stop();
            cloud = null;
        }
        if (portal != null) {
            portal.stop();
            portal = null;
        }
        if (help != null) {
            help.release();
            help = null;
        }
        if (pointer != null) {
            pointer.release();
            pointer = null;
        }
        if (appReturn != null) {
            appReturn.release();
            appReturn = null;
        }
        if (switcher != null) {
            switcher.release();
            switcher = null;
        }
        if (controlCenter != null) {
            controlCenter.release();
            controlCenter = null;
        }
        if (shelf != null) {
            shelf.release();
            shelf = null;
        }
        if (tint != null) {
            tint.release();
            tint = null;
        }
        handler.removeCallbacks(sleepWarn);
        handler.removeCallbacks(sleepNow);
        handler.removeCallbacks(pauseNow);
        handler.removeCallbacks(saveVolume);
        if (volumeReceiver != null) {
            unregisterReceiver(volumeReceiver);
            volumeReceiver = null;
        }
        unwatchSessions();
        if (memoryClear != null) {
            memoryClear.cancel();
            memoryClear = null;
        }
        if (island != null) {
            island.release();
            island = null;
        }
        if (volumeSlider != null) {
            volumeSlider.release();
            volumeSlider = null;
            WatchHistory.stop();
        }
        super.onDestroy();
    }

    /** Some TCL boards never wake from the remote while this helper stays bound with the screen off. */
    private void armStandbyExit() {
        if (standbyExit != null || !GuardKeep.offInStandby(this)) return;
        standbyExit = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) return;
                leaveForStandby();
            }
        };
        registerReceiver(standbyExit, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null && !power.isInteractive()) leaveForStandby();
    }

    private void disarmStandbyExit() {
        if (standbyExit == null) return;
        try {
            unregisterReceiver(standbyExit);
        } catch (RuntimeException ignored) {
        }
        standbyExit = null;
    }

    private void leaveForStandby() {
        steppingOut = true;
        GuardKeep.stepOut(this);
    }

    private void loadConfig() {
        // Keycodes and the panel choice can also come from a theme; theme.sh restarts this service.
        Config config = Config.load(this);
        // restore_key_services: note that this helper runs, so Home can put it back after a force stop. Here, not
        // in onServiceConnected: the note is in credential-protected storage too, readable only after the unlock.
        repairRecord = config.restoreKeyServices;
        if (repairRecord) ServiceRepair.connected(this, getClass());
        settingsKeycodes = config.settingsKeycodes;
        settingsPanel = config.settingsKeyPanel;
        consumeVolumeKeys = config.consumeVolumeKeys;
        appKeys = RemoteKeys.parseAppKeys(config.appKeys);
        appScancodes = RemoteKeys.parseAppScancodes(config.appKeys);
        RemoteKeys.applyKeyFilter(this, config.keyFilter);
        if (volumeSlider == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getResources().getBoolean(R.bool.gallery_home)) {
            volumeSlider = new VolumeSlider(this);
            WatchHistory.start(this);
            opening = new AppOpening(this);
            island = new TvIsland(this);
            island.setWatcher(showing -> {
                GalleryHomeView home = GalleryHomeView.alive();
                if (home != null) home.setIslandOver(showing);
            });
            islandEvents = new IslandEvents(this, island);
            islandEvents.start();
            appReturn = new AppReturn(this);
            switcher = new AppSwitcher(this);
            memoryClear = new MemoryClear(this);
            try {
                controlCenter = new ControlCenter(this);
            } catch (RuntimeException shaderRefused) {
                // A GPU shader this firmware will not compile: the Settings button keeps opening Settings.
                controlCenter = null;
                android.util.Log.e("ControlCenter", "not available", shaderRefused);
            }
            watchVolume();
            watchSessions();
            shelf = new VideoShelf(this, new VideoShelf.Host() {
                @Override
                public void shelfHome() {
                    homePressedNow();
                }

                @Override
                public void shelfOpen(String pkg) {
                    openChosen(pkg);
                }
            });
            movieNightScancodes = getResources().getIntArray(R.array.movie_night_scancodes);
            CricketScore.start(this);
            pointer = new PointerCursor(this);
            help = new HelpMode(this, new HelpMode.Host() {
                @Override
                public boolean cloudWatched() {
                    OrbitCloud c = cloud;
                    return c != null && c.watchedRecently();
                }

                @Override
                public void sendToCloud(byte[] jpeg, int w, int h, int seq) {
                    OrbitCloud c = cloud;
                    if (c != null) c.sendScreen(jpeg, w, h, seq);
                }

                @Override
                public void clearCloud() {
                    OrbitCloud c = cloud;
                    if (c != null) c.clearScreen();
                }

                @Override
                public String helperName() {
                    OrbitCloud c = cloud;
                    return c != null ? c.firstName() : null;
                }
            });
            portal = new PhonePortal(this, new PhonePortal.Host() {
                @Override
                public void showPairingCode(String code, String url) {
                    if (island == null || portal == null) return;
                    String address = url == null ? "The TV is not on the Wi-Fi" : "Open " + url.replaceFirst("^https?://", "").replaceAll("/$", "") + " on your phone";
                    island.show(new TvIsland.Event("pair", "Phone code   " + code.substring(0, 3) + " " + code.substring(3), address,
                            0xFF74D1FF, TvIsland.ICON_PHONE, null, portal.qr(), 180_000L));
                }

                @Override
                public void hidePairingCode() {
                    if (island != null) island.dismiss("pair");
                }

                @Override
                public boolean takeKey(String key) {
                    return takePhoneKey(key);
                }

                @Override
                public PointerCursor pointer() {
                    return pointer;
                }

                @Override
                public void help(boolean on) {
                    HelpMode h = help;
                    if (h == null) return;
                    h.asked();
                    handler.post(() -> {
                        if (on) h.start();
                        else h.stop();
                    });
                }

                @Override
                public Object[] screen() {
                    HelpMode h = help;
                    return h != null ? h.latest() : null;
                }
            });
            portal.start();
            cloud = OrbitCloud.create(this, new OrbitCloud.Host() {
                @Override
                public void showLinkCode(String code) {
                    if (island == null) return;
                    if (code == null) {
                        island.dismiss("orbit-link");
                        return;
                    }
                    island.show(new TvIsland.Event("orbit-link", "Orbit link code   " + code.substring(0, 4) + " " + code.substring(4),
                            "On your phone: Orbit, Use from anywhere, Link", 0xFF74D1FF, TvIsland.ICON_PHONE, null, null, 120_000L));
                }

                @Override
                public void linked(String email) {
                    if (island == null) return;
                    island.show(new TvIsland.Event("orbit-linked", "Orbit is linked", email != null ? email : "This TV answers your phone from anywhere",
                            0xFF4BE3A0, TvIsland.ICON_PHONE, null, null, 6_000L));
                }

                @Override
                public PortalHttp.Response handle(String path, JSONObject body) {
                    PhonePortal door = portal;
                    return door != null ? door.handleCloud(path, body) : PortalHttp.Response.error(503, "The TV is closing the door.");
                }
            });
            if (cloud != null) cloud.start();
        }
        homeLongPressHome = config.homeLongPressHome;
        frontAppKeys = RemoteKeys.parseFrontAppKeys(config.appKeys);
        frontAppScancodes = RemoteKeys.parseFrontAppScancodes(config.appKeys);
        boolean watchFront = !frontAppKeys.isEmpty() || !frontAppScancodes.isEmpty();
        stockHome.clear();
        stockHomePackage = config.stockHomeRedirect;
        if (!config.stockHomeRedirect.isEmpty()) {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(config.stockHomeRedirect);
            for (ResolveInfo ri : getPackageManager().queryIntentActivities(home, PackageManager.MATCH_DISABLED_COMPONENTS)) {
                stockHome.add(ri.activityInfo.name);
            }
        }
        // power_on_home, off by default. Not with boot_to_live_tv, or with Live TV picked as the Open on start app:
        // those open Live TV on purpose at boot.
        String openOnStart = config.openOnStartChoice
                ? getSharedPreferences(Config.SETTINGS_NAME, MODE_PRIVATE).getString(OpenOnStart.KEY, "") : "";
        powerOnLiveTv = config.powerOnHome && !config.bootToLiveTv && !config.liveTvPackage.equals(openOnStart)
                ? config.liveTvPackage : "";
        powerOnAlways = config.powerOnHomeAlways && !config.bootToLiveTv && openOnStart.isEmpty();
        if (!powerOnLiveTv.isEmpty() || powerOnAlways) {
            armPowerOnHome();
        } else if (screenOnReceiver != null) {
            unregisterReceiver(screenOnReceiver);
            screenOnReceiver = null;
            powerOnUntil = 0;
        }
        // home_key_service.xml subscribes to no events, so the redirects ask for window changes only when one is on.
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null && (!stockHome.isEmpty() || !powerOnLiveTv.isEmpty() || watchFront || opening != null)) {
            info.eventTypes |= AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
            setServiceInfo(info);
        }
        if (!stockHome.isEmpty() || !powerOnLiveTv.isEmpty()) probeAtBoot();
        armStandbyExit();
        holdAppKeys = RemoteKeys.parseHoldAppKeys(config.appKeys);
        holdAppScancodes = RemoteKeys.parseHoldAppScancodes(config.appKeys);
        // gamepad_passthrough, off by default. Only with key_filter on: off, the service never filters keys.
        if (config.gamepadPassthrough && config.keyFilter && gamepads == null) {
            gamepads = new GamepadPassthrough(this);
            gamepads.start();
        }
    }

    /** A tap's target: the "front:" entry while the button's own app is already in front, else the usual one. */
    private String inFront(Map<Integer, String> keys, Map<Integer, String> front, int code) {
        String target = keys.get(code);
        String alt = front.get(code);
        return alt != null && RemoteKeys.inFront(target, frontPackage) ? alt : target;
    }

    private boolean isSettingsKey(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_SETTINGS) return true;
        for (int code : settingsScancodes) if (event.getScanCode() == code) return true;
        for (int code : settingsKeycodes) if (event.getKeyCode() == code) return true;
        return false;
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (opening != null && event.getAction() == KeyEvent.ACTION_DOWN) opening.onAnyKey();
        if (controlCenter != null && controlCenter.isActive()) return controlCenter.onKey(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            // Which button sent what: read with `logcat -s OwnerKeys` when a remote's button does nothing.
            android.util.Log.i("OwnerKeys", KeyEvent.keyCodeToString(event.getKeyCode()) + " scan " + event.getScanCode()
                    + " in " + frontActivity);
        }
        if (shelf != null && shelf.isOpen()) {
            // The strip over the video has the keys; the panel's button still brings the panel (the strip goes).
            if (controlCenter != null && ControlCenter.isPanelKey(event)) {
                if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
                    shelf.close();
                    controlCenter.open();
                }
                return true;
            }
            return shelf.onKey(event);
        }
        // The panel's buttons work from inside any app, not only from Home.
        if (controlCenter != null && ControlCenter.isPanelKey(event)) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) controlCenter.open();
            return true;
        }
        if (switcher != null && switcher.isOpen()) {
            // The Home key that was held to open the row is let go: the row stays. Taken as the row's own Home, the
            // release closed it the moment it came up (found on the TV, 10 Nov).
            if (homeKeyHeld && event.getKeyCode() == KeyEvent.KEYCODE_HOME) {
                if (event.getAction() == KeyEvent.ACTION_UP) homeKeyHeld = false;
                return true;
            }
            String chosen = switcher.onKey(event);
            if (chosen != null) openChosen(chosen);
            // Back in the middle of Clear all: it stops where it is, and Home comes, not the Settings page under the row.
            if (!switcher.isOpen() && memoryClear != null && memoryClear.running()) {
                memoryClear.cancel();
                openHome();
            }
            return true;
        }
        if (isMovieNightKey(event)) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
                if (CricketScore.live()) CricketScore.openMatch(this);
                else MovieNight.toggle(this);
            }
            return true;
        }
        if (appReturn != null && event.getKeyCode() == KeyEvent.KEYCODE_HOME && !homeLongPressHome && stockHome.isEmpty()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) {
                    homeHeldOpened = false;
                    homeKeyHeld = true;
                    handler.postDelayed(homeHeld, 550L);
                }
            } else {
                homeKeyHeld = false;
                handler.removeCallbacks(homeHeld);
                if (!homeHeldOpened && !event.isCanceled()) homePressed();
            }
            return true;
        }
        // power_on_home: the first key after power-on hands the TV to the user (power and wake keys don't count).
        if (powerOnUntil != 0 && event.getAction() == KeyEvent.ACTION_DOWN
                && event.getKeyCode() != KeyEvent.KEYCODE_POWER && event.getKeyCode() != KeyEvent.KEYCODE_WAKEUP) {
            powerOnUntil = 0;
        }
        if (volumeSlider != null && volumeSlider.onKey(event)) return true;
        if (consumeVolumeKeys && VolumeKeys.handle(this, event)) return true;
        // A scancode entry is more specific than any keycode, so it goes first.
        if (RemoteKeys.handle(this, event, inFront(appScancodes, frontAppScancodes, event.getScanCode()),
                holdAppScancodes.get(event.getScanCode()))) return true;
        // The stock launcher handled the remote's Settings button; with it disabled the button does nothing.
        if (isSettingsKey(event)) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled() && controlCenter != null) {
                controlCenter.open();
            } else if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
                Intent open = settingsPanel ? new Intent(this, QuickSettingsActivity.class)
                        : SystemSettings.intent(this, Settings.ACTION_SETTINGS);
                try {
                    startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (ActivityNotFoundException | SecurityException unavailable) {
                    Toast.makeText(this, R.string.not_available, Toast.LENGTH_SHORT).show();
                }
            }
            return true;
        }
        if (RemoteKeys.handle(this, event, inFront(appKeys, frontAppKeys, event.getKeyCode()),
                holdAppKeys.get(event.getKeyCode()))) return true;
        // home_long_press_home: Android never sees the Home key, so a held press cannot turn into ALL_APPS.
        if (homeLongPressHome && event.getKeyCode() == KeyEvent.KEYCODE_HOME) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) openHome();
            return true;
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_HOME && !stockHome.isEmpty()) {
            redirectHomeKey(event);
            return false;
        }
        if (event.getKeyCode() != KeyEvent.KEYCODE_ALL_APPS) return false;
        if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) openHome();
        return true;
    }

    /** Unbound by Android: the user turned the helper off, so Home doesn't put it back (ServiceRepair). */
    @Override
    public boolean onUnbind(Intent intent) {
        RemoteKeys.release(this);
        if (repairRecord && !steppingOut) ServiceRepair.disconnected(this, getClass());
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (opening != null) opening.onWindow(event.getPackageName(), event.getClassName());
        noteFront(event.getPackageName(), event.getClassName());
        // app_keys "front:" entries: only activities count, so a toast or the volume bar doesn't change the app in front.
        if ((!frontAppKeys.isEmpty() || !frontAppScancodes.isEmpty())
                && event.getPackageName() != null && event.getClassName() != null) {
            try {
                ComponentName window = new ComponentName(event.getPackageName().toString(), event.getClassName().toString());
                getPackageManager().getActivityInfo(window, 0);
                frontPackage = window.getPackageName();
            } catch (PackageManager.NameNotFoundException notAnActivity) {
                // a dialog, panel or overlay: the app under it is still in front
            }
        }
        // power_on_home: the firmware opened Live TV by itself at power-on, before anyone pressed a key.
        if (powerOnRedirect(powerOnLiveTv, event.getPackageName(), SystemClock.elapsedRealtime(), powerOnUntil)) {
            openHome();
            return;
        }
        // stock_home_redirect: the firmware turned the stock launcher back on and its home screen came up.
        CharSequence cls = event.getClassName();
        if (!stockHome.isEmpty() && cls != null && stockHome.contains(cls.toString())) openHome();
    }

    /** How long power_on_home stays armed after the screen turns on without a reboot. */
    static final long SCREEN_ON_WINDOW_MS = 60 * 1000L;

    /** power_on_home: armed for the boot window (if this bind is part of the boot) and after every screen-on. */
    private void armPowerOnHome() {
        if (SystemClock.elapsedRealtime() < BOOT_WINDOW_MS) {
            powerOnUntil = BOOT_WINDOW_MS;
            if (powerOnAlways) handler.postDelayed(this::homeAtPowerOn, POWER_ON_ALWAYS_DELAY_MS);
        }
        if (screenOnReceiver != null) return;
        screenOnReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                powerOnUntil = SystemClock.elapsedRealtime() + SCREEN_ON_WINDOW_MS;
                if (powerOnAlways) handler.postDelayed(HomeKeyService.this::homeAtPowerOn, POWER_ON_ALWAYS_DELAY_MS);
            }
        };
        registerReceiver(screenOnReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON));
    }

    /** power_on_home_always: after the firmware has brought its last source back (Philips: within 0.5 s). */
    static final long POWER_ON_ALWAYS_DELAY_MS = 800L;

    /** power_on_home_always: Home, unless a key was pressed since the screen came on (the user has the TV). */
    private void homeAtPowerOn() {
        if (stillArmed(SystemClock.elapsedRealtime(), powerOnUntil)) openHome();
    }

    static boolean stillArmed(long now, long armedUntil) {
        return now < armedUntil;
    }

    private boolean isMovieNightKey(KeyEvent event) {
        if (appReturn == null) return false;
        for (int code : movieNightScancodes) if (event.getScanCode() == code) return true;
        return false;
    }

    /** Only an activity's window says which app is in front; dialogs, toasts and the system's starting windows do not. */
    private void noteFront(CharSequence pkg, CharSequence cls) {
        if (appReturn == null || pkg == null || cls == null) return;
        try {
            getPackageManager().getActivityInfo(new ComponentName(pkg.toString(), cls.toString()), 0);
        } catch (PackageManager.NameNotFoundException notAnActivity) {
            return;
        }
        String before = frontActivity;
        frontActivity = pkg.toString();
        if (shelf != null) shelf.frontChanged(frontActivity);
        if (!frontActivity.equals(getPackageName()) && isLaunchable(frontActivity)) {
            AppSwitcher.used(frontActivity);
            if (!frontActivity.equals(before)) appVolumeFor(frontActivity);
        }
    }

    private boolean isLaunchable(String pkg) {
        Boolean known = launchable.get(pkg);
        if (known == null) {
            known = AppSwitcher.launchIntent(this, pkg) != null;
            launchable.put(pkg, known);
        }
        return known;
    }

    /**
     * The Home key, short: from an app, its last picture goes back into its card while Home opens under it. The picture
     * has to be taken first; should that take too long or fail, Home simply opens.
     */
    /**
     * Home from an app. A video playing in it keeps playing: the apps rise over it on a strip (VideoShelf), and Home
     * again goes on to the full Home. Anything else goes Home at once, as before.
     */
    private void homePressed() {
        final String app = frontActivity;
        if (shelf != null && !shelf.isOpen() && !app.isEmpty() && !app.equals(getPackageName())) {
            MediaController playing = playingIn(app);
            if (playing != null) {
                MediaMetadata md = playing.getMetadata();
                if (shelf.open(app, md != null ? md.getString(MediaMetadata.METADATA_KEY_TITLE) : null)) return;
            }
        }
        homePressedNow();
    }

    /** The app's own media session, if it is playing (or about to). */
    private MediaController playingIn(String pkg) {
        MediaSessionManager msm = getSystemService(MediaSessionManager.class);
        if (msm == null) return null;
        try {
            for (MediaController mc : msm.getActiveSessions(new ComponentName(this, GuardRevival.class))) {
                if (!pkg.equals(mc.getPackageName())) continue;
                PlaybackState s = mc.getPlaybackState();
                if (s != null && (s.getState() == PlaybackState.STATE_PLAYING || s.getState() == PlaybackState.STATE_BUFFERING)) return mc;
            }
        } catch (SecurityException noListener) {
            // without the notification listener grant there is no way to tell: Home goes as before
        }
        return null;
    }

    private void homePressedNow() {
        final String app = frontActivity;
        if (app.isEmpty() || app.equals(getPackageName()) || !isLaunchable(app)) {
            openHome();
            return;
        }
        final boolean[] done = {false};
        final Runnable plain = () -> {
            if (done[0]) return;
            done[0] = true;
            openHome();
        };
        handler.postDelayed(plain, 350L);
        try {
            takeScreenshot(android.view.Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult result) {
                    handler.removeCallbacks(plain);
                    if (done[0]) {
                        result.getHardwareBuffer().close();
                        return;
                    }
                    done[0] = true;
                    returnWith(app, result);
                }

                @Override
                public void onFailure(int errorCode) {
                    handler.removeCallbacks(plain);
                    plain.run();
                }
            });
        } catch (RuntimeException noScreenshot) {
            handler.removeCallbacks(plain);
            plain.run();
        }
    }

    private void returnWith(String app, ScreenshotResult result) {
        android.hardware.HardwareBuffer buffer = result.getHardwareBuffer();
        android.graphics.Bitmap screen = android.graphics.Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
        if (screen == null) {
            buffer.close();
            openHome();
            return;
        }
        android.graphics.Bitmap small = smallCopy(screen);
        // A film an app protects comes out black: then its card goes back instead of the picture.
        boolean dark = small == null || mostlyBlack(small);
        if (small != null && !dark) AppSwitcher.remember(app, small);
        else if (small != null) small.recycle();
        GalleryHomeView home = GalleryHomeView.alive();
        GalleryArt.Card card = home == null ? null : home.cardOf(app);
        if (home != null) home.centreOn(app);
        if ((dark && card == null) || !appReturn.hold(screen, buffer)) {
            screen.recycle();
            buffer.close();
            openHome();
            return;
        }
        try {
            openHome();
        } finally {
            // Even if Home could not be asked for, the picture must not stay over the app.
            appReturn.go(home, dark ? card : null);
        }
    }

    private static android.graphics.Bitmap smallCopy(android.graphics.Bitmap screen) {
        try {
            android.graphics.Bitmap full = screen.copy(android.graphics.Bitmap.Config.ARGB_8888, false);
            if (full == null) return null;
            android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(full, 427, 240, true);
            if (small != full) full.recycle();
            return small;
        } catch (RuntimeException unreadable) {
            return null;
        }
    }

    private static boolean mostlyBlack(android.graphics.Bitmap b) {
        int dark = 0, n = 0;
        for (int y = 8; y < b.getHeight(); y += b.getHeight() / 9) {
            for (int x = 8; x < b.getWidth(); x += b.getWidth() / 12) {
                int p = b.getPixel(x, y);
                int lum = (android.graphics.Color.red(p) * 3 + android.graphics.Color.green(p) * 6 + android.graphics.Color.blue(p)) / 10;
                if (lum < 14) dark++;
                n++;
            }
        }
        return n > 0 && dark * 100 >= n * 94;
    }

    /** The Home key, held: the recent apps. From an app, its picture is taken first so that it is in the row as it is now. */
    private void openSwitcher() {
        homeHeldOpened = true;
        final String app = frontActivity;
        if (!app.isEmpty() && !app.equals(getPackageName()) && isLaunchable(app)) {
            try {
                takeScreenshot(android.view.Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                    @Override
                    public void onSuccess(ScreenshotResult result) {
                        android.hardware.HardwareBuffer buffer = result.getHardwareBuffer();
                        android.graphics.Bitmap screen = android.graphics.Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
                        android.graphics.Bitmap small = screen == null ? null : smallCopy(screen);
                        if (screen != null) screen.recycle();
                        buffer.close();
                        if (small != null && !mostlyBlack(small)) AppSwitcher.remember(app, small);
                        showSwitcher(app);
                    }

                    @Override
                    public void onFailure(int errorCode) {
                        showSwitcher(app);
                    }
                });
                return;
            } catch (RuntimeException noScreenshot) {
                // Then without its picture.
            }
        }
        showSwitcher(app);
    }

    private void showSwitcher(String front) {
        // Nothing in it yet: the press counts as an ordinary Home press once it is let go.
        if (switcher == null || !switcher.open(front)) {
            homeHeldOpened = false;
            return;
        }
        long free = MemoryClear.freeMb(this);
        if (free > 0) switcher.setStatus(free + " MB free");
    }

    /**
     * A key from the phone (PhonePortal), on the main thread. The keys Android plays for the phone's arrows skip this
     * helper's key filter, so the TV's own windows are asked here, as the remote's keys reach them: the recent apps row
     * while it is open, and Home with the app going back into its card. False leaves the key to the global action.
     */
    private boolean takePhoneKey(String key) {
        int code;
        switch (key) {
            case "up": code = KeyEvent.KEYCODE_DPAD_UP; break;
            case "down": code = KeyEvent.KEYCODE_DPAD_DOWN; break;
            case "left": code = KeyEvent.KEYCODE_DPAD_LEFT; break;
            case "right": code = KeyEvent.KEYCODE_DPAD_RIGHT; break;
            case "ok": code = KeyEvent.KEYCODE_DPAD_CENTER; break;
            case "back": code = KeyEvent.KEYCODE_BACK; break;
            case "home": code = KeyEvent.KEYCODE_HOME; break;
            case "settings":
                // The phone's Settings key does what the remote's does: the Control Center, or closes it.
                if (controlCenter == null) return false;
                if (controlCenter.isActive()) controlCenter.close();
                else controlCenter.open();
                return true;
            case "recents":
                if (switcher == null) return false;
                if (!switcher.isOpen()) openSwitcher();
                return true;
            default:
                return false;
        }
        if (controlCenter != null && controlCenter.isActive()) {
            long now = SystemClock.uptimeMillis();
            for (int action : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                controlCenter.onKey(new KeyEvent(now, now, action, code, 0));
            }
            return true;
        }
        if (shelf != null && shelf.isOpen()) {
            long now = SystemClock.uptimeMillis();
            for (int action : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                shelf.onKey(new KeyEvent(now, now, action, code, 0));
            }
            return true;
        }
        if (switcher != null && switcher.isOpen()) {
            long now = SystemClock.uptimeMillis();
            for (int action : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                String chosen = switcher.onKey(new KeyEvent(now, now, action, code, 0));
                if (chosen != null) openChosen(chosen);
            }
            if (!switcher.isOpen() && memoryClear != null && memoryClear.running()) {
                memoryClear.cancel();
                openHome();
            }
            return true;
        }
        if (code == KeyEvent.KEYCODE_HOME && appReturn != null && stockHome.isEmpty()) {
            homePressed();
            return true;
        }
        return false;
    }

    /** Clear all: each app in the row closed through its own Force stop in Settings, behind the row; then Home. */
    private void clearAll() {
        if (switcher == null || memoryClear == null || memoryClear.running()) return;
        List<String> apps = switcher.packages();
        apps.remove(getPackageName());
        switcher.clearing("Closing…");
        memoryClear.clear(apps, new MemoryClear.Listener() {
            @Override
            public void onProgress(int done, int total, String label) {
                if (switcher != null) switcher.clearing("Closing " + label + "   " + done + " of " + total);
            }

            @Override
            public void onDone(int closed, long freeMb) {
                for (String p : apps) AppSwitcher.forget(p);
                if (switcher != null) switcher.close();
                openHome();
                if (island != null) {
                    island.show(new TvIsland.Event("ram", "Memory cleared", closed + (closed == 1 ? " app" : " apps") + " closed"
                            + (freeMb > 0 ? "   ·   " + freeMb + " MB free" : ""), 0xFF4BE3A0, TvIsland.ICON_NONE, null, null, 3000L));
                }
            }
        });
    }

    private void openChosen(String pkg) {
        if (AppSwitcher.CLEAR_ALL.equals(pkg)) {
            clearAll();
            return;
        }
        if (pkg.equals(frontActivity)) return;
        Intent open = AppSwitcher.launchIntent(this, pkg);
        if (open == null) return;
        try {
            startActivity(open, android.app.ActivityOptions.makeCustomAnimation(this, android.R.anim.fade_in, android.R.anim.fade_out).toBundle());
        } catch (ActivityNotFoundException | SecurityException gone) {
            Toast.makeText(this, R.string.not_available, Toast.LENGTH_SHORT).show();
        }
    }

    /** Home's Up at the top row: the Control Center comes down. */
    static void openControlCenter() {
        HomeKeyService service = running;
        if (service != null && service.controlCenter != null) service.controlCenter.open();
    }

    // ---------------------------------------------------------------- what the Control Center asks of the helper

    void ccHome() {
        openHome();
    }

    void ccRecents() {
        openSwitcher();
    }

    /** Clear all goes through the recent apps row: its scrim hides the Settings pages the clearing walks through. */
    void ccClearAll() {
        if (switcher == null || memoryClear == null || memoryClear.running() || !switcher.open(frontActivity)) {
            if (island != null) island.show(new TvIsland.Event("cc-ram", "Nothing to close", "No apps are open in the background",
                    0xFF4BE3A0, TvIsland.ICON_NONE, null, null, 2600L));
            return;
        }
        clearAll();
    }

    void ccSleepNow() {
        performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
    }

    void ccPowerMenu() {
        performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
    }

    void ccOpen(Intent i) {
        try {
            startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            Toast.makeText(this, R.string.not_available, Toast.LENGTH_SHORT).show();
        }
    }

    void ccOpenInput(String inputId) {
        ccOpen(new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_PANEL_INPUT, inputId));
    }

    String ccOrbit() {
        return cloud == null ? null : cloud.linkedNow() ? "Linked" : "Not linked";
    }

    String ccWeatherLine() {
        String weather = Weather.text();
        return weather.isEmpty() ? "Family room" : weather + " · Family room";
    }

    void ccSleepIn(int minutes) {
        sleepAtEnd = false;
        startSleep(Math.max(0, minutes), minutes * 60_000L);
    }

    /** "When this ends": the TV sleeps just after what is playing, whatever its length. */
    void ccSleepAfterMs(long ms) {
        sleepAtEnd = true;
        startSleep(-1, ms);
    }

    boolean ccSleepAtEnd() {
        return sleepAtEnd && ccSleepLeftMs() > 0L;
    }

    private boolean sleepAtEnd;

    private void startSleep(int chosen, long ms) {
        handler.removeCallbacks(sleepWarn);
        handler.removeCallbacks(sleepNow);
        sleepChosen = chosen;
        if (ms <= 0L) {
            sleepAt = 0L;
            sleepAtEnd = false;
            return;
        }
        sleepAt = SystemClock.elapsedRealtime() + ms;
        handler.postDelayed(sleepNow, ms);
        if (ms > 60_000L) handler.postDelayed(sleepWarn, ms - 60_000L);
    }

    // ---- the video's own pause timer: the TV stays on, the video stops

    private int pauseChosen;
    private long pauseAt;
    private final Runnable pauseNow = () -> {
        pauseChosen = 0;
        pauseAt = 0L;
        MediaController mc = anyPlaying();
        if (mc != null) mc.getTransportControls().pause();
        if (island != null) island.show(new TvIsland.Event("cc-pause", "Paused, as you asked", "OK on the remote plays it again",
                0xFFFF9F0A, TvIsland.ICON_NONE, null, null, 6000L));
    };

    void ccPauseIn(int minutes) {
        handler.removeCallbacks(pauseNow);
        pauseChosen = Math.max(0, minutes);
        pauseAt = minutes > 0 ? SystemClock.elapsedRealtime() + minutes * 60_000L : 0L;
        if (minutes > 0) handler.postDelayed(pauseNow, minutes * 60_000L);
    }

    int ccPauseChosen() {
        return pauseAt > SystemClock.elapsedRealtime() ? pauseChosen : 0;
    }

    private MediaController anyPlaying() {
        MediaSessionManager msm = getSystemService(MediaSessionManager.class);
        if (msm == null) return null;
        try {
            for (MediaController mc : msm.getActiveSessions(new ComponentName(this, GuardRevival.class))) {
                PlaybackState s = mc.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) return mc;
            }
        } catch (SecurityException noListener) {
            // no listener grant: nothing to pause
        }
        return null;
    }

    // ---- subtitles, through the TV's own caption setting (apps that follow it pick it up)

    boolean ccCaptions() {
        return Settings.Secure.getInt(getContentResolver(), "accessibility_captioning_enabled", 0) == 1;
    }

    /** False when the setting cannot be written (no WRITE_SECURE_SETTINGS grant on this install). */
    boolean ccSetCaptions(boolean on) {
        try {
            return Settings.Secure.putInt(getContentResolver(), "accessibility_captioning_enabled", on ? 1 : 0);
        } catch (SecurityException notGranted) {
            return false;
        }
    }

    float ccCaptionScale() {
        return Settings.Secure.getFloat(getContentResolver(), "accessibility_captioning_font_scale", 1f);
    }

    void ccSetCaptionScale(float scale) {
        try {
            Settings.Secure.putFloat(getContentResolver(), "accessibility_captioning_font_scale", scale);
        } catch (SecurityException notGranted) {
            // shown as unchanged
        }
    }

    // ---- each app's own volume: kept when changed in it, given back when it comes to the front again

    private static final String APP_VOLUME = "app-volume";
    private long volumeSetByUsAt;
    private String volumeApp = "";
    private final Runnable saveVolume = () -> {
        if (volumeApp.isEmpty() || !ccAppVolume()) return;
        AudioManager am = getSystemService(AudioManager.class);
        if (am == null) return;
        getSharedPreferences(APP_VOLUME, MODE_PRIVATE).edit().putInt(volumeApp, am.getStreamVolume(AudioManager.STREAM_MUSIC)).apply();
    };
    private BroadcastReceiver volumeReceiver;

    boolean ccAppVolume() {
        return getSharedPreferences(APP_VOLUME, MODE_PRIVATE).getBoolean("#on", true);
    }

    void ccSetAppVolume(boolean on) {
        getSharedPreferences(APP_VOLUME, MODE_PRIVATE).edit().putBoolean("#on", on).apply();
    }

    private void watchVolume() {
        if (volumeReceiver != null) return;
        volumeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (i.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1) != AudioManager.STREAM_MUSIC) return;
                // Our own change on an app's return is not a choice to remember.
                if (SystemClock.uptimeMillis() - volumeSetByUsAt < 1500L) return;
                String app = frontActivity;
                if (app.isEmpty() || app.equals(getPackageName()) || !isLaunchable(app)) return;
                volumeApp = app;
                handler.removeCallbacks(saveVolume);
                handler.postDelayed(saveVolume, 2000L);
            }
        };
        IntentFilter volumeChanged = new IntentFilter("android.media.VOLUME_CHANGED_ACTION");
        // Android 14 wants every receiver registered in code to say whether other apps may reach it; the system still can.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(volumeReceiver, volumeChanged, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(volumeReceiver, volumeChanged);
    }

    /** An app came to the front: its own volume back, if one was kept for it. */
    private void appVolumeFor(String app) {
        if (!ccAppVolume() || app.equals(getPackageName())) return;
        int kept = getSharedPreferences(APP_VOLUME, MODE_PRIVATE).getInt(app, -1);
        if (kept < 0) return;
        handler.postDelayed(() -> {
            if (!app.equals(frontActivity)) return;
            AudioManager am = getSystemService(AudioManager.class);
            if (am == null || am.isStreamMute(AudioManager.STREAM_MUSIC) || am.getStreamVolume(AudioManager.STREAM_MUSIC) == kept) return;
            volumeSetByUsAt = SystemClock.uptimeMillis();
            am.setStreamVolume(AudioManager.STREAM_MUSIC, kept, 0);
        }, 400L);
    }

    // ---- gentle hints in the Island, from what starts playing (Quiet keeps them away)

    private MediaSessionManager.OnActiveSessionsChangedListener sessionsListener;
    private final java.util.Map<MediaController, MediaController.Callback> watched = new java.util.HashMap<>();
    private final java.util.Set<String> hinted = new java.util.HashSet<>();
    private long hintAt;
    private int eyeHintDay = -1;

    private void watchSessions() {
        MediaSessionManager msm = getSystemService(MediaSessionManager.class);
        if (msm == null || sessionsListener != null) return;
        ComponentName listener = new ComponentName(this, GuardRevival.class);
        sessionsListener = controllers -> follow(controllers);
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, listener, handler);
            follow(msm.getActiveSessions(listener));
        } catch (SecurityException noListener) {
            sessionsListener = null;
        }
    }

    private void follow(List<MediaController> controllers) {
        for (java.util.Map.Entry<MediaController, MediaController.Callback> e : watched.entrySet()) {
            e.getKey().unregisterCallback(e.getValue());
        }
        watched.clear();
        if (controllers == null) return;
        for (MediaController mc : controllers) {
            MediaController.Callback cb = new MediaController.Callback() {
                @Override
                public void onPlaybackStateChanged(PlaybackState state) {
                    if (state != null && state.getState() == PlaybackState.STATE_PLAYING) hint(mc);
                }
            };
            mc.registerCallback(cb, handler);
            watched.put(mc, cb);
        }
    }

    private void unwatchSessions() {
        MediaSessionManager msm = getSystemService(MediaSessionManager.class);
        if (msm != null && sessionsListener != null) msm.removeOnActiveSessionsChangedListener(sessionsListener);
        sessionsListener = null;
        follow(null);
    }

    /** One hint at a time, once a title, never more than one in twenty minutes. */
    private void hint(MediaController mc) {
        if (island == null || TvIsland.quiet) return;
        long now = SystemClock.elapsedRealtime();
        if (now - hintAt < 20L * 60_000L && hintAt != 0L) return;
        MediaMetadata md = mc.getMetadata();
        String title = md != null ? md.getString(MediaMetadata.METADATA_KEY_TITLE) : null;
        if (title == null || title.isEmpty() || !hinted.add(title)) return;
        long length = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
        String t = title.toLowerCase(java.util.Locale.ROOT);
        String[] say = null;
        if (t.contains("bhajan") || t.contains("aarti") || t.contains("chalisa") || t.contains("bhakti") || t.contains("kirtan")
                || t.contains("mantra") || title.contains("भजन") || title.contains("आरती") || title.contains("चालीसा")) {
            say = new String[]{"Bhakti", "The words are in the panel: Settings button, Now playing, Lyrics"};
        } else if (length >= 40L * 60_000L) {
            say = new String[]{"A film is starting", "Movie Night is in the panel: Settings button, Scenes"};
        }
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int day = cal.get(java.util.Calendar.DAY_OF_YEAR);
        if (say == null && cal.get(java.util.Calendar.HOUR_OF_DAY) >= 22 && eyeHintDay != day && !ccEye()) {
            eyeHintDay = day;
            say = new String[]{"Late night viewing", "Eye comfort and Sleep when this ends are in the panel"};
        }
        if (say == null) return;
        hintAt = now;
        island.show(new TvIsland.Event("hint", say[0], say[1], 0xFF74D1FF, TvIsland.ICON_NONE, null, null, 6000L));
    }

    long ccSleepLeftMs() {
        return sleepAt == 0L ? 0L : Math.max(0L, sleepAt - SystemClock.elapsedRealtime());
    }

    int ccSleepChosen() {
        return ccSleepLeftMs() > 0L ? sleepChosen : 0;
    }

    private ScreenTint tint() {
        if (tint == null) tint = new ScreenTint(this);
        return tint;
    }

    boolean ccEye() {
        return tint != null && tint.warm;
    }

    void ccSetEye(boolean on) {
        tint().setWarm(on);
    }

    int ccLight() {
        return tint == null ? 100 : tint.light;
    }

    void ccSetLight(int pct) {
        tint().setLight(pct);
    }

    /** Where the sound plays now, as the Control Center's Sound slider names it. */
    String ccOutput() {
        boolean bluetooth = false, arc = false;
        AudioManager am = getSystemService(AudioManager.class);
        if (am != null) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLE_HEADSET
                        || t == AudioDeviceInfo.TYPE_BLE_SPEAKER) bluetooth = true;
                if (t == AudioDeviceInfo.TYPE_HDMI_ARC || t == AudioDeviceInfo.TYPE_HDMI_EARC) arc = true;
            }
        }
        return bluetooth ? "Headphones" : arc ? "Soundbar" : "TV speakers";
    }

    /** Every place sound can go now: name, icon kind, and a line under it. */
    List<String[]> ccOutputs() {
        List<String[]> out = new ArrayList<>();
        out.add(new String[]{"TV speakers", "speaker", "Built in"});
        AudioManager am = getSystemService(AudioManager.class);
        if (am == null) return out;
        boolean bt = false, arc = false;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            if (!bt && (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER)) {
                bt = true;
                CharSequence name = d.getProductName();
                out.add(new String[]{"Headphones", "headphones", name != null && name.length() > 0 ? name.toString() : "Bluetooth"});
            } else if (!arc && (t == AudioDeviceInfo.TYPE_HDMI_ARC || t == AudioDeviceInfo.TYPE_HDMI_EARC)) {
                arc = true;
                out.add(new String[]{"Soundbar", "soundbar", t == AudioDeviceInfo.TYPE_HDMI_EARC ? "HDMI eARC" : "HDMI ARC"});
            }
        }
        return out;
    }

    /** Eye comfort's warm light and the Display level: one window over everything, the Control Center too. */
    private static final class ScreenTint extends View {
        boolean warm;
        int light = 100;
        private final WindowManager windows;
        private boolean added;

        ScreenTint(Context c) {
            super(c);
            windows = c.getSystemService(WindowManager.class);
        }

        void setWarm(boolean on) {
            warm = on;
            update();
        }

        void setLight(int pct) {
            light = Math.max(10, Math.min(100, pct));
            update();
        }

        private void update() {
            boolean needed = warm || light < 100;
            if (needed && !added) {
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT);
                lp.setTitle("OwnerTint");
                lp.setFitInsetsTypes(0);
                lp.windowAnimations = 0;
                try {
                    windows.addView(this, lp);
                    added = true;
                } catch (RuntimeException noWindow) {
                    added = false;
                }
            }
            if (added) {
                setVisibility(needed ? VISIBLE : GONE);
                invalidate();
            }
        }

        void release() {
            if (added) {
                try {
                    windows.removeView(this);
                } catch (RuntimeException gone) {
                    // already gone with the service
                }
            }
            added = false;
        }

        @Override
        protected void onDraw(Canvas c) {
            if (warm) c.drawColor(0x33FF8A2A);
            if (light < 100) c.drawColor(Color.argb(Math.round((100 - light) * 0.006f * 255f), 0, 0, 0));
        }
    }

    /** The TV Island; null while this helper is not bound. */
    static TvIsland island() {
        HomeKeyService service = running;
        return service != null ? service.island : null;
    }

    /** Home came back (MainActivity.onResume): a TV not linked to Orbit's cloud yet shows its link code. */
    static void homeResumed() {
        HomeKeyService service = running;
        OrbitCloud c = service != null ? service.cloud : null;
        if (c != null) c.homeResumed();
    }

    /** The window an app's opening is drawn in; null while this helper is not bound. */
    static AppOpening opening() {
        HomeKeyService service = running;
        return service != null ? service.opening : null;
    }

    /** The settings menu offers Restart only while this helper is bound: it opens the system power menu. */
    static boolean canOpenPowerMenu() {
        return running != null;
    }

    /** The system power menu (Restart, and Power off where the firmware has it); the TV asks before it acts. */
    static void openPowerMenu() {
        HomeKeyService service = running;
        if (service != null) service.performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
    }

    static boolean powerOnRedirect(String liveTv, CharSequence pkg, long now, long armedUntil) {
        return !liveTv.isEmpty() && pkg != null && liveTv.contentEquals(pkg) && now < armedUntil;
    }

    /** How long after boot the first bind still counts as "at boot" for probeAtBoot. */
    static final long BOOT_WINDOW_MS = 3 * 60 * 1000L;

    /** stock_home_redirect at boot: the stock home is often on screen before Android binds this service, so no
     *  window event for it arrives (#1116). Once per boot, open ProbeActivity: when it closes, whatever was in
     *  front comes back and sends a window event, and onAccessibilityEvent covers it only if it is the stock home.
     *  An HDMI input or an app that the TV resumed at boot is left alone. */
    private void probeAtBoot() {
        int boot = Settings.Global.getInt(getContentResolver(), Settings.Global.BOOT_COUNT, -1);
        SharedPreferences prefs = getSharedPreferences("boot", MODE_PRIVATE);
        if (!firstBindAfterBoot(boot, prefs.getInt("probe_boot", -1), SystemClock.elapsedRealtime())) return;
        prefs.edit().putInt("probe_boot", boot).apply();
        try {
            startActivity(new Intent(this, ProbeActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION));
        } catch (ActivityNotFoundException | SecurityException ignored) {
        }
    }

    static boolean firstBindAfterBoot(int boot, int lastBoot, long uptimeMs) {
        return boot >= 0 && boot != lastBoot && uptimeMs < BOOT_WINDOW_MS;
    }

    /** Lets the system see the key, so a long press still does what the firmware gives it. */
    private static final long HOME_KEY_DELAY_MS = 250;
    private final Handler handler = new Handler(Looper.getMainLooper());

    /** stock_home_redirect on the Home key: when the stock home is already on screen (it came up at boot, before
     *  Android bound this service), Home brings it up again with no window change, so the redirect above never
     *  fires and the TV stays on the stock home until another app opens (#1116). A short press opens this
     *  launcher shortly after the system has handled the key; a long press (Google TV's quick settings) is left
     *  alone. Held time, not repeats: key repeats are made after accessibility filtering, so none arrive here. */
    private void redirectHomeKey(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()
                && isShortPress(event.getDownTime(), event.getEventTime(), ViewConfiguration.getLongPressTimeout())) {
            handler.postDelayed(this::openHome, HOME_KEY_DELAY_MS);
        }
    }

    static boolean isShortPress(long downTime, long upTime, long longPressTimeout) {
        return upTime - downTime < longPressTimeout;
    }

    private void openHome() {
        Intent open = stockHomeStays() ? new Intent(this, MainActivity.class)
                : new Intent(Intent.ACTION_MAIN).setPackage(getPackageName());
        startActivity(open.addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED));
    }

    /** stock_home_redirect while Android's Home is still the stock launcher (launcherx on Google TV outranks this
     *  one). A Home intent would then put this launcher in the home task and make it the home process, and from
     *  Android 10 the stock launcher, no longer exempt from the limits on background activity starts, can't open
     *  apps for the remote's YouTube and Netflix buttons (#1274). openHome starts it like an app instead:
     *  CATEGORY_HOME without ACTION_MAIN is not a Home intent, but still sends MainActivity back to the first tile.
     *  A MainActivity already in the home task, as the install scripts' first start leaves it, is reused as it is
     *  until that task goes (a restart or a reinstall). With this launcher or Android's chooser as Home, openHome
     *  keeps the Home intent. */
    private boolean stockHomeStays() {
        if (stockHome.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        ResolveInfo home = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
        return home != null && stockHomePackage.equals(home.activityInfo.packageName);
    }

    @Override
    public void onInterrupt() {
    }
}
