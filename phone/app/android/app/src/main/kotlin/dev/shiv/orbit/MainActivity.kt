package dev.shiv.orbit

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Orbit's only activity. Besides hosting Flutter (and the page's WebView), it does what Dart cannot:
 *
 * - the phone's own volume keys: while Dart says so (the page's `settings` op allows it and a paired TV is answering),
 *   both the press and the release of KEYCODE_VOLUME_UP/DOWN are consumed here, so the phone's volume panel never
 *   shows, and each press (auto-repeat included) goes to Dart as `volumeKey`;
 * - Back with nowhere to go back to moves the task behind (like Home) instead of finishing it, so Orbit opens again
 *   at once, still connected;
 * - the cache directory for app pictures;
 * - Orbit's public pages (privacy policy, account deletion) in the phone's browser: the WebView never leaves the page.
 *
 * Channel `dev.shiv.orbit/native`: Dart -> here `setVolumeKeys(bool)`, `moveTaskToBack`, `cacheDir`, `openUrl(String)`;
 * here -> Dart `volumeKey({"dir": "up"|"down", "repeat": n})`.
 */
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private var adbKey: AdbKey? = null
    private var atvIdentity: AtvIdentity? = null
    private var volumeKeys = false

    /** The volume keys whose press was taken: their release is taken too, whatever happened in between. */
    private val heldKeys = HashSet<Int>()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val native = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
        native.setMethodCallHandler { call, result ->
            when (call.method) {
                "setVolumeKeys" -> {
                    volumeKeys = call.arguments == true
                    result.success(null)
                }
                "moveTaskToBack" -> {
                    moveTaskToBack(true)
                    result.success(null)
                }
                "cacheDir" -> result.success(cacheDir.absolutePath)
                // Dart only sends https links to Orbit's own pages (OrbitBridge.isPublicLink).
                "openUrl" -> {
                    val url = call.arguments as? String
                    if (url == null || !url.startsWith("https://")) {
                        result.success(false)
                    } else {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
                            result.success(true)
                        } catch (e: ActivityNotFoundException) {
                            result.success(false)
                        }
                    }
                }
                else -> result.notImplemented()
            }
        }
        channel = native

        // Orbit Setup's RSA key and signing (phone/SPEC.md, `setupConnect`), on its own channel.
        adbKey = AdbKey(applicationContext).also { it.register(flutterEngine.dartExecutor.binaryMessenger) }

        // The client certificate Google TVs pair with (tv/brands/android_tv.dart), on its own channel.
        atvIdentity = AtvIdentity(applicationContext).also { it.register(flutterEngine.dartExecutor.binaryMessenger) }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        channel?.setMethodCallHandler(null)
        channel = null
        adbKey?.unregister()
        adbKey = null
        atvIdentity?.unregister()
        atvIdentity = null
        volumeKeys = false
        heldKeys.clear()
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return super.dispatchKeyEvent(event)
        }
        val target = channel
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (!volumeKeys || target == null) return super.dispatchKeyEvent(event)
                heldKeys.add(code)
                val dir = if (code == KeyEvent.KEYCODE_VOLUME_UP) "up" else "down"
                target.invokeMethod("volumeKey", mapOf("dir" to dir, "repeat" to event.repeatCount))
                return true
            }
            KeyEvent.ACTION_UP -> {
                if (heldKeys.remove(code)) return true
                return super.dispatchKeyEvent(event)
            }
            else -> return if (heldKeys.contains(code)) true else super.dispatchKeyEvent(event)
        }
    }

    private companion object {
        const val CHANNEL = "dev.shiv.orbit/native"
    }
}
