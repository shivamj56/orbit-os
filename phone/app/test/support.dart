// Fakes and helpers shared by the tests: no platform channels, real sockets on 127.0.0.1 only.
import 'dart:convert';
import 'dart:io';

import 'package:orbit/native/native_host.dart';
import 'package:orbit/tv/discovery.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/remote.dart';
import 'package:orbit/tv/subnet_scan.dart';
import 'package:orbit/tv/tv_client.dart';
import 'package:orbit/tv/tv_link.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';

/// Short timings so a whole pairing, a 401 and an outage fit in a second or two.
const LinkTimings fastTimings = LinkTimings(
  poll: Duration(milliseconds: 60),
  retry: Duration(milliseconds: 60),
  codeShown: Duration(seconds: 2),
  searchAgain: [Duration(milliseconds: 150)],
  afterAction: Duration(milliseconds: 10),
);

/// An mDNS that "sees" [tvs] at once.
class FakeNsd implements NsdBrowser {
  FakeNsd([this.tvs = const [], this.namesOnly = const []]);

  List<FoundTv> tvs;
  List<String> namesOnly;
  int runs = 0;

  @override
  Future<void> browse(Duration window, void Function(FoundTv tv) onFound, void Function(String name) onNameOnly) async {
    runs++;
    tvs.forEach(onFound);
    namesOnly.forEach(onNameOnly);
    await Future<void>.delayed(window);
  }
}

class FakeNative implements NativeHost {
  void Function(String dir)? volumeKeyHandler;
  final List<bool> volumeKeys = [];
  final List<bool> keepAwake = [];
  final List<String> haptics = [];
  int movedToBack = 0;
  Directory? cache;

  @override
  set onVolumeKey(void Function(String dir)? handler) => volumeKeyHandler = handler;

  @override
  Future<void> setVolumeKeys(bool on) async => volumeKeys.add(on);

  @override
  Future<void> setKeepAwake(bool on) async => keepAwake.add(on);

  @override
  Future<void> haptic(String kind) async => haptics.add(kind);

  @override
  Future<void> moveToBack() async => movedToBack++;

  @override
  Future<Directory?> cacheDirectory() async => cache;
}

/// A link whose discovery scans only 127.0.0.1 at [tv]'s port, with [nsd] for mDNS.
TvLink linkFor(
  MockTv? tv, {
  MemoryTvStore? store,
  FakeNsd? nsd,
  LinkTimings timings = fastTimings,
  Duration clientTimeout = const Duration(seconds: 2),
}) {
  return TvLink(
    store: store ?? MemoryTvStore(),
    client: TvClient(timeout: clientTimeout),
    discovery: TvDiscovery(
      nsd: nsd ?? FakeNsd(),
      scanner: SubnetScanner(port: tv?.port ?? 9, targets: () async => tv == null ? <String>[] : ['127.0.0.1']),
      nsdWindow: const Duration(milliseconds: 30),
    ),
    timings: timings,
  );
}

/// A remote with only the Wi-Fi path (no Firebase), as when Firebase does not start.
TvRemote wifiOnly(TvLink link) => TvRemote(wifi: link)..cloudUnavailable();

/// The message inside a script from receiveScript: `...f(JSON.parse("<literal>"));})();`.
Map<String, Object?> messageOf(String script) {
  const head = 'f(JSON.parse(';
  final start = script.indexOf(head);
  final end = script.lastIndexOf('));})();');
  if (start < 0 || end < 0) throw FormatException('not a receive script', script);
  final literal = script.substring(start + head.length, end);
  final text = jsonDecode(literal) as String;
  return (jsonDecode(text) as Map).cast<String, Object?>();
}
