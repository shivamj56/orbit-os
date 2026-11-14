import Flutter
import UIKit

/// Orbit on the iPhone. Besides the plugins, the app itself answers the two channels Dart asks the phone on, as
/// MainActivity does on Android: `dev.shiv.orbit/native` (NativeChannel.swift) and Orbit Setup's RSA key and signing,
/// `dev.shiv.orbit/adbkey` (AdbKey.swift).
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var native: NativeChannel?
  private let adbKey = AdbKey()
  private var adbKeyChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let messenger = engineBridge.applicationRegistrar.messenger()
    native = NativeChannel(messenger: messenger)
    adbKeyChannel = adbKey.register(with: messenger)
  }
}
