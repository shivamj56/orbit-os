/// A minimal protobuf codec for Google's Android TV remote protocol (v2), the one the Google TV phone app speaks:
/// the pairing messages ("Polo", polo.proto) on port 6467 and the remote messages (remotemessage.proto) on 6466.
///
/// Every field number, the framing, the pairing hash and the handshake follow androidtvremote2 by tronikos (Apache-2.0,
/// https://github.com/tronikos/androidtvremote2), reimplemented here rather than copied. Its .proto files in turn come
/// from Google's google-tv-pairing-protocol and from louis49/androidtv-remote.
///
/// Only what Orbit needs is here: varints, length-delimited fields (bytes, strings, nested messages), and skipping
/// anything else. On the wire each message goes after its own length as a varint ([frame], [FrameReader]).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

// ---- the wire format ----

const int _wireVarint = 0;
const int _wireFixed64 = 1;
const int _wireLength = 2;
const int _wireFixed32 = 5;

/// Builds one message. Fields come out in the order they are written: write them in field-number order, as protoc
/// does, so the bytes match what other implementations send.
class ProtoWriter {
  final BytesBuilder _out = BytesBuilder(copy: false);

  /// A varint field (int32, uint32, enum, bool). A negative number takes ten bytes, as protobuf writes an int32.
  void varint(int field, int value) {
    _key(field, _wireVarint);
    _varint(_out, value);
  }

  void boolean(int field, bool value) => varint(field, value ? 1 : 0);

  void bytes(int field, List<int> value) {
    _key(field, _wireLength);
    _varint(_out, value.length);
    _out.add(value);
  }

  void string(int field, String value) => bytes(field, utf8.encode(value));

  /// A nested message. Written even when it is empty: an empty message still says "this one", and some messages
  /// (remote_set_active from the TV, a ping answer for 0) are nothing else.
  void message(int field, ProtoWriter inner) => bytes(field, inner.toBytes());

  Uint8List toBytes() => _out.toBytes();

  void _key(int field, int wire) {
    if (field < 1) throw ArgumentError.value(field, 'field');
    _varint(_out, field << 3 | wire);
  }
}

void _varint(BytesBuilder out, int value) {
  // `>>>` treats a negative number as its 64-bit two's complement, which is how protobuf writes a negative int32.
  var rest = value;
  for (var i = 0; i < 10; i++) {
    final low = rest & 0x7f;
    rest = rest >>> 7;
    if (rest == 0) {
      out.addByte(low);
      return;
    }
    out.addByte(low | 0x80);
  }
}

/// [value] as a varint on its own (the length in front of each message).
Uint8List encodeVarint(int value) {
  final out = BytesBuilder(copy: false);
  _varint(out, value);
  return out.toBytes();
}

/// One decoded message: each field's values by number, in arrival order. A varint is kept as an int, a
/// length-delimited field as its bytes; fixed-width fields are skipped (no message used here has one).
///
/// Absent fields read as their proto3 default (0, false, ''), and for a field sent twice the last one counts.
class ProtoMessage {
  ProtoMessage._(this._fields);

  /// Throws [FormatException] for bytes that are not a protobuf message.
  factory ProtoMessage.decode(List<int> bytes) {
    final fields = <int, List<Object>>{};
    var pos = 0;
    while (pos < bytes.length) {
      final (key, afterKey) = _readVarint(bytes, pos);
      pos = afterKey;
      final field = key >>> 3;
      final wire = key & 7;
      if (field < 1) throw const FormatException('A protobuf field number must be positive.');
      switch (wire) {
        case _wireVarint:
          final (value, next) = _readVarint(bytes, pos);
          (fields[field] ??= []).add(value);
          pos = next;
        case _wireLength:
          final (length, start) = _readVarint(bytes, pos);
          if (length < 0 || length > bytes.length - start) throw const FormatException('A protobuf field runs out.');
          (fields[field] ??= []).add(Uint8List.fromList(bytes.sublist(start, start + length)));
          pos = start + length;
        case _wireFixed64:
          pos += 8;
        case _wireFixed32:
          pos += 4;
        default:
          throw FormatException('Protobuf wire type $wire is not used here.');
      }
      if (pos > bytes.length) throw const FormatException('A protobuf field runs out.');
    }
    return ProtoMessage._(fields);
  }

  final Map<int, List<Object>> _fields;

  bool has(int field) => _fields.containsKey(field);

  /// An int32 (also enums): the varint's low 32 bits, signed.
  int int32(int field) => _int(field).toSigned(32);

  int uint32(int field) => _int(field).toUnsigned(32);

  bool boolean(int field) => _int(field) != 0;

  String string(int field) => utf8.decode(bytes(field), allowMalformed: true);

  Uint8List bytes(int field) {
    final value = _last(field);
    return value is Uint8List ? value : Uint8List(0);
  }

  /// The nested message, or null when the field is absent. Throws [FormatException] if it does not decode.
  ProtoMessage? message(int field) {
    final value = _last(field);
    return value is Uint8List ? ProtoMessage.decode(value) : null;
  }

  /// Every occurrence of a repeated message field.
  List<ProtoMessage> messages(int field) => [
    for (final value in _fields[field] ?? const <Object>[])
      if (value is Uint8List) ProtoMessage.decode(value),
  ];

  int _int(int field) {
    final value = _last(field);
    return value is int ? value : 0;
  }

  Object? _last(int field) {
    final values = _fields[field];
    return values == null || values.isEmpty ? null : values.last;
  }
}

/// A varint at [pos]: its value (64 bits) and the position after it.
(int, int) _readVarint(List<int> bytes, int pos) {
  var value = 0;
  for (var i = 0; i < 10; i++) {
    if (pos + i >= bytes.length) throw const FormatException('A protobuf varint runs out.');
    final b = bytes[pos + i];
    value |= (b & 0x7f) << (7 * i);
    if (b & 0x80 == 0) return (value, pos + i + 1);
  }
  throw const FormatException('A protobuf varint is longer than ten bytes.');
}

// ---- framing ----

/// [message] with its length in front, as a varint: how both doors put every message on the wire.
Uint8List frame(List<int> message) {
  final out = BytesBuilder(copy: false);
  _varint(out, message.length);
  out.add(message);
  return out.toBytes();
}

/// Cuts what arrives into messages. A read may hold part of a message, several, or end in the middle of a length.
class FrameReader {
  FrameReader({this.maxLength = 1 << 20});

  /// Anything longer is not a message from a TV: the stream is corrupt (and cannot be read on after it).
  final int maxLength;

  Uint8List _pending = Uint8List(0);

  /// The whole messages [chunk] completes. Throws [FormatException] for a corrupt or oversized length.
  List<Uint8List> add(List<int> chunk) {
    final data = _pending.isEmpty
        ? Uint8List.fromList(chunk)
        : ((BytesBuilder(copy: false)
                ..add(_pending)
                ..add(chunk))
              .toBytes());
    final messages = <Uint8List>[];
    var pos = 0;
    while (pos < data.length) {
      var length = 0;
      var shift = 0;
      var at = pos;
      var complete = false;
      while (at < data.length) {
        final b = data[at++];
        length |= (b & 0x7f) << shift;
        if (b & 0x80 == 0) {
          complete = true;
          break;
        }
        shift += 7;
        if (shift > 28) throw const FormatException('A message length is longer than five bytes.');
      }
      if (!complete) break;
      if (length > maxLength) throw FormatException('A message of $length bytes is too long.');
      if (data.length - at < length) break;
      messages.add(Uint8List.sublistView(data, at, at + length));
      pos = at + length;
    }
    _pending = Uint8List.sublistView(data, pos);
    return messages;
  }
}

// ---- pairing (polo.proto) ----

/// OuterMessage's fields. Every pairing message carries the protocol version and a status, then one of the steps.
abstract final class PoloField {
  static const int protocolVersion = 1;
  static const int status = 2;
  static const int pairingRequest = 10;
  static const int pairingRequestAck = 11;
  static const int options = 20;
  static const int configuration = 30;
  static const int configurationAck = 31;
  static const int secret = 40;
  static const int secretAck = 41;

  /// The step fields, in the order the pairing goes through them.
  static const List<int> steps = [
    pairingRequest,
    pairingRequestAck,
    options,
    configuration,
    configurationAck,
    secret,
    secretAck,
  ];
}

/// OuterMessage.Status: anything but [ok] means the TV gave up.
abstract final class PoloStatus {
  static const int ok = 200;
  static const int error = 400;
  static const int badConfiguration = 401;
  static const int badSecret = 402;
}

/// One pairing message from the TV: its status, and which step it is (a [PoloField] step, or null for none).
class PoloReply {
  const PoloReply(this.status, this.step, this.message);

  /// Throws [FormatException] for bytes that are not an OuterMessage.
  factory PoloReply.decode(List<int> bytes) {
    final message = ProtoMessage.decode(bytes);
    int? step;
    for (final field in PoloField.steps) {
      if (message.has(field)) {
        step = field;
        break;
      }
    }
    return PoloReply(message.uint32(PoloField.status), step, message);
  }

  final int status;
  final int? step;
  final ProtoMessage message;
}

/// The pairing messages the phone sends, and the secret that proves it saw the code.
abstract final class Polo {
  /// The protocol version androidtvremote2 sends (polo.proto's default says 1; TVs speak 2).
  static const int version = 2;

  /// The service the phone asks to pair with.
  static const String serviceName = 'atvremote';

  /// Options.Encoding.EncodingType: hexadecimal, the code the TV shows (0-9, A-F).
  static const int encodingHexadecimal = 3;

  /// The code's length.
  static const int symbolLength = 6;

  /// Options.RoleType: the phone is the input side (the person types what the TV shows).
  static const int roleInput = 1;

  /// PairingRequest: who asks ([clientName] is what the TV shows while pairing and in its list of remotes).
  static Uint8List pairingRequest(String clientName) => _outer(
    PoloField.pairingRequest,
    ProtoWriter()
      ..string(1, serviceName)
      ..string(2, clientName),
  );

  /// Options: the phone takes a 6-digit hexadecimal code as the input side.
  static Uint8List options() => _outer(
    PoloField.options,
    ProtoWriter()
      ..message(1, _encoding())
      ..varint(3, roleInput),
  );

  /// Configuration: the same, as the choice for this pairing. After its ack the TV shows the code.
  static Uint8List configuration() => _outer(
    PoloField.configuration,
    ProtoWriter()
      ..message(1, _encoding())
      ..varint(2, roleInput),
  );

  /// Secret: the hash from [secretFor].
  static Uint8List secret(List<int> secret) => _outer(PoloField.secret, ProtoWriter()..bytes(1, secret));

  /// Six hexadecimal characters, either case.
  static bool isCode(String code) => RegExp(r'^[0-9A-Fa-f]{6}$').hasMatch(code);

  /// The pairing secret (androidtvremote2, pairing.py): SHA-256 over the phone's RSA modulus, the phone's exponent,
  /// the TV's modulus, the TV's exponent, then the code's last four hex digits as two bytes.
  ///
  /// Each number goes in as unsigned big-endian bytes without leading zeros (a DER INTEGER's extra 0x00 is dropped
  /// here, whatever the caller passes), so a 2048-bit modulus is 256 bytes and 65537 is 01 00 01.
  ///
  /// [code] must pass [isCode]. Its first two digits are a checksum: they must equal the hash's first byte
  /// ([codeMatches]).
  static Uint8List secretFor({
    required List<int> clientModulus,
    required List<int> clientExponent,
    required List<int> serverModulus,
    required List<int> serverExponent,
    required String code,
  }) {
    if (!isCode(code)) throw ArgumentError.value(code, 'code', 'not six hexadecimal digits');
    final input = BytesBuilder(copy: false)
      ..add(withoutLeadingZeros(clientModulus))
      ..add(withoutLeadingZeros(clientExponent))
      ..add(withoutLeadingZeros(serverModulus))
      ..add(withoutLeadingZeros(serverExponent))
      ..add(_hexBytes(code.substring(2)));
    return Uint8List.fromList(sha256.convert(input.toBytes()).bytes);
  }

  /// The code's first byte is the secret's first byte: a wrong code is caught here, before anything goes to the TV.
  static bool codeMatches(String code, List<int> secret) =>
      isCode(code) && secret.isNotEmpty && int.parse(code.substring(0, 2), radix: 16) == secret[0];

  static ProtoWriter _encoding() => ProtoWriter()
    ..varint(1, encodingHexadecimal)
    ..varint(2, symbolLength);

  static Uint8List _outer(int step, ProtoWriter body) =>
      (ProtoWriter()
            ..varint(PoloField.protocolVersion, version)
            ..varint(PoloField.status, PoloStatus.ok)
            ..message(step, body))
          .toBytes();

  static Uint8List _hexBytes(String hex) =>
      Uint8List.fromList([for (var i = 0; i + 1 < hex.length; i += 2) int.parse(hex.substring(i, i + 2), radix: 16)]);
}

/// [bytes] without its leading zero bytes (an unsigned big-endian number in its shortest form).
Uint8List withoutLeadingZeros(List<int> bytes) {
  var start = 0;
  while (start < bytes.length && bytes[start] == 0) {
    start++;
  }
  return Uint8List.fromList(bytes.sublist(start));
}

// ---- the remote (remotemessage.proto) ----

/// RemoteMessage's fields: one kind of message each, and exactly one is set in a message.
abstract final class RemoteField {
  static const int configure = 1;
  static const int setActive = 2;
  static const int error = 3;
  static const int pingRequest = 8;
  static const int pingResponse = 9;
  static const int keyInject = 10;
  static const int imeKeyInject = 20;
  static const int imeBatchEdit = 21;
  static const int imeShowRequest = 22;
  static const int voiceBegin = 30;
  static const int start = 40;
  static const int setVolumeLevel = 50;
  static const int appLinkLaunchRequest = 90;
}

/// The feature bits in remote_configure's code1 and remote_set_active's active (androidtvremote2's Feature).
abstract final class RemoteFeature {
  static const int ping = 1;
  static const int key = 2;

  /// The input method: typing, and the TV telling which app is in front (remote_ime_key_inject).
  static const int ime = 4;
  static const int voice = 8;
  static const int power = 32;
  static const int volume = 64;
  static const int appLink = 512;

  /// What Orbit asks for: everything but voice. The TV's own list cuts it down (configure).
  static const int orbit = ping | key | ime | power | volume | appLink;
}

/// RemoteDirection: a key press is [short]; [startLong] and [endLong] hold it.
abstract final class RemoteDirection {
  static const int startLong = 1;
  static const int endLong = 2;
  static const int short = 3;
}

/// The remote messages the phone sends.
abstract final class RemoteMessages {
  /// The answer to the TV's remote_configure: the features both sides have, and who the phone is (the same device
  /// info androidtvremote2 sends).
  static Uint8List configure(int features) => _remote(
    RemoteField.configure,
    _v3(ProtoWriter(), 1, features)..message(
      2,
      ProtoWriter()
        ..varint(3, 1)
        ..string(4, '1')
        ..string(5, 'atvremote')
        ..string(6, '1.0.0'),
    ),
  );

  /// The answer to the TV's remote_set_active.
  static Uint8List setActive(int features) => _remote(RemoteField.setActive, _v3(ProtoWriter(), 1, features));

  /// The answer to the TV's ping: its first value back.
  static Uint8List pingResponse(int val1) => _remote(RemoteField.pingResponse, _v3(ProtoWriter(), 1, val1));

  /// A key press (an Android key code) or half of a long one.
  static Uint8List key(int keyCode, {int direction = RemoteDirection.short}) =>
      _remote(RemoteField.keyInject, _v3(_v3(ProtoWriter(), 1, keyCode), 2, direction));

  /// Opens what [link] names on the TV (an app's own link, or `market://launch?id=<package>`).
  static Uint8List appLink(String link) => _remote(RemoteField.appLinkLaunchRequest, ProtoWriter()..string(1, link));

  /// [text] into the field the TV has open, the cursor after it. The counters are the ones the TV last gave for
  /// that field ([RemoteImeInfo], [RemoteImeShow], [RemoteImeEdit]).
  static Uint8List imeBatchEdit({required int imeCounter, required int fieldCounter, required String text}) {
    // Where the cursor goes: Android counts text in UTF-16 units, as Dart's String.length does.
    final object = _v3(_v3(ProtoWriter(), 1, text.length), 2, text.length);
    if (text.isNotEmpty) object.string(3, text);
    final edit = _v3(ProtoWriter(), 1, 1)..message(2, object);
    final batch = _v3(_v3(ProtoWriter(), 1, imeCounter), 2, fieldCounter)..message(3, edit);
    return _remote(RemoteField.imeBatchEdit, batch);
  }

  static Uint8List _remote(int field, ProtoWriter body) => (ProtoWriter()..message(field, body)).toBytes();

  /// remotemessage.proto is proto3: a scalar field holding 0 is left out, as protoc leaves it out.
  static ProtoWriter _v3(ProtoWriter writer, int field, int value) {
    if (value != 0) writer.varint(field, value);
    return writer;
  }
}

/// One remote message from the TV, read into plain values. [decode] gives the one kind each message holds.
sealed class RemoteNews {
  const RemoteNews();

  /// Throws [FormatException] for bytes that are not a RemoteMessage.
  static RemoteNews decode(List<int> bytes) {
    final m = ProtoMessage.decode(bytes);
    // The same order androidtvremote2 looks in (remote.py, _handle_message).
    if (m.message(RemoteField.configure) case final cfg?) {
      final info = cfg.message(2);
      return RemoteConfigure(
        features: cfg.int32(1),
        model: info?.string(1) ?? '',
        vendor: info?.string(2) ?? '',
        appVersion: info?.string(6) ?? '',
      );
    }
    if (m.has(RemoteField.setActive)) return const RemoteSetActive();
    if (m.message(RemoteField.imeKeyInject) case final inject?) {
      final app = inject.message(1);
      final field = inject.message(2);
      return RemoteImeInfo(
        package: app?.string(12) ?? '',
        imeCounter: app?.int32(1) ?? 0,
        fieldCounter: field?.int32(1) ?? 0,
      );
    }
    if (m.message(RemoteField.imeShowRequest) case final show?) {
      return RemoteImeShow(show.message(2)?.int32(1));
    }
    if (m.message(RemoteField.imeBatchEdit) case final edit?) {
      return RemoteImeEdit(imeCounter: edit.int32(1), fieldCounter: edit.int32(2));
    }
    if (m.message(RemoteField.setVolumeLevel) case final volume?) {
      return RemoteVolume(level: volume.uint32(7), max: volume.uint32(6), muted: volume.boolean(8));
    }
    if (m.message(RemoteField.start) case final start?) return RemoteStart(start.boolean(1));
    if (m.message(RemoteField.pingRequest) case final ping?) return RemotePing(ping.int32(1));
    if (m.has(RemoteField.error)) return const RemoteFailure();
    return const RemoteOther();
  }
}

/// remote_configure: the TV's features (code1) and device info. The phone answers with its own.
final class RemoteConfigure extends RemoteNews {
  const RemoteConfigure({required this.features, required this.model, required this.vendor, required this.appVersion});

  final int features;
  final String model;
  final String vendor;
  final String appVersion;
}

/// remote_set_active: the phone answers with the features it uses.
final class RemoteSetActive extends RemoteNews {
  const RemoteSetActive();
}

/// remote_ime_key_inject: the app in front ([package], '' when the TV gave none) and the input counters.
final class RemoteImeInfo extends RemoteNews {
  const RemoteImeInfo({required this.package, required this.imeCounter, required this.fieldCounter});

  final String package;
  final int imeCounter;
  final int fieldCounter;
}

/// remote_ime_show_request: a text field opened; [fieldCounter] is null when the TV sent no field status.
final class RemoteImeShow extends RemoteNews {
  const RemoteImeShow(this.fieldCounter);

  final int? fieldCounter;
}

/// remote_ime_batch_edit from the TV: counters, used when remote_ime_key_inject gave none.
final class RemoteImeEdit extends RemoteNews {
  const RemoteImeEdit({required this.imeCounter, required this.fieldCounter});

  final int imeCounter;
  final int fieldCounter;
}

/// remote_set_volume_level: the volume now.
final class RemoteVolume extends RemoteNews {
  const RemoteVolume({required this.level, required this.max, required this.muted});

  final int level;
  final int max;
  final bool muted;
}

/// remote_start: the remote is ready; [started] is false while the TV is in standby.
final class RemoteStart extends RemoteNews {
  const RemoteStart(this.started);

  final bool started;
}

/// remote_ping_request: answered with [val1].
final class RemotePing extends RemoteNews {
  const RemotePing(this.val1);

  final int val1;
}

/// remote_error: the TV could not do something it was sent.
final class RemoteFailure extends RemoteNews {
  const RemoteFailure();
}

/// Anything else (voice, audio devices): not used.
final class RemoteOther extends RemoteNews {
  const RemoteOther();
}
