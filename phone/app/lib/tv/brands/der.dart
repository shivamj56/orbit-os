/// The RSA public key inside an X.509 certificate, for the Android TV pairing hash (atv_proto.dart, Polo.secretFor),
/// which takes both certificates' modulus and exponent.
///
/// A tiny DER reader, just enough to walk a certificate to its SubjectPublicKeyInfo (RFC 5280, 4.1) and the
/// RSAPublicKey inside it (RFC 8017, A.1.1). It checks the structure, not signatures: the TV's certificate is
/// self-signed anyway, and what ties the two sides together is the hash over both keys and the code.
library;

import 'dart:convert';
import 'dart:typed_data';

/// An RSA public key. Both numbers are unsigned big-endian bytes without leading zeros, the form the pairing hash
/// wants (a DER INTEGER's sign byte is dropped).
class RsaPublicKey {
  const RsaPublicKey(this.modulus, this.exponent);

  final Uint8List modulus;
  final Uint8List exponent;

  @override
  String toString() => 'RsaPublicKey(${modulus.length * 8}-bit)';
}

/// The RSA key of the X.509 certificate in [der]. Throws [FormatException] when [der] is not a certificate, or its
/// key is not RSA.
RsaPublicKey rsaPublicKeyOfCertificate(List<int> der) {
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  final certificate = _Der(der).sequence();
  // TBSCertificate ::= SEQUENCE { [0] version (absent for v1), serialNumber, signature, issuer, validity, subject,
  //                               subjectPublicKeyInfo, ... }
  final tbs = certificate.sequence();
  if (tbs.nextTag == 0xa0) tbs.read(0xa0);
  tbs.read(0x02);
  tbs.read(0x30);
  tbs.read(0x30);
  tbs.read(0x30);
  tbs.read(0x30);
  return rsaPublicKeyOfSpki(tbs.read(0x30, whole: true));
}

/// The RSA key in a DER SubjectPublicKeyInfo (what Java's `PublicKey.getEncoded()` gives). Throws [FormatException].
RsaPublicKey rsaPublicKeyOfSpki(List<int> spki) {
  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  final info = _Der(spki).sequence();
  final algorithm = info.sequence();
  if (!_same(algorithm.read(0x06), _rsaEncryption)) throw const FormatException('The key is not an RSA key.');
  final bits = info.read(0x03);
  if (bits.isEmpty || bits[0] != 0) throw const FormatException('The key is not a whole number of bytes.');
  // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
  final key = _Der(Uint8List.sublistView(bits, 1)).sequence();
  final modulus = key.read(0x02);
  final exponent = key.read(0x02);
  if (_negative(modulus) || _negative(exponent)) throw const FormatException('An RSA number cannot be negative.');
  final n = _unsigned(modulus);
  final e = _unsigned(exponent);
  if (n.isEmpty || e.isEmpty) throw const FormatException('An RSA number cannot be zero.');
  return RsaPublicKey(n, e);
}

/// The DER bytes of the first PEM block labelled [label] ("CERTIFICATE", "PRIVATE KEY"). Throws [FormatException].
Uint8List derOfPem(String pem, {String label = 'CERTIFICATE'}) {
  final begin = '-----BEGIN $label-----';
  final end = '-----END $label-----';
  final from = pem.indexOf(begin);
  final to = from < 0 ? -1 : pem.indexOf(end, from + begin.length);
  if (from < 0 || to < 0) throw FormatException('There is no $label in the PEM text.');
  return base64.decode(pem.substring(from + begin.length, to).replaceAll(RegExp(r'\s'), ''));
}

/// rsaEncryption, 1.2.840.113549.1.1.1 (RFC 8017).
const List<int> _rsaEncryption = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

bool _same(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

bool _negative(Uint8List integer) => integer.isNotEmpty && integer[0] & 0x80 != 0;

Uint8List _unsigned(Uint8List integer) {
  var start = 0;
  while (start < integer.length && integer[start] == 0) {
    start++;
  }
  return Uint8List.fromList(integer.sublist(start));
}

/// A cursor over the elements of one DER constructed value (or of the whole input).
class _Der {
  _Der(List<int> bytes) : this._(bytes is Uint8List ? bytes : Uint8List.fromList(bytes), 0, bytes.length);

  _Der._(this._bytes, this._pos, this._end);

  final Uint8List _bytes;
  int _pos;
  final int _end;

  /// The next element's tag, or -1 at the end.
  int get nextTag => _pos < _end ? _bytes[_pos] : -1;

  /// The next element, which must have [tag]: its content, or with [whole] the element itself (tag and length too).
  Uint8List read(int tag, {bool whole = false}) {
    final at = _pos;
    final (found, start, end) = _next();
    if (found != tag) {
      throw FormatException('Expected DER tag 0x${tag.toRadixString(16)}, found 0x${found.toRadixString(16)}.');
    }
    return Uint8List.sublistView(_bytes, whole ? at : start, end);
  }

  /// The next element, a SEQUENCE, to read inside.
  _Der sequence() {
    final (tag, start, end) = _next();
    if (tag != 0x30) throw FormatException('Expected a DER SEQUENCE, found tag 0x${tag.toRadixString(16)}.');
    return _Der._(_bytes, start, end);
  }

  (int, int, int) _next() {
    if (_pos >= _end) throw const FormatException('The DER data ends early.');
    final tag = _bytes[_pos++];
    // High tag numbers (and BER's indefinite lengths below) never occur in a certificate's key.
    if (tag & 0x1f == 0x1f) throw const FormatException('DER tags above 30 are not used here.');
    if (_pos >= _end) throw const FormatException('The DER data ends early.');
    var length = _bytes[_pos++];
    if (length & 0x80 != 0) {
      final count = length & 0x7f;
      if (count == 0 || count > 4) throw const FormatException('A DER length must be definite and short.');
      length = 0;
      for (var i = 0; i < count; i++) {
        if (_pos >= _end) throw const FormatException('The DER data ends early.');
        length = length << 8 | _bytes[_pos++];
      }
    }
    if (length > _end - _pos) throw const FormatException('A DER element runs past its end.');
    final start = _pos;
    _pos += length;
    return (tag, start, _pos);
  }
}
