package dev.shiv.orbit

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.Signature
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The phone's identity for Google TV / Android TV remote control, behind the channel `dev.shiv.orbit/atvidentity`
 * (lib/tv/brands/android_tv.dart, `PlatformRemoteIdentity`).
 *
 * Google's remote protocol knows a phone by its TLS client certificate: the TV pairs with it once (the code on its
 * screen), then takes only that certificate on its remote port. So the certificate must stay the same for the app's
 * life. On the first `load` an RSA-2048 key and a self-signed X.509 v3 certificate are made ([AtvCertificate]) and
 * kept in the app's private files (`atv_key.pk8`, `atv_cert.der`); every `load` answers
 * `{"cert": PEM, "key": PEM}` (the key in PKCS#8, "PRIVATE KEY"), which Dart's TLS presents to the TV.
 *
 * Making a key takes a moment on a slow phone, so `load` runs off the main thread. Nothing here is logged.
 */
class AtvIdentity(private val context: Context) {
    private var channel: MethodChannel? = null
    private val main = Handler(Looper.getMainLooper())

    fun register(messenger: BinaryMessenger) {
        val channel = MethodChannel(messenger, CHANNEL)
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "load" -> Thread({
                    val answer = try {
                        load()
                    } catch (e: Exception) {
                        null
                    }
                    main.post {
                        if (answer != null) {
                            result.success(answer)
                        } else {
                            result.error("atvidentity", "The Android TV identity could not be made", null)
                        }
                    }
                }, "orbit-atvidentity").start()
                else -> result.notImplemented()
            }
        }
        this.channel = channel
    }

    fun unregister() {
        channel?.setMethodCallHandler(null)
        channel = null
    }

    /** The kept identity as PEM, made first if there is none (one at a time: two loads never make two keys). */
    @Synchronized
    private fun load(): Map<String, String> {
        val keyFile = File(context.filesDir, KEY_FILE)
        val certFile = File(context.filesDir, CERT_FILE)
        if (!keyFile.isFile || !certFile.isFile) {
            val pair = KeyPairGenerator.getInstance("RSA").run {
                initialize(KEY_BITS)
                generateKeyPair()
            }
            val now = Date()
            val until = Calendar.getInstance(TimeZone.getTimeZone("UTC")).run {
                time = now
                add(Calendar.YEAR, VALID_YEARS)
                time
            }
            // Positive and never zero (RFC 5280 4.1.2.2), 16 bytes at most.
            val serial = BigInteger(SERIAL_BITS, SecureRandom()).add(BigInteger.ONE)
            val certificate = AtvCertificate.build(pair, COMMON_NAME, serial, now, until)
            // The old certificate goes before the new key lands: a certificate on disk always sits beside its own key.
            certFile.delete()
            writeWhole(keyFile, pair.private.encoded)
            writeWhole(certFile, certificate)
        }
        return mapOf(
            "cert" to pem("CERTIFICATE", certFile.readBytes()),
            "key" to pem("PRIVATE KEY", keyFile.readBytes()),
        )
    }

    /** Through a temporary file and a rename, so a file is either whole or not there. */
    private fun writeWhole(file: File, bytes: ByteArray) {
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.writeBytes(bytes)
        if (!temporary.renameTo(file)) {
            file.delete()
            if (!temporary.renameTo(file)) throw IOException("Could not keep ${file.name}")
        }
    }

    /** PEM: the base64 of [der] in 64-column lines between the BEGIN and END lines of [label]. */
    private fun pem(label: String, der: ByteArray): String {
        val base64 = Base64.encodeToString(der, Base64.NO_WRAP)
        val out = StringBuilder()
        out.append("-----BEGIN ").append(label).append("-----\n")
        var start = 0
        while (start < base64.length) {
            val end = minOf(start + PEM_COLUMNS, base64.length)
            out.append(base64, start, end).append('\n')
            start = end
        }
        out.append("-----END ").append(label).append("-----\n")
        return out.toString()
    }

    private companion object {
        const val CHANNEL = "dev.shiv.orbit/atvidentity"
        const val KEY_FILE = "atv_key.pk8"
        const val CERT_FILE = "atv_cert.der"
        const val COMMON_NAME = "Orbit"
        const val KEY_BITS = 2048
        const val SERIAL_BITS = 127
        const val VALID_YEARS = 30
        const val PEM_COLUMNS = 64
    }
}

// ---- AtvCertificate: plain JVM code (no Android classes), so it can be checked on a computer ----

/**
 * A self-signed X.509 v3 certificate (RFC 5280, 4.1) written as DER by hand, since Android has no public API that
 * makes one:
 *
 *     Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
 *     TBSCertificate ::= SEQUENCE { [0] EXPLICIT version (v3), serialNumber, signature, issuer, validity, subject,
 *                                   subjectPublicKeyInfo }
 *
 * The issuer and the subject are both CN=[commonName]; the SubjectPublicKeyInfo is the key's own encoding
 * (`PublicKey.getEncoded()` is already that DER); the TBSCertificate is signed with SHA256withRSA. No extensions: the
 * TV needs only the key, in a certificate that stays the same.
 */
internal object AtvCertificate {
    fun build(pair: KeyPair, commonName: String, serial: BigInteger, notBefore: Date, notAfter: Date): ByteArray {
        val algorithm = derSequence(SHA256_WITH_RSA_OID, DER_NULL)
        val name = derSequence(
            derSet(derSequence(COMMON_NAME_OID, derTlv(UTF8_STRING, commonName.toByteArray(Charsets.UTF_8)))),
        )
        val tbs = derSequence(
            derTlv(VERSION_TAG, derInteger(BigInteger.valueOf(2))),
            derInteger(serial),
            algorithm,
            name,
            derSequence(derTime(notBefore), derTime(notAfter)),
            name,
            pair.public.encoded,
        )
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(pair.private)
            update(tbs)
            sign()
        }
        return derSequence(tbs, algorithm, derTlv(BIT_STRING, byteArrayOf(0) + signature))
    }

    /** RFC 5280 4.1.2.5: UTCTime for the years 1950 to 2049, GeneralizedTime from 2050 (the end of 30 years). */
    private fun derTime(date: Date): ByteArray {
        val utc = TimeZone.getTimeZone("UTC")
        val year = Calendar.getInstance(utc).run {
            time = date
            get(Calendar.YEAR)
        }
        val short = year in 1950..2049
        val format = SimpleDateFormat(if (short) "yyMMddHHmmss'Z'" else "yyyyMMddHHmmss'Z'", Locale.US)
        format.timeZone = utc
        return derTlv(if (short) UTC_TIME else GENERALIZED_TIME, format.format(date).toByteArray(Charsets.US_ASCII))
    }

    /** A DER INTEGER: BigInteger's own bytes are already the shortest two's complement, as DER wants. */
    private fun derInteger(value: BigInteger) = derTlv(INTEGER, value.toByteArray())

    private fun derSequence(vararg parts: ByteArray) = derTlv(SEQUENCE, concat(parts))

    private fun derSet(vararg parts: ByteArray) = derTlv(SET, concat(parts))

    /** Tag, length (short form below 128, else long form) and content. */
    private fun derTlv(tag: Int, content: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(content.size + 6)
        out.write(tag)
        val length = content.size
        when {
            length < 0x80 -> out.write(length)
            length < 0x100 -> {
                out.write(0x81)
                out.write(length)
            }
            length < 0x10000 -> {
                out.write(0x82)
                out.write(length shr 8)
                out.write(length and 0xff)
            }
            else -> {
                out.write(0x83)
                out.write(length shr 16)
                out.write((length shr 8) and 0xff)
                out.write(length and 0xff)
            }
        }
        out.write(content, 0, content.size)
        return out.toByteArray()
    }

    private fun concat(parts: Array<out ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        for (part in parts) out.write(part, 0, part.size)
        return out.toByteArray()
    }

    private const val INTEGER = 0x02
    private const val BIT_STRING = 0x03
    private const val UTF8_STRING = 0x0c
    private const val UTC_TIME = 0x17
    private const val GENERALIZED_TIME = 0x18
    private const val SEQUENCE = 0x30
    private const val SET = 0x31
    private const val VERSION_TAG = 0xa0

    /** sha256WithRSAEncryption, 1.2.840.113549.1.1.11 (RFC 8017), as a whole OBJECT IDENTIFIER element. */
    private val SHA256_WITH_RSA_OID = byteArrayOf(
        0x06, 0x09, 0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x0b,
    )

    /** The algorithm's parameters: NULL. */
    private val DER_NULL = byteArrayOf(0x05, 0x00)

    /** id-at-commonName, 2.5.4.3. */
    private val COMMON_NAME_OID = byteArrayOf(0x06, 0x03, 0x55, 0x04, 0x03)
}
