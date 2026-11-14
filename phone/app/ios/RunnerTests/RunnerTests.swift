import Security
import XCTest

@testable import Runner

/// AdbKey: the key in adb's android_pubkey form and the signature adbd checks, with a key made in memory (never the
/// Keychain). Its output was also checked byte for byte against AOSP's android_pubkey_encode and AdbKey.kt's form.
class RunnerTests: XCTestCase {
  private func memoryKey() throws -> SecKey {
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
      kSecAttrKeySizeInBits as String: 2048,
      kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: false] as [String: Any],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw error!.takeRetainedValue() as Error
    }
    return key
  }

  func testPublicKeyIsAdbsStructWithNameAndNul() throws {
    let key = try memoryKey()
    let text = try AdbKey(source: { key }).publicKey()
    XCTAssertTrue(text.hasSuffix(" orbit@phone\u{0}"))
    let blob = try XCTUnwrap(Data(base64Encoded: String(text.dropLast(" orbit@phone\u{0}".count))))
    XCTAssertEqual(blob.count, 524)
    let bytes = [UInt8](blob)
    func word(_ at: Int) -> UInt32 {
      UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
    }
    XCTAssertEqual(word(0), 64)
    XCTAssertEqual(word(520), 65537)
    // n0inv × n0 = -1 (mod 2^32).
    XCTAssertEqual(word(4) &* word(8), UInt32.max)
    // The modulus is the key's own.
    var error: Unmanaged<CFError>?
    let der = try XCTUnwrap(SecKeyCopyExternalRepresentation(SecKeyCopyPublicKey(key)!, &error) as Data?)
    let (modulus, _) = try AdbKey.rsaPublicKey(der: der)
    XCTAssertEqual(Array(bytes[8..<264]), modulus.reversed())
  }

  func testRSquaredOnASmallModulus() {
    // n = 0xF1234567 (little-endian bytes): R = 2^32, so rr = 2^64 mod n = (2^32 mod n)^2 mod n.
    let n: UInt64 = 0xF123_4567
    let r = (UInt64(1) << 32) % n
    let expected = (r * r) % n
    let rr = AdbKey.rSquared(modulus: [0x67, 0x45, 0x23, 0xF1])
    let got = UInt64(rr[0]) | UInt64(rr[1]) << 8 | UInt64(rr[2]) << 16 | UInt64(rr[3]) << 24
    XCTAssertEqual(got, expected)
  }

  func testSignatureIsPkcs1Sha1OverTheToken() throws {
    let key = try memoryKey()
    let token = Data((0..<20).map { UInt8($0 * 13 & 0xff) })
    let signature = try AdbKey(source: { key }).sign(token)
    XCTAssertEqual(signature.count, 256)
    var error: Unmanaged<CFError>?
    XCTAssertTrue(
      SecKeyVerifySignature(
        SecKeyCopyPublicKey(key)!, .rsaSignatureDigestPKCS1v15SHA1, token as CFData, signature as CFData, &error))
  }

  func testTheKeyIsMadeOnce() throws {
    let key = try memoryKey()
    var made = 0
    let adb = AdbKey(source: {
      made += 1
      return key
    })
    _ = try adb.publicKey()
    _ = try adb.sign(Data(count: 20))
    XCTAssertEqual(made, 1)
  }
}
