import 'dart:convert';
import 'dart:io';

import '../tv/models.dart';

/// One message from the page: `{"id":12,"op":"key","args":{"key":"up"}}`.
class BridgeRequest {
  const BridgeRequest(this.id, this.op, this.args);

  /// 0 means no reply is wanted.
  final int id;
  final String op;
  final Args args;

  /// Longer messages are not read (a `type` text is at most 4000 characters).
  static const int maxLength = 256 * 1024;

  /// Null for a message that cannot be answered: not JSON, not an object, or an id that is not an integer >= 0.
  /// A missing id is 0. A missing op is "" (answered as an unknown op); missing or non-object args are `{}`.
  static BridgeRequest? parse(String raw) {
    if (raw.length > maxLength) return null;
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! Map) return null;
    final rawId = decoded['id'];
    final int id;
    if (rawId == null) {
      id = 0;
    } else if (rawId is int && rawId >= 0) {
      id = rawId;
    } else if (rawId is double && rawId >= 0 && rawId == rawId.truncateToDouble() && rawId <= 9007199254740991) {
      id = rawId.toInt();
    } else {
      return null;
    }
    final op = decoded['op'];
    final args = decoded['args'];
    return BridgeRequest(
      id,
      op is String ? op : '',
      Args(args is Map ? {for (final e in args.entries) '${e.key}': e.value} : const {}),
    );
  }
}

/// The `args` of a request, read with the errors the page shows.
class Args {
  const Args(this._map);

  final Map<String, Object?> _map;

  bool has(String key) => _map.containsKey(key) && _map[key] != null;

  Object? raw(String key) => _map[key];

  String text(String key, {int max = 2048, bool allowEmpty = false}) {
    final value = _map[key];
    if (value is! String) throw OpError(400, 'Orbit needs "$key" as text.');
    if (!allowEmpty && value.trim().isEmpty) throw OpError(400, '"$key" is empty.');
    if (value.length > max) throw OpError(400, '"$key" is too long.');
    return value;
  }

  /// A word like a key or a media action: lower-case letters and underscores.
  String word(String key) {
    final value = text(key, max: 32).trim();
    if (!RegExp(r'^[a-z_]+$').hasMatch(value)) throw OpError(400, '"$value" is not something the TV takes.');
    return value;
  }

  num number(String key) {
    final value = _map[key];
    if (value is! num || !value.isFinite) throw OpError(400, 'Orbit needs "$key" as a number.');
    return value;
  }

  double delta(String key) {
    final value = _map[key];
    if (value == null) return 0;
    if (value is! num || !value.isFinite) throw OpError(400, 'Orbit needs "$key" as a number.');
    return value.toDouble();
  }

  bool flag(String key, {bool? fallback}) {
    final value = _map[key];
    if (value is bool) return value;
    if (value == null && fallback != null) return fallback;
    throw OpError(400, 'Orbit needs "$key" as true or false.');
  }

  int port(String key) {
    final value = _map[key];
    if (value == null) return kDoorPort;
    if (value is num && value == value.truncate() && value >= 1 && value <= 65535) return value.toInt();
    throw OpError(400, 'Orbit needs "$key" as a port number.');
  }
}

/// The TV's address as the page sends it to `connect`, checked.
String checkedHost(String text) {
  final host = text.trim().toLowerCase();
  if (!isHost(host)) throw const OpError(400, 'That does not look like the TV\'s address. Type it like 192.168.1.7.');
  return host;
}

/// What a person types for `manualAddress`: "192.168.1.7", "192.168.1.7:8090" or "http://192.168.1.7:8090/".
(String, int) parseTypedAddress(String text) {
  var rest = text.trim().replaceFirst(RegExp(r'^https?://', caseSensitive: false), '');
  final slash = rest.indexOf('/');
  if (slash >= 0) rest = rest.substring(0, slash);
  var port = kDoorPort;
  final colon = rest.indexOf(':');
  if (colon >= 0) {
    final number = int.tryParse(rest.substring(colon + 1));
    if (rest.lastIndexOf(':') != colon || number == null || number < 1 || number > 65535) {
      throw const OpError(400, 'That does not look like the TV\'s address. Type it like 192.168.1.7.');
    }
    port = number;
    rest = rest.substring(0, colon);
  }
  return (checkedHost(rest), port);
}

/// A dotted-quad IPv4 address or a host name (the TV's door answers IPv4 only).
bool isHost(String host) {
  if (host.isEmpty || host.length > 253) return false;
  if (RegExp(r'^[0-9.]+$').hasMatch(host)) {
    final parts = host.split('.');
    return parts.length == 4 && InternetAddress.tryParse(host)?.type == InternetAddressType.IPv4;
  }
  return RegExp(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$').hasMatch(host);
}
