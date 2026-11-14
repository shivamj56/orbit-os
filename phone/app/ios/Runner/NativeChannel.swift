import AuthenticationServices
import CryptoKit
import Flutter
import UIKit

/// What only the phone itself does for Dart, on the channel `dev.shiv.orbit/native` (the iPhone's side of
/// android/app/src/main/kotlin/dev/shiv/orbit/MainActivity.kt, same methods, and one of its own):
///
/// - `cacheDir`: the app's caches directory, for app pictures (iOS may empty it when it needs the room);
/// - `openUrl(String)`: Orbit's public pages (privacy policy, account deletion) in the phone's browser, true when it
///   opened; the WebView never leaves the page;
/// - `moveTaskToBack`, `setVolumeKeys(bool)`: answered, and nothing happens. An iPhone has no Back to leave on, and iOS
///   lets no app take the volume buttons, so Dart does not offer them here (NativeHost.hasVolumeKeys);
/// - `appleSignIn(String nonce)`: Apple's Sign in with Apple sheet (lib/cloud/apple_identity.dart). Apple is given the
///   SHA-256 of the nonce Dart made; the answer is `{"identityToken","authorizationCode","user"}` plus `email`,
///   `givenName` and `familyName` when Apple tells them (the first time only). A closed sheet is the error `canceled`.
final class NativeChannel {
  static let name = "dev.shiv.orbit/native"

  private let channel: FlutterMethodChannel

  /// The sheet that is up, kept until Apple answers.
  private var appleSignIn: AppleSignIn?

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: NativeChannel.name, binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "cacheDir":
        result(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.path)
      // Dart only sends https links to Orbit's own pages (OrbitBridge.isPublicLink).
      case "openUrl":
        guard let text = call.arguments as? String, text.hasPrefix("https://"), let url = URL(string: text) else {
          return result(false)
        }
        UIApplication.shared.open(url, options: [:]) { opened in result(opened) }
      case "moveTaskToBack", "setVolumeKeys":
        result(nil)
      case "appleSignIn":
        guard let self else { return result(FlutterMethodNotImplemented) }
        guard let nonce = call.arguments as? String, !nonce.isEmpty else {
          return result(FlutterError(code: "failed", message: "No nonce for Apple", details: nil))
        }
        guard self.appleSignIn == nil else {
          return result(FlutterError(code: "busy", message: "Apple's sheet is already up", details: nil))
        }
        let request = AppleSignIn(nonce: nonce) { [weak self] answer in
          self?.appleSignIn = nil
          result(answer)
        }
        self.appleSignIn = request
        request.start()
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}

/// One Sign in with Apple request: asks for the name and e-mail, and hands Apple the SHA-256 (hex) of [nonce], which
/// comes back inside the identity token for Firebase to check against the nonce itself.
private final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let nonce: String
  private var finish: ((Any) -> Void)?

  init(nonce: String, finish: @escaping (Any) -> Void) {
    self.nonce = nonce
    self.finish = finish
  }

  func start() {
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    controller.performRequests()
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
    return windows.first { $0.isKeyWindow } ?? windows.first ?? ASPresentationAnchor()
  }

  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let tokenData = credential.identityToken, let token = String(data: tokenData, encoding: .utf8),
      let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8)
    else {
      return done(FlutterError(code: "invalidResponse", message: "Apple sent no identity token", details: nil))
    }
    var answer: [String: Any] = ["identityToken": token, "authorizationCode": code, "user": credential.user]
    if let email = credential.email { answer["email"] = email }
    if let given = credential.fullName?.givenName { answer["givenName"] = given }
    if let family = credential.fullName?.familyName { answer["familyName"] = family }
    done(answer)
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let code: String
    switch (error as? ASAuthorizationError)?.code {
    case .canceled: code = "canceled"
    case .failed: code = "failed"
    case .invalidResponse: code = "invalidResponse"
    case .notHandled: code = "notHandled"
    case .notInteractive: code = "notInteractive"
    default: code = "unknown"
    }
    done(FlutterError(code: code, message: error.localizedDescription, details: nil))
  }

  private func done(_ answer: Any) {
    finish?(answer)
    finish = nil
  }
}
