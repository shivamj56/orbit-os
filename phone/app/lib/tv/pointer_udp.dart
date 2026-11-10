import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// Pointer datagrams (phone/SPEC.md, "Pointer datagrams"): one ASCII line, fields split by single spaces,
///
///     o1 <token> <seq> m <dx> <dy>      move the cursor
///     o1 <token> <seq> s <dx> <dy>      scroll
///
/// dx and dy in TV pixels at 1280x720.
class PointerDatagram {
  const PointerDatagram._();

  /// `seq` wraps at 2^31.
  static const int seqMask = 0x7fffffff;

  /// Kinds: 'm' (move) and 's' (scroll).
  static String encode({
    required String token,
    required int seq,
    required String kind,
    required double dx,
    required double dy,
  }) {
    assert(kind == 'm' || kind == 's', 'kind is m or s');
    return 'o1 $token ${seq & seqMask} $kind ${formatDelta(dx)} ${formatDelta(dy)}';
  }

  /// At most two decimals, no exponent, no trailing zeros, never "-0": 3.5, -1.2, 0, -8, 12.35.
  static String formatDelta(double value) {
    if (!value.isFinite) return '0';
    var text = value.clamp(-10000.0, 10000.0).toStringAsFixed(2);
    if (text.contains('.')) {
      text = text.replaceFirst(RegExp(r'0+$'), '');
      if (text.endsWith('.')) text = text.substring(0, text.length - 1);
    }
    return text == '-0' ? '0' : text;
  }
}

/// One UDP socket kept open for pointer moves, fire and forget.
///
/// The sequence starts at the clock's milliseconds (mod 2^31): an app opened again soon after it was closed starts
/// above where the last one stopped (the TV also forgets a phone's numbering after 3 quiet seconds).
class PointerSender {
  PointerSender({int? startSeq}) : _seq = (startSeq ?? DateTime.now().millisecondsSinceEpoch) & PointerDatagram.seqMask;

  int _seq;
  RawDatagramSocket? _socket;
  Future<RawDatagramSocket?>? _binding;
  final Map<String, InternetAddress> _resolved = {};
  bool _closed = false;

  /// The number the next datagram carries.
  int get nextSeq => _seq;

  /// Sends one move ('m') or scroll ('s'). Errors are swallowed: a lost move is replaced by the next one.
  Future<void> send({
    required String address,
    required int port,
    required String token,
    required String kind,
    required double dx,
    required double dy,
  }) async {
    if (_closed || !dx.isFinite || !dy.isFinite) return;
    final socket = _socket ?? await (_binding ??= _bind());
    final target = InternetAddress.tryParse(address) ?? await _resolve(address);
    if (socket == null || target == null || _closed) return;
    final seq = _seq;
    _seq = (_seq + 1) & PointerDatagram.seqMask;
    final line = PointerDatagram.encode(token: token, seq: seq, kind: kind, dx: dx, dy: dy);
    try {
      socket.send(ascii.encode(line), target, port);
    } on SocketException catch (e) {
      // The network changed under the socket: the next datagram gets a new one.
      debugPrint('orbit: pointer datagram not sent: $e');
      _drop(socket);
    }
  }

  Future<RawDatagramSocket?> _bind() async {
    try {
      final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      if (_closed) {
        socket.close();
        return null;
      }
      // Send only: nothing is read from it (the TV never answers a datagram).
      socket
        ..readEventsEnabled = false
        ..writeEventsEnabled = false;
      return _socket = socket;
    } on SocketException catch (e) {
      debugPrint('orbit: no datagram socket: $e');
      return null;
    } finally {
      _binding = null;
    }
  }

  /// A typed name ("tv.lan") is looked up once.
  Future<InternetAddress?> _resolve(String address) async {
    final known = _resolved[address];
    if (known != null) return known;
    try {
      final found = await InternetAddress.lookup(address, type: InternetAddressType.IPv4);
      if (found.isEmpty) return null;
      return _resolved[address] = found.first;
    } on SocketException {
      return null;
    }
  }

  void _drop(RawDatagramSocket socket) {
    if (!identical(_socket, socket)) return;
    _socket = null;
    socket.close();
  }

  void close() {
    _closed = true;
    final socket = _socket;
    if (socket != null) _drop(socket);
  }
}
