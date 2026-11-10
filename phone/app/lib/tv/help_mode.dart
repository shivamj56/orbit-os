import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'remote.dart';
import 'tv_client.dart';

/// How often help mode reads the screen over the Wi-Fi door. The default is phone/SPEC.md's; tests shorten it.
class HelpTimings {
  const HelpTimings({this.screenRead = const Duration(milliseconds: 700)});

  /// GET /api/screen while help is on over the Wi-Fi door, from the start of one read to the start of the next.
  final Duration screenRead;
}

/// Help mode (phone/SPEC.md, "Help mode"): while the page's Help page is open, the TV sends pictures of its screen and
/// each new one goes to the page as a `screen` event, `{"jpg","w","h","seq","at"}` with `at` in this phone's clock.
///
/// Over the cloud the pictures come from `/orbit/{uid}/screen` (and the `watch` heartbeat keeps going, or the TV ends
/// help); over the Wi-Fi door from GET /api/screen, read every 700 ms and handed on when `x-screen-seq` changed.
/// Help is switched with POST /api/help through whichever way carries the TV, one switch at a time and in order, so
/// an "off" sent on the way to the background always reaches the TV before the page's next "on".
///
/// Help ends by itself when the app leaves the screen (the page asks again when it is back) and when a new page starts
/// loading; when the way to the TV changes while it is on, it is asked for again the new way.
class HelpMode {
  HelpMode(this._remote, {this.timings = const HelpTimings()});

  final TvRemote _remote;
  final HelpTimings timings;

  /// Each new picture of the TV's screen.
  void Function(Map<String, Object?> frame)? onFrame;

  bool _on = false;
  bool _inFront = true;
  bool _disposed = false;
  String? _via;
  int _round = 0;
  Timer? _readTimer;
  int? _lastSeq;
  Future<void> _switching = Future<void>.value();

  /// The page has help on.
  bool get isOn => _on;

  /// Where the pictures come from now: "cloud", "wifi", or null (no way to the TV, or help is off).
  String? get via => _via;

  /// `help`: on or off, and the TV's answer (`{"ok":true,"on":…}`). The pictures are watched from the moment help is
  /// asked for, so none is missed while the answer is on its way.
  Future<Object?> set(bool on) {
    if (_disposed) return Future<Object?>.error(const OpError(0, 'Orbit is closing.'));
    if (on && !_inFront) return Future<Object?>.error(const OpError(409, 'Help starts when Orbit is on the screen.'));
    _on = on;
    _unwatch();
    if (on) _watch();
    return _switch(on);
  }

  /// The app came to the front or left it; leaving ends help.
  set inFront(bool front) {
    if (_inFront == front) return;
    _inFront = front;
    if (!front) stop();
  }

  /// Help off, without a reply: the app left the screen, or the page is loading again.
  void stop() {
    if (!_on || _disposed) return;
    unawaited(set(false).then<void>((_) {}, onError: (Object e) => debugPrint('orbit: help off: $e')));
  }

  /// The way to the TV may have changed: watch the new way, and ask the TV for help through it.
  void wayChanged() {
    if (!_on || _disposed) return;
    final way = _way();
    if (way == null || way == _via) return;
    _unwatch();
    _watch();
    unawaited(_switch(true).then<void>((_) {}, onError: (Object e) => debugPrint('orbit: help, the new way: $e')));
  }

  void dispose() {
    _disposed = true;
    _on = false;
    _unwatch();
  }

  String? _way() => _remote.onCloud ? 'cloud' : (_remote.wifi.isConnected ? 'wifi' : null);

  Future<Object?> _switch(bool on) {
    final answer = _switching.then((_) => _remote.postJson('/api/help', {'on': on}));
    _switching = answer.then<void>((_) {}, onError: (Object _) {});
    return answer;
  }

  void _watch() {
    final way = _via = _way();
    _lastSeq = null;
    if (way == 'cloud') {
      final cloud = _remote.cloud!;
      cloud
        ..onScreen = _cloudFrame
        ..watchScreen = true;
    } else if (way == 'wifi') {
      final round = ++_round;
      _readTimer = Timer(timings.screenRead, () => unawaited(_read(round)));
    }
  }

  void _unwatch() {
    _via = null;
    _round++;
    _readTimer?.cancel();
    _readTimer = null;
    _remote.cloud?.watchScreen = false;
  }

  void _cloudFrame(Map<String, Object?> frame) {
    if (_on && _via == 'cloud') onFrame?.call(frame);
  }

  Future<void> _read(int round) async {
    _readTimer = null;
    if (round != _round || _disposed) return;
    final started = Stopwatch()..start();
    if (_remote.wifi.isConnected) {
      try {
        final reply = await _remote.wifi.getRaw('/api/screen');
        if (round == _round) _wifiFrame(reply);
      } on OpError {
        // 404 until the TV has its first picture (or once help ended there); no answer: the next read tries again.
      } on Object catch (e) {
        debugPrint('orbit: screen read: $e');
      }
    }
    if (round != _round || _disposed) return;
    final wait = timings.screenRead - started.elapsed;
    _readTimer = Timer(wait.isNegative ? Duration.zero : wait, () => unawaited(_read(round)));
  }

  void _wifiFrame(TvReply reply) {
    final bytes = reply.bytes;
    if (bytes.length < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8) return;
    final seq = int.tryParse((reply.headers['x-screen-seq'] ?? '').trim());
    if (seq != null && seq == _lastSeq) return;
    _lastSeq = seq;
    final (w, h) = jpegSize(bytes) ?? (640, 360);
    onFrame?.call({
      'jpg': base64Encode(bytes),
      'w': w,
      'h': h,
      'seq': seq ?? 0,
      'at': DateTime.now().millisecondsSinceEpoch,
    });
  }
}

/// A JPEG's width and height, from its frame header (SOF0 to SOF15), or null when [bytes] is not a JPEG.
(int, int)? jpegSize(Uint8List bytes) {
  if (bytes.length < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8) return null;
  var i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] != 0xFF) return null;
    final marker = bytes[i + 1];
    if (marker == 0xFF) {
      // A fill byte before the marker.
      i++;
      continue;
    }
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8)) {
      // A marker without a length.
      i += 2;
      continue;
    }
    if (marker == 0xD9 || marker == 0xDA) return null; // the end, or the picture data, before any frame header
    final length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    // SOF0..SOF15 carry the size; C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) do not.
    if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
      if (i + 8 >= bytes.length) return null;
      final h = (bytes[i + 5] << 8) | bytes[i + 6];
      final w = (bytes[i + 7] << 8) | bytes[i + 8];
      return w > 0 && h > 0 ? (w, h) : null;
    }
    i += 2 + length;
  }
  return null;
}
