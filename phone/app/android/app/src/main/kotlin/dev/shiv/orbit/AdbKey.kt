package dev.shiv.orbit

import android.content.Context
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPrivateCrtKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher

/**
 * The app's ADB key for Orbit Setup, behind the channel `dev.shiv.orbit/adbkey` (phone/SPEC.md, `setupConnect`).
 *
 * The 2048-bit RSA key is made once and kept in the app's private files (`adb_key.pk8` / `adb_key.pub`), never shown
 * to Dart. Two operations:
 *
 * - `sign(token)`: the 20-byte AUTH token signed the way adbd verifies it — PKCS#1 v1.5 over the SHA-1 DigestInfo of
 *   the token (so, the ASN.1 SHA-1 prefix prepended to the token, then a raw RSA private-key operation). 256 bytes.
 * - `publicKey()`: the key in adb's `android_pubkey` form (a little-endian RSAPublicKey struct, base64) with the
 *   trailing ` name\u0000` adb appends.
 *
 * The private key lives in internal storage; nothing here is logged.
 */
class AdbKey(private val context: Context) {
    private var channel: MethodChannel? = null

    fun register(messenger: BinaryMessenger) {
        val channel = MethodChannel(messenger, CHANNEL)
        channel.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "sign" -> result.success(sign(call.arguments as ByteArray))
                    "publicKey" -> result.success(publicKey())
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("adbkey", "ADB key operation failed", null)
            }
        }
        this.channel = channel
    }

    fun unregister() {
        channel?.setMethodCallHandler(null)
        channel = null
    }

    /** PKCS#1 v1.5 signature over the SHA-1 DigestInfo of [token], as adbd's RSA_verify(NID_sha1, …) expects. */
    private fun sign(token: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
        cipher.init(Cipher.ENCRYPT_MODE, privateKey())
        cipher.update(SHA1_DIGEST_INFO_PREFIX)
        return cipher.doFinal(token)
    }

    /** The public key in adb's android_pubkey base64 form, with a trailing identity and a NUL, as adb sends it. */
    private fun publicKey(): String {
        val key = publicKeyObject()
        val modulus = key.modulus
        val wordCount = ANDROID_PUBKEY_MODULUS_SIZE / 4
        val r32 = BigInteger.ONE.shiftLeft(32)
        val n0 = modulus.mod(r32)
        val n0inv = r32.subtract(n0.modInverse(r32)).mod(r32).toLong()
        // rr = R^2 mod n, with R = 2^(modulus bits) = 2^2048, so rr = 2^4096 mod n.
        val rr = BigInteger.ONE.shiftLeft(ANDROID_PUBKEY_MODULUS_SIZE * 8 * 2).mod(modulus)

        val blob = ByteBuffer.allocate(4 + 4 + ANDROID_PUBKEY_MODULUS_SIZE + ANDROID_PUBKEY_MODULUS_SIZE + 4)
        blob.order(ByteOrder.LITTLE_ENDIAN)
        blob.putInt(wordCount)
        blob.putInt(n0inv.toInt())
        blob.put(toLittleEndian(modulus, ANDROID_PUBKEY_MODULUS_SIZE))
        blob.put(toLittleEndian(rr, ANDROID_PUBKEY_MODULUS_SIZE))
        blob.putInt(key.publicExponent.toInt())

        val base64 = Base64.encodeToString(blob.array(), Base64.NO_WRAP)
        return "$base64 orbit@phone\u0000"
    }

    // ---- the key, made once and kept in internal storage ----

    private fun privateKey(): RSAPrivateCrtKey {
        ensureKey()
        val der = File(context.filesDir, PRIVATE_FILE).readBytes()
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(der)) as RSAPrivateCrtKey
    }

    private fun publicKeyObject(): RSAPublicKey {
        ensureKey()
        val der = File(context.filesDir, PUBLIC_FILE).readBytes()
        return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der)) as RSAPublicKey
    }

    @Synchronized
    private fun ensureKey() {
        val priv = File(context.filesDir, PRIVATE_FILE)
        val pub = File(context.filesDir, PUBLIC_FILE)
        if (priv.isFile && pub.isFile) return
        val generator = KeyPairGenerator.getInstance("RSA")
        generator.initialize(2048)
        val pair = generator.generateKeyPair()
        priv.writeBytes(PKCS8EncodedKeySpec(pair.private.encoded).encoded)
        pub.writeBytes(pair.public.encoded)
    }

    private fun toLittleEndian(value: BigInteger, length: Int): ByteArray {
        // BigInteger is big-endian with a possible leading sign byte; take the low [length] bytes, reversed.
        var be = value.toByteArray()
        if (be.size > length) be = be.copyOfRange(be.size - length, be.size)
        val out = ByteArray(length)
        for (i in be.indices) out[i] = be[be.size - 1 - i]
        return out
    }

    private companion object {
        const val CHANNEL = "dev.shiv.orbit/adbkey"
        const val PRIVATE_FILE = "adb_key.pk8"
        const val PUBLIC_FILE = "adb_key.pub"
        const val ANDROID_PUBKEY_MODULUS_SIZE = 2048 / 8

        // ASN.1 DigestInfo prefix for SHA-1 (RFC 8017), prepended to the 20-byte token before the RSA operation.
        val SHA1_DIGEST_INFO_PREFIX = byteArrayOf(
            0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e,
            0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14,
        )
    }
}
