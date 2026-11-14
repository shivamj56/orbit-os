import Foundation
import Security

#if canImport(Flutter)
  import Flutter
#endif

/// The app's ADB key for Orbit Setup, behind the channel `dev.shiv.orbit/adbkey` (phone/SPEC.md, `setupConnect`): the
/// iPhone's side of android/app/src/main/kotlin/dev/shiv/orbit/AdbKey.kt, with the same two operations and answers.
///
/// The 2048-bit RSA key is made once and kept in the Keychain (this phone only, readable after the first unlock), never
/// shown to Dart. Two operations:
///
/// - `sign(token)`: the 20-byte AUTH token signed the way adbd verifies it — PKCS#1 v1.5 over the SHA-1 DigestInfo of
///   the token (Security's `rsaSignatureDigestPKCS1v15SHA1` takes the token as the digest and adds the DigestInfo
///   prefix itself). 256 bytes.
/// - `publicKey()`: the key in adb's `android_pubkey` form (a little-endian RSAPublicKey struct, base64) with the
///   trailing ` name\u{0}` adb appends.
///
/// Nothing here is logged.
final class AdbKey {
  static let channelName = "dev.shiv.orbit/adbkey"

  /// The Keychain item's tag.
  static let tag = Data("dev.shiv.orbit.adbkey".utf8)

  static let modulusSize = 2048 / 8

  /// Where the key comes from: the Keychain in the app ([keychainKey]), a key made in memory in tests.
  private let source: () throws -> SecKey
  private let lock = NSLock()
  private var key: SecKey?

  init(source: @escaping () throws -> SecKey = AdbKey.keychainKey) {
    self.source = source
  }

  /// PKCS#1 v1.5 signature over the SHA-1 DigestInfo of [token], as adbd's RSA_verify(NID_sha1, …) expects.
  func sign(_ token: Data) throws -> Data {
    let key = try privateKey()
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(key, .rsaSignatureDigestPKCS1v15SHA1, token as CFData, &error) else {
      throw AdbKeyError.security(error?.takeRetainedValue())
    }
    return signature as Data
  }

  /// The public key in adb's android_pubkey base64 form, with a trailing identity and a NUL, as adb sends it.
  func publicKey() throws -> String {
    let key = try privateKey()
    guard let publicKey = SecKeyCopyPublicKey(key) else { throw AdbKeyError.badKey }
    var error: Unmanaged<CFError>?
    guard let der = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw AdbKeyError.security(error?.takeRetainedValue())
    }
    let (modulus, exponent) = try AdbKey.rsaPublicKey(der: der)
    return AdbKey.androidPubkey(modulus: modulus, exponent: exponent).base64EncodedString() + " orbit@phone\u{0}"
  }

  private func privateKey() throws -> SecKey {
    lock.lock()
    defer { lock.unlock() }
    if let key { return key }
    let made = try source()
    key = made
    return made
  }

  // ---- the key, made once and kept in the Keychain ----

  /// The private key under [tag], made the first time it is asked for.
  static func keychainKey() throws -> SecKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let item, CFGetTypeID(item) == SecKeyGetTypeID() {
      return (item as! SecKey)
    }
    guard status == errSecItemNotFound else { throw AdbKeyError.keychain(status) }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
      kSecAttrKeySizeInBits as String: 2048,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      ] as [String: Any],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw AdbKeyError.security(error?.takeRetainedValue())
    }
    return key
  }

  // ---- adb's android_pubkey form (system/core/libcrypto_utils/android_pubkey.cpp) ----

  /// The modulus and exponent (big-endian, no leading zeros) of a PKCS#1 RSAPublicKey,
  /// `SEQUENCE { INTEGER n, INTEGER e }`, the DER that Security exports for an RSA public key.
  static func rsaPublicKey(der: Data) throws -> (modulus: [UInt8], exponent: [UInt8]) {
    let bytes = [UInt8](der)
    var at = 0
    let sequence = try element(bytes, &at, tag: 0x30)
    var inside = 0
    var modulus = try element(sequence, &inside, tag: 0x02)
    var exponent = try element(sequence, &inside, tag: 0x02)
    while modulus.first == 0 { modulus.removeFirst() }
    while exponent.first == 0 { exponent.removeFirst() }
    guard modulus.count == modulusSize, (1...4).contains(exponent.count) else { throw AdbKeyError.badKey }
    return (modulus, exponent)
  }

  /// The RSAPublicKey struct adbd reads, all little-endian: the modulus size in 32-bit words, n0inv = -1/n mod 2^32,
  /// the modulus, rr = R² mod n with R = 2^2048, and the exponent. 524 bytes.
  static func androidPubkey(modulus: [UInt8], exponent: [UInt8]) -> Data {
    let n = [UInt8](modulus.reversed())
    let n0 = UInt32(n[0]) | UInt32(n[1]) << 8 | UInt32(n[2]) << 16 | UInt32(n[3]) << 24
    // Newton's iteration doubles the bits of the inverse each round: an odd n0 is its own inverse mod 8, so five rounds
    // give all 32.
    var inverse = n0
    for _ in 0..<5 { inverse = inverse &* (2 &- n0 &* inverse) }
    var e: UInt32 = 0
    for byte in exponent { e = e << 8 | UInt32(byte) }

    var blob = Data(capacity: 4 + 4 + modulusSize + modulusSize + 4)
    blob.append(littleEndian(UInt32(modulusSize / 4)))
    blob.append(littleEndian(0 &- inverse))
    blob.append(contentsOf: n)
    blob.append(contentsOf: rSquared(modulus: n))
    blob.append(littleEndian(e))
    return blob
  }

  /// R² mod n, R = 2^(8 × n.count), for a little-endian [n]: 1 doubled 2 × 8 × n.count times modulo n. The value stays
  /// below n, so after each doubling one subtraction at most brings it back.
  static func rSquared(modulus n: [UInt8]) -> [UInt8] {
    let words = n.count / 4 + 1
    var m = [UInt32](repeating: 0, count: words)
    for i in 0..<n.count { m[i / 4] |= UInt32(n[i]) << (8 * (i % 4)) }
    var r = [UInt32](repeating: 0, count: words)
    r[0] = 1
    for _ in 0..<(n.count * 8 * 2) {
      var carry: UInt32 = 0
      for i in 0..<words {
        let out = r[i] >> 31
        r[i] = r[i] << 1 | carry
        carry = out
      }
      if !below(r, m) {
        var borrow: Int64 = 0
        for i in 0..<words {
          let difference = Int64(r[i]) - Int64(m[i]) - borrow
          r[i] = UInt32(truncatingIfNeeded: difference)
          borrow = difference < 0 ? 1 : 0
        }
      }
    }
    var out = [UInt8](repeating: 0, count: n.count)
    for i in 0..<n.count { out[i] = UInt8(truncatingIfNeeded: r[i / 4] >> (8 * (i % 4))) }
    return out
  }

  /// a < b, both little-endian words of the same length.
  private static func below(_ a: [UInt32], _ b: [UInt32]) -> Bool {
    for i in stride(from: a.count - 1, through: 0, by: -1) where a[i] != b[i] {
      return a[i] < b[i]
    }
    return false
  }

  /// The content of the DER element with [tag] at [at], which moves past it.
  private static func element(_ bytes: [UInt8], _ at: inout Int, tag: UInt8) throws -> [UInt8] {
    guard at + 2 <= bytes.count, bytes[at] == tag else { throw AdbKeyError.badKey }
    var length = Int(bytes[at + 1])
    at += 2
    if length & 0x80 != 0 {
      let count = length & 0x7f
      guard (1...4).contains(count), at + count <= bytes.count else { throw AdbKeyError.badKey }
      length = 0
      for _ in 0..<count {
        length = length << 8 | Int(bytes[at])
        at += 1
      }
    }
    guard at + length <= bytes.count else { throw AdbKeyError.badKey }
    defer { at += length }
    return Array(bytes[at..<(at + length)])
  }

  private static func littleEndian(_ value: UInt32) -> Data {
    withUnsafeBytes(of: value.littleEndian) { Data($0) }
  }
}

enum AdbKeyError: Error {
  case keychain(OSStatus)
  case security(CFError?)
  case badKey
}

#if canImport(Flutter)
  extension AdbKey {
    /// Answers `sign` and `publicKey` on [channelName]. Making the key the first time takes a moment, so the work runs
    /// on a queue of its own and the answer goes back on the main thread, where Flutter wants it.
    func register(with messenger: FlutterBinaryMessenger) -> FlutterMethodChannel {
      let channel = FlutterMethodChannel(name: AdbKey.channelName, binaryMessenger: messenger)
      channel.setMethodCallHandler { [weak self] call, result in
        guard let self else { return result(FlutterMethodNotImplemented) }
        let work: () throws -> Any
        switch call.method {
        case "sign":
          guard let token = call.arguments as? FlutterStandardTypedData else {
            return result(FlutterError(code: "adbkey", message: "ADB key operation failed", details: nil))
          }
          work = { try FlutterStandardTypedData(bytes: self.sign(token.data)) }
        case "publicKey":
          work = { try self.publicKey() }
        default:
          return result(FlutterMethodNotImplemented)
        }
        AdbKey.queue.async {
          let answer: Any
          do {
            answer = try work()
          } catch {
            answer = FlutterError(code: "adbkey", message: "ADB key operation failed", details: nil)
          }
          DispatchQueue.main.async { result(answer) }
        }
      }
      return channel
    }

    private static let queue = DispatchQueue(label: "dev.shiv.orbit.adbkey")
  }
#endif
