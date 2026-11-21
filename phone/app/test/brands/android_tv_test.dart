// AndroidTv (lib/tv/brands/android_tv.dart) against a fake Google TV on 127.0.0.1 (fake_android_tv.dart): pairing
// with the code the TV shows, wrong codes, a certificate the TV turns away, the remote's handshake, keys, app links,
// typing, volume and app news, pings, drops and silence. Then the codec (atv_proto.dart) and the DER reader (der.dart)
// against known bytes. Certificates come from the openssl CLI at test time; nothing leaves loopback.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/brands/android_tv.dart';
import 'package:orbit/tv/brands/atv_proto.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/der.dart';

import 'fake_android_tv.dart';

Uint8List bytesOf(String hex) {
  final clean = hex.replaceAll(' ', '');
  return Uint8List.fromList([
    for (var i = 0; i < clean.length; i += 2) int.parse(clean.substring(i, i + 2), radix: 16),
  ]);
}

Uint8List ascii(String text) => Uint8List.fromList(utf8.encode(text));

/// One DER element (for building certificates by hand).
Uint8List tlv(int tag, List<int> content) {
  final length = content.length;
  final head = length < 0x80
      ? [length]
      : length < 0x100
      ? [0x81, length]
      : [0x82, length >> 8, length & 0xff];
  return Uint8List.fromList([tag, ...head, ...content]);
}

Uint8List seq(List<List<int>> parts) => tlv(0x30, [for (final p in parts) ...p]);

/// A certificate's structure around an RSA key, as RFC 5280 lays it out (unsigned: der.dart does not check that).
Uint8List handmadeCertificate(List<int> modulusInteger, List<int> exponentInteger, {bool v1 = false, List<int>? oid}) {
  final algorithm = seq([
    tlv(0x06, oid ?? [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
    [0x05, 0x00],
  ]);
  final rsaKey = seq([tlv(0x02, modulusInteger), tlv(0x02, exponentInteger)]);
  final spki = seq([
    algorithm,
    tlv(0x03, [0x00, ...rsaKey]),
  ]);
  final name = seq([
    tlv(
      0x31,
      seq([
        tlv(0x06, [0x55, 0x04, 0x03]),
        tlv(0x0c, ascii('T')),
      ]),
    ),
  ]);
  final signatureAlgorithm = seq([
    tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    [0x05, 0x00],
  ]);
  final tbs = seq([
    if (!v1) tlv(0xa0, tlv(0x02, [0x02])),
    tlv(0x02, [0x01]),
    signatureAlgorithm,
    name,
    seq([tlv(0x17, ascii('261121000000Z')), tlv(0x17, ascii('361121000000Z'))]),
    name,
    spki,
  ]);
  return seq([
    tbs,
    signatureAlgorithm,
    tlv(0x03, [0x00, 0xde, 0xad]),
  ]);
}

/// The next onChanged.
Future<void> nextChange(AndroidTv tv) {
  final changed = Completer<void>();
  tv.onChanged = () {
    if (!changed.isCompleted) changed.complete();
  };
  return changed.future.timeout(const Duration(seconds: 2));
}

void main() {
  late Directory dir;
  late TestCert tvCert;
  late TestCert phone;
  late TestCert otherPhone;

  setUpAll(() async {
    dir = Directory.systemTemp.createTempSync('orbit_atv_');
    tvCert = await makeCert(dir, 'tv', 'atvremote/fake/fake/Fake TV/AA:BB:CC:DD:EE:0F');
    phone = await makeCert(dir, 'phone', 'Orbit');
    otherPhone = await makeCert(dir, 'other', 'Orbit');
  });

  tearDownAll(() {
    dir.deleteSync(recursive: true);
  });

  group('AndroidTv', () {
    final fakes = <FakeAndroidTv>[];
    final tvs = <AndroidTv>[];

    Future<FakeAndroidTv> fakeTv({
      List<TestCert>? paired,
      int features = 623,
      bool on = true,
      bool silent = false,
    }) async {
      final fake = await FakeAndroidTv.start(
        tv: tvCert,
        canPair: [phone, otherPhone],
        paired: paired ?? [phone],
        features: features,
        on: on,
        silent: silent,
      );
      fakes.add(fake);
      return fake;
    }

    AndroidTv driver(
      FakeAndroidTv fake, {
      TestCert? as,
      Duration timeout = const Duration(seconds: 2),
      Duration idle = const Duration(seconds: 16),
    }) {
      final tv = AndroidTv(
        address: '127.0.0.1',
        identity: FileIdentity(as ?? phone),
        port: fake.remotePort,
        pairingPort: fake.pairingPort,
        timeout: timeout,
        idle: idle,
      );
      tvs.add(tv);
      return tv;
    }

    /// A driver that is connected, with the handshake's own messages done.
    Future<(FakeAndroidTv, AndroidTv)> connected({int features = 623, bool on = true}) async {
      final fake = await fakeTv(features: features, on: on);
      final tv = driver(fake);
      await tv.connect();
      return (fake, tv);
    }

    tearDown(() async {
      for (final tv in tvs) {
        await tv.close();
      }
      tvs.clear();
      for (final fake in fakes) {
        await fake.close();
      }
      fakes.clear();
    });

    test('what it is before connecting', () async {
      final fake = await fakeTv();
      final tv = driver(fake);
      expect(tv.kind, TvKind.androidtv);
      expect(tv.pairingWay, PairingWay.code);
      expect(tv.secret, isNull);
      expect(tv.isOpen, isFalse);
      expect(tv.caps, {
        Cap.keys,
        Cap.volume,
        Cap.mute,
        Cap.media,
        Cap.recents,
        Cap.settings,
        Cap.power,
        Cap.launch,
        Cap.apps,
        Cap.nowPlaying,
      });
      await expectLater(tv.key(RemoteKey.ok), throwsA(isA<BrandUnreachable>()));
      await expectLater(tv.state(), throwsA(isA<BrandUnreachable>()));
    });

    test('pairs with the code the TV shows, then the remote opens', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await expectLater(tv.connect(), throwsA(isA<BrandNeedsPairing>()));
      expect(fake.refused, 1);

      await tv.startPairing();
      expect(fake.serviceName, 'atvremote');
      expect(fake.clientName, 'Orbit');
      expect(fake.code, matches(RegExp(r'^[0-9A-F]{6}$')));

      await tv.finishPairing(fake.code!);
      expect(fake.pairingProblems, isEmpty);
      expect(fake.secretsReceived, 1);
      expect(fake.paired, [phone]);
      expect(tv.isOpen, isTrue);
      expect(fake.remoteConnections, 1);
      expect(tv.secret, isNull);
      expect(await tv.state(), {'on': true});
    });

    test('a code typed in lower case, with spaces, is the same code', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await tv.startPairing();
      final code = fake.code!.toLowerCase();
      await tv.finishPairing(' ${code.substring(0, 3)} ${code.substring(3)} ');
      expect(fake.paired, [phone]);
      expect(tv.isOpen, isTrue);
    });

    test('a wrong code fails its checksum here: nothing goes to the TV, and the right code still works', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await tv.startPairing();
      final code = fake.code!;
      final wrongFirst = ((int.parse(code.substring(0, 2), radix: 16) + 1) % 256).toRadixString(16).padLeft(2, '0');
      await expectLater(
        tv.finishPairing('$wrongFirst${code.substring(2)}'),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.wrongCode)
              .having((e) => e.message, 'message', 'That is not the code on the TV. Try again.'),
        ),
      );
      expect(fake.secretsReceived, 0);

      await tv.finishPairing(code);
      expect(fake.secretsReceived, 1);
      expect(tv.isOpen, isTrue);
    });

    test('a code that passes the checksum but is not the one shown: the TV says bad secret', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await tv.startPairing();
      final nonce = int.parse(fake.code!.substring(2), radix: 16);
      final other = [((nonce + 1) & 0xffff) >> 8, (nonce + 1) & 0xff];
      final consistent = hex([tvSideSecret(phone, tvCert, other)[0], ...other]);
      await expectLater(
        tv.finishPairing(consistent),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.wrongCode)),
      );
      expect(fake.secretsReceived, 1);
      expect(fake.paired, isEmpty);
      expect(tv.isOpen, isFalse);
      // That pairing is over on the TV: typing again asks for a new code.
      await expectLater(
        tv.finishPairing(fake.code!),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.denied)
              .having((e) => e.message, 'message', 'The TV stopped showing the code. Ask for a new one.'),
        ),
      );
    });

    test('a code that is not six hexadecimal characters is refused before anything is sent', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await tv.startPairing();
      for (final code in ['12345', '1234567', 'GHIJKL', '']) {
        await expectLater(
          tv.finishPairing(code),
          throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.wrongCode)),
        );
      }
      expect(fake.secretsReceived, 0);
    });

    test('a code without a pairing under way, or after the TV cancelled it: ask for a new code', () async {
      final fake = await fakeTv(paired: []);
      final tv = driver(fake);
      await expectLater(
        tv.finishPairing('ABCDEF'),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.denied)),
      );

      await tv.startPairing();
      fake.cancelPairing();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      await expectLater(
        tv.finishPairing(fake.code!),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.denied)),
      );
      expect(fake.secretsReceived, 0);
    });

    test('the remote door turns away a certificate the TV has not paired', () async {
      final fake = await fakeTv(paired: [phone]);
      final stranger = driver(fake, as: otherPhone);
      await expectLater(stranger.connect(), throwsA(isA<BrandNeedsPairing>()));
      expect(stranger.isOpen, isFalse);
      expect(fake.refused, 1);

      // The paired phone gets in at the same door.
      final tv = driver(fake);
      await tv.connect();
      expect(tv.isOpen, isTrue);
    });

    test('the handshake: configure and set_active answered as androidtvremote2 answers them', () async {
      final (fake, tv) = await connected();
      // 615 = ping, key, IME, power, volume, app link: Orbit's features, all of which this TV has.
      expect(
        fake.phoneConfigure,
        bytesOf('0a 1c 08 e7 04 12 17 18 01 22 01 31 2a 09 ${hex(ascii('atvremote'))} 32 05 ${hex(ascii('1.0.0'))}'),
      );
      expect(fake.phoneSetActive, bytesOf('12 03 08 e7 04'));
      expect(tv.isOpen, isTrue);
      expect(tv.caps, contains(Cap.type));
      expect(tv.model, 'Fake TV');
      expect(tv.mac, 'aa:bb:cc:dd:ee:0f');
    });

    test('keys go as short presses of Android key codes', () async {
      final (fake, tv) = await connected();
      final want = {
        RemoteKey.up: 19,
        RemoteKey.down: 20,
        RemoteKey.left: 21,
        RemoteKey.right: 22,
        RemoteKey.ok: 23,
        RemoteKey.back: 4,
        RemoteKey.home: 3,
        RemoteKey.recents: 187,
        RemoteKey.settings: 176,
        RemoteKey.mute: 164,
        RemoteKey.volumeUp: 24,
        RemoteKey.volumeDown: 25,
        RemoteKey.playPause: 85,
        RemoteKey.next: 87,
        RemoteKey.previous: 88,
        RemoteKey.forward: 90,
        RemoteKey.rewind: 89,
      };
      expect(want.keys.toSet(), RemoteKey.all);
      for (final MapEntry(:key, :value) in want.entries) {
        await tv.key(key);
        final sent = ProtoMessage.decode(await fake.nextFromPhone()).message(10)!;
        expect((sent.int32(1), sent.int32(2)), (value, 3), reason: key);
      }
      // The exact bytes of two of them: remote_key_inject {key_code, direction: SHORT}.
      await tv.key(RemoteKey.up);
      expect(await fake.nextFromPhone(), bytesOf('52 04 08 13 10 03'));
      await tv.key(RemoteKey.recents);
      expect(await fake.nextFromPhone(), bytesOf('52 05 08 bb 01 10 03'));

      await expectLater(
        tv.key('teleport'),
        throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)),
      );
    });

    test('app links: a URL goes as it is, a package name through market://launch', () async {
      final (fake, tv) = await connected();
      await tv.launch('netflix://');
      expect(await fake.nextFromPhone(), bytesOf('d2 05 0c 0a 0a ${hex(ascii('netflix://'))}'));
      await tv.launch('https://www.youtube.com/watch?v=x');
      expect(
        ProtoMessage.decode(await fake.nextFromPhone()).message(90)!.string(1),
        'https://www.youtube.com/watch?v=x',
      );
      await tv.launch('org.xbmc.kodi');
      expect(
        ProtoMessage.decode(await fake.nextFromPhone()).message(90)!.string(1),
        'market://launch?id=org.xbmc.kodi',
      );
      await expectLater(tv.launch(' '), throwsA(isA<BrandError>()));
    });

    test('the fixed app list, sorted by label, opened by link', () async {
      final (_, tv) = await connected();
      final apps = await tv.apps();
      expect(apps.map((a) => a.label), ['Disney+', 'Netflix', 'Plex', 'Prime Video', 'Twitch', 'YouTube']);
      expect(apps.firstWhere((a) => a.label == 'YouTube').id, 'https://www.youtube.com');
      for (final app in apps) {
        expect(AndroidTv.appLinkFor(app.id), app.id, reason: 'every id is a link');
      }
      expect(await tv.icon(apps.first.id), isNull);
    });

    test('volume and the app in front: news from the TV fires onChanged and shows in state()', () async {
      final (fake, tv) = await connected();
      var changed = nextChange(tv);
      fake.sendToPhone(
        tvMessage(
          50,
          ProtoWriter()
            ..varint(1, 4)
            ..varint(2, 1)
            ..string(3, 'speaker')
            ..varint(6, 100)
            ..varint(7, 21)
            ..boolean(8, true),
        ),
      );
      await changed;
      expect(await tv.state(), {'volume': 21, 'max': 100, 'muted': true, 'on': true});

      changed = nextChange(tv);
      fake.sendToPhone(
        tvMessage(
          20,
          ProtoWriter()..message(
            1,
            ProtoWriter()
              ..varint(1, 3)
              ..string(12, 'com.netflix.ninja'),
          ),
        ),
      );
      await changed;
      expect(await tv.state(), {
        'volume': 21,
        'max': 100,
        'muted': true,
        'pkg': 'com.netflix.ninja',
        'app': 'Netflix',
        'on': true,
      });

      changed = nextChange(tv);
      fake.sendToPhone(tvMessage(20, ProtoWriter()..message(1, ProtoWriter()..string(12, 'com.example.tv'))));
      await changed;
      final state = await tv.state();
      expect((state['pkg'], state['app']), ('com.example.tv', 'com.example.tv'));

      // The same volume again is no news.
      var calls = 0;
      tv.onChanged = () => calls++;
      fake.sendToPhone(
        tvMessage(
          50,
          ProtoWriter()
            ..varint(6, 100)
            ..varint(7, 21)
            ..boolean(8, true),
        ),
      );
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 1)));
      await fake.nextFromPhone();
      expect(calls, 0);
    });

    test('standby: remote_start false says off, and sleep sends no power key; on again it does', () async {
      final (fake, tv) = await connected(on: false);
      expect(await tv.state(), {'on': false});
      await tv.sleep();
      // Had it sent a key, the key would arrive before this ping's answer.
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 5)));
      expect(await fake.nextFromPhone(), bytesOf('4a 02 08 05'));
      final changed = nextChange(tv);
      fake.sendToPhone(tvMessage(40, ProtoWriter()..boolean(1, true)));
      await changed;
      expect((await tv.state())['on'], isTrue);
      await tv.sleep();
      expect(await fake.nextFromPhone(), bytesOf('52 04 08 1a 10 03'));
      expect(fake.takeFromPhone(), isEmpty);
    });

    test('typing goes through the input method with the counters the TV gave; submit presses Enter', () async {
      final (fake, tv) = await connected();
      // A field opened: the app's counter and the field's.
      final changed = nextChange(tv);
      fake.sendToPhone(
        tvMessage(
          20,
          ProtoWriter()
            ..message(
              1,
              ProtoWriter()
                ..varint(1, 3)
                ..string(12, 'com.google.android.youtube.tv'),
            )
            ..message(2, ProtoWriter()..varint(1, 9)),
        ),
      );
      await changed;
      await tv.type('hi');
      expect(await fake.nextFromPhone(), bytesOf('aa 01 12 08 03 10 09 1a 0c 08 01 12 08 08 02 10 02 1a 02 68 69'));

      await tv.type('Ünïcödé ✓', submit: true);
      final edit = ProtoMessage.decode(await fake.nextFromPhone()).message(21)!;
      final info = edit.messages(3).single;
      final object = info.message(2)!;
      expect((edit.int32(1), edit.int32(2), info.int32(1)), (3, 9, 1));
      expect((object.int32(1), object.int32(2), object.string(3)), (9, 9, 'Ünïcödé ✓'));
      expect(await fake.nextFromPhone(), bytesOf('52 04 08 42 10 03'));

      // Enter alone.
      await tv.type('', submit: true);
      expect(await fake.nextFromPhone(), bytesOf('52 04 08 42 10 03'));

      // A newer field status (remote_ime_show_request) moves the field counter.
      fake.sendToPhone(tvMessage(22, ProtoWriter()..message(2, ProtoWriter()..varint(1, 11))));
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 2)));
      await fake.nextFromPhone();
      await tv.type('x');
      final moved = ProtoMessage.decode(await fake.nextFromPhone()).message(21)!;
      expect((moved.int32(1), moved.int32(2)), (3, 11));
    });

    test('without counters from the key inject, remote_ime_batch_edit gives them', () async {
      final (fake, tv) = await connected();
      fake.sendToPhone(
        tvMessage(
          21,
          ProtoWriter()
            ..varint(1, 5)
            ..varint(2, 6),
        ),
      );
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 2)));
      await fake.nextFromPhone();
      await tv.type('a');
      final edit = ProtoMessage.decode(await fake.nextFromPhone()).message(21)!;
      expect((edit.int32(1), edit.int32(2)), (5, 6));
    });

    test('a TV without the input method: no typing, and the features it lacks are not asked for', () async {
      // 610 = key, power, volume, app link: no ping, no IME, no voice.
      final (fake, tv) = await connected(features: 610);
      expect(ProtoMessage.decode(fake.phoneConfigure!).message(1)!.int32(1), 610 & 615);
      expect(fake.phoneSetActive, bytesOf('12 03 08 e2 04'));
      expect(tv.caps, isNot(contains(Cap.type)));
      await expectLater(
        tv.type('hello'),
        throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)),
      );
    });

    test('pings are answered with their first value', () async {
      final (fake, tv) = await connected();
      fake.sendToPhone(
        tvMessage(
          8,
          ProtoWriter()
            ..varint(1, 12345)
            ..varint(2, 7),
        ),
      );
      expect(await fake.nextFromPhone(), bytesOf('4a 03 08 b9 60'));
      // Zero is proto3's default: the answer is an empty ping response.
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(2, 7)));
      expect(await fake.nextFromPhone(), bytesOf('4a 00'));
      expect(tv.isOpen, isTrue);
    });

    test('a message that does not parse is skipped; the connection goes on', () async {
      final (fake, tv) = await connected();
      fake.sendToPhone(bytesOf('0f ff'));
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 4)));
      expect(await fake.nextFromPhone(), bytesOf('4a 02 08 04'));
      expect(tv.isOpen, isTrue);
    });

    test('a drop: not open, onClosed once, and commands say unreachable', () async {
      final (fake, tv) = await connected();
      final closed = Completer<void>();
      var calls = 0;
      tv.onClosed = () {
        calls++;
        closed.complete();
      };
      fake.dropRemote();
      await closed.future.timeout(const Duration(seconds: 2));
      expect(tv.isOpen, isFalse);
      await expectLater(tv.key(RemoteKey.home), throwsA(isA<BrandUnreachable>()));
      await expectLater(tv.state(), throwsA(isA<BrandUnreachable>()));

      // It connects again.
      await tv.connect();
      expect(tv.isOpen, isTrue);
      expect(fake.remoteConnections, 2);
      expect(calls, 1);
    });

    test('close() is not a drop: no onClosed', () async {
      final (_, tv) = await connected();
      var calls = 0;
      tv.onClosed = () => calls++;
      await tv.close();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(tv.isOpen, isFalse);
      expect(calls, 0);
    });

    test('a TV that goes silent for longer than the idle time is taken as gone', () async {
      final fake = await fakeTv();
      final tv = driver(fake, idle: const Duration(milliseconds: 400));
      await tv.connect();
      final closed = Completer<void>();
      tv.onClosed = closed.complete;
      // A ping keeps it alive past the first idle span.
      await Future<void>.delayed(const Duration(milliseconds: 250));
      fake.sendToPhone(tvMessage(8, ProtoWriter()..varint(1, 1)));
      await Future<void>.delayed(const Duration(milliseconds: 250));
      expect(tv.isOpen, isTrue);
      await closed.future.timeout(const Duration(seconds: 2));
      expect(tv.isOpen, isFalse);
    });

    test('nothing at the address: unreachable', () async {
      final free = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final port = free.port;
      await free.close();
      final tv = AndroidTv(
        address: '127.0.0.1',
        identity: FileIdentity(phone),
        port: port,
        pairingPort: port,
        timeout: const Duration(seconds: 1),
      );
      tvs.add(tv);
      await expectLater(tv.connect(), throwsA(isA<BrandUnreachable>()));
      await expectLater(tv.startPairing(), throwsA(isA<BrandUnreachable>()));
    });

    test('a TV that takes the connection and says nothing: unreachable after the timeout', () async {
      final fake = await fakeTv(silent: true);
      final tv = driver(fake, timeout: const Duration(milliseconds: 400));
      await expectLater(tv.connect(), throwsA(isA<BrandUnreachable>()));
      expect(tv.isOpen, isFalse);
    });

    test('no key from the platform: a BrandError the person can read', () async {
      final fake = await fakeTv();
      final tv = AndroidTv(
        address: '127.0.0.1',
        identity: BrokenIdentity(),
        port: fake.remotePort,
        pairingPort: fake.pairingPort,
      );
      tvs.add(tv);
      await expectLater(
        tv.connect(),
        throwsA(isA<BrandError>().having((e) => e.message, 'message', 'The phone could not make its key for the TV.')),
      );
      await expectLater(tv.startPairing(), throwsA(isA<BrandError>()));
    });

    test('the identity is loaded once', () async {
      final fake = await fakeTv();
      final identity = FileIdentity(phone);
      final tv = AndroidTv(
        address: '127.0.0.1',
        identity: identity,
        port: fake.remotePort,
        pairingPort: fake.pairingPort,
      );
      tvs.add(tv);
      await tv.connect();
      await tv.connect();
      expect(identity.loads, 1);
    });

    test('no volume level to set', () async {
      final (_, tv) = await connected();
      await expectLater(
        tv.setVolume(10),
        throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)),
      );
      expect(tv.caps, isNot(contains(Cap.volumeLevel)));
    });
  });

  group('the MAC address in a TV certificate', () {
    test('is the last part of the subject', () {
      expect(AndroidTv.macOf('/CN=atvremote/darcy/darcy/SHIELD Android TV/00:04:4B:AA:BB:CC'), '00:04:4b:aa:bb:cc');
      expect(
        AndroidTv.macOf('/dnQualifier=fugu/fugu/Nexus Player/CN=atvremote/A0:B1:C2:D3:E4:F5'),
        'a0:b1:c2:d3:e4:f5',
      );
      expect(AndroidTv.macOf('/CN=atvremote'), isNull);
      expect(AndroidTv.macOf('/CN=atvremote/x/x/TV/00:00:00:00:00:00'), isNull);
      expect(AndroidTv.macOf(null), isNull);
    });
  });

  group('codec', () {
    test('varints', () {
      expect(encodeVarint(0), [0x00]);
      expect(encodeVarint(1), [0x01]);
      expect(encodeVarint(127), [0x7f]);
      expect(encodeVarint(128), [0x80, 0x01]);
      expect(encodeVarint(300), [0xac, 0x02]);
      expect(encodeVarint(615), [0xe7, 0x04]);
      expect(encodeVarint(0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07]);
      // A negative int32 is ten bytes (its 64-bit two's complement).
      expect(encodeVarint(-1), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    });

    test('a message written and read back (the examples in the protobuf encoding guide)', () {
      final inner = ProtoWriter()..varint(1, 150);
      expect(inner.toBytes(), [0x08, 0x96, 0x01]);
      final outer = ProtoWriter()
        ..string(2, 'testing')
        ..message(3, inner)
        ..boolean(4, true)
        ..varint(5, -2);
      final bytes = outer.toBytes();
      expect(bytes.sublist(0, 9), [0x12, 0x07, ...ascii('testing')]);
      expect(bytes.sublist(9, 14), [0x1a, 0x03, 0x08, 0x96, 0x01]);
      final read = ProtoMessage.decode(bytes);
      expect(read.string(2), 'testing');
      expect(read.message(3)!.uint32(1), 150);
      expect(read.boolean(4), isTrue);
      expect(read.int32(5), -2);
      expect((read.has(9), read.int32(9), read.string(9), read.message(9)), (false, 0, '', null));
    });

    test('fixed-width fields are skipped; groups and cut-off messages are refused', () {
      final read = ProtoMessage.decode([0x2d, 1, 2, 3, 4, 0x31, 1, 2, 3, 4, 5, 6, 7, 8, 0x08, 0x2a]);
      expect(read.int32(1), 42);
      expect(() => ProtoMessage.decode([0x0b]), throwsFormatException);
      expect(() => ProtoMessage.decode([0x12, 0x05, 0x01]), throwsFormatException);
      expect(() => ProtoMessage.decode([0x08, 0x80]), throwsFormatException);
      expect(() => ProtoMessage.decode([0x2d, 1, 2]), throwsFormatException);
    });

    test('frames: a length varint in front; any split of the stream reads the same', () {
      expect(frame([1, 2, 3]), [3, 1, 2, 3]);
      final big = List<int>.generate(300, (i) => i & 0xff);
      final stream = [
        ...frame([7]),
        ...frame(<int>[]),
        ...frame(big),
        ...frame([8, 9]),
      ];
      expect(stream.sublist(3, 5), [0xac, 0x02]);

      for (final size in [1, 2, 3, 5, 64, stream.length]) {
        final reader = FrameReader();
        final messages = <List<int>>[];
        for (var i = 0; i < stream.length; i += size) {
          messages.addAll(reader.add(stream.sublist(i, i + size > stream.length ? stream.length : i + size)));
        }
        expect(messages, [
          [7],
          <int>[],
          big,
          [8, 9],
        ], reason: 'chunks of $size');
      }
    });

    test('a corrupt or oversized length is refused', () {
      expect(() => FrameReader().add([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), throwsFormatException);
      expect(() => FrameReader(maxLength: 10).add([11]), throwsFormatException);
    });

    test('the pairing messages, byte for byte', () {
      const head = '08 02 10 c8 01';
      expect(
        Polo.pairingRequest('Orbit'),
        bytesOf('$head 52 12 0a 09 ${hex(ascii('atvremote'))} 12 05 ${hex(ascii('Orbit'))}'),
      );
      expect(Polo.options(), bytesOf('$head a2 01 08 0a 04 08 03 10 06 18 01'));
      expect(Polo.configuration(), bytesOf('$head f2 01 08 0a 04 08 03 10 06 10 01'));
      final secret = List<int>.generate(32, (i) => i);
      expect(Polo.secret(secret), bytesOf('$head c2 02 22 0a 20 ${hex(secret)}'));
    });

    test('a pairing reply: its status and its step', () {
      final ack = PoloReply.decode(bytesOf('08 02 10 c8 01 5a 00'));
      expect((ack.status, ack.step), (PoloStatus.ok, PoloField.pairingRequestAck));
      final bad = PoloReply.decode(bytesOf('08 02 10 92 03'));
      expect((bad.status, bad.step), (PoloStatus.badSecret, null));
    });

    test('the pairing secret, against a vector computed the way androidtvremote2 computes it', () {
      // Python: sha256(int_to_bytes(0xC3A1B2) + int_to_bytes(65537) + int_to_bytes(0xD4E5F60718) + int_to_bytes(3)
      //                + bytes.fromhex('1A2B')), int_to_bytes(v) = v.to_bytes((v.bit_length() + 7) // 8, 'big').
      const want = '7db9352e7d91051cd015004206b348a4fc69d214976cc4f16ca40cf3eee14c32';
      final secret = Polo.secretFor(
        clientModulus: [0x00, 0xc3, 0xa1, 0xb2],
        clientExponent: [0x01, 0x00, 0x01],
        serverModulus: [0xd4, 0xe5, 0xf6, 0x07, 0x18],
        serverExponent: [0x00, 0x03],
        code: '7d1a2b',
      );
      expect(hex(secret).toLowerCase(), want);
      expect(Polo.codeMatches('7D1A2B', secret), isTrue);
      expect(Polo.codeMatches('7E1A2B', secret), isFalse);
      expect(Polo.isCode('7D1A2'), isFalse);
      expect(Polo.isCode('7D1A2G'), isFalse);
    });

    test('the remote messages the phone sends, byte for byte', () {
      expect(RemoteMessages.setActive(615), bytesOf('12 03 08 e7 04'));
      expect(RemoteMessages.pingResponse(0), bytesOf('4a 00'));
      expect(RemoteMessages.key(26), bytesOf('52 04 08 1a 10 03'));
      expect(RemoteMessages.key(19, direction: RemoteDirection.startLong), bytesOf('52 04 08 13 10 01'));
      expect(RemoteMessages.appLink('plex://'), bytesOf('d2 05 09 0a 07 ${hex(ascii('plex://'))}'));
      expect(RemoteFeature.orbit, 615);
    });

    test('the remote messages the TV sends, read', () {
      final configure = RemoteNews.decode(
        tvMessage(
          1,
          ProtoWriter()
            ..varint(1, 622)
            ..message(
              2,
              ProtoWriter()
                ..string(1, 'SHIELD Android TV')
                ..string(2, 'NVIDIA')
                ..string(6, '5.2'),
            ),
        ),
      );
      expect(
        configure,
        isA<RemoteConfigure>().having((c) => (c.features, c.model, c.vendor), 'fields', (
          622,
          'SHIELD Android TV',
          'NVIDIA',
        )),
      );
      expect(RemoteNews.decode(bytesOf('12 00')), isA<RemoteSetActive>());
      expect(RemoteNews.decode(bytesOf('c2 02 00')), isA<RemoteStart>().having((s) => s.started, 'started', isFalse));
      expect(
        RemoteNews.decode(bytesOf('c2 02 02 08 01')),
        isA<RemoteStart>().having((s) => s.started, 'started', isTrue),
      );
      expect(RemoteNews.decode(bytesOf('42 02 08 07')), isA<RemotePing>().having((p) => p.val1, 'val1', 7));
      expect(
        RemoteNews.decode(
          tvMessage(
            50,
            ProtoWriter()
              ..varint(6, 15)
              ..varint(7, 4),
          ),
        ),
        isA<RemoteVolume>().having((v) => (v.level, v.max, v.muted), 'fields', (4, 15, false)),
      );
      expect(
        RemoteNews.decode(tvMessage(22, ProtoWriter())),
        isA<RemoteImeShow>().having((s) => s.fieldCounter, 'field', isNull),
      );
      expect(RemoteNews.decode(bytesOf('1a 00')), isA<RemoteFailure>());
      expect(RemoteNews.decode(bytesOf('f2 01 00')), isA<RemoteOther>());
      expect(() => RemoteNews.decode(bytesOf('0a 05 08')), throwsFormatException);
    });
  });

  group('der', () {
    test('the RSA numbers of a certificate, without their sign byte', () {
      final modulus = [0x00, 0xc3, ...List<int>.filled(128, 0x5a)];
      final cert = handmadeCertificate(modulus, [0x01, 0x00, 0x01]);
      final key = rsaPublicKeyOfCertificate(cert);
      expect(key.modulus, [0xc3, ...List<int>.filled(128, 0x5a)]);
      expect(key.exponent, [0x01, 0x00, 0x01]);
    });

    test('a version 1 certificate (no version field) reads the same', () {
      final key = rsaPublicKeyOfCertificate(handmadeCertificate([0x00, 0x80, 0x01], [0x03], v1: true));
      expect(key.modulus, [0x80, 0x01]);
      expect(key.exponent, [0x03]);
    });

    test('anything but an RSA certificate is refused', () {
      // id-ecPublicKey, 1.2.840.10045.2.1.
      final ec = handmadeCertificate([0x01], [0x03], oid: [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
      expect(() => rsaPublicKeyOfCertificate(ec), throwsFormatException);
      final cert = handmadeCertificate([0x00, 0xc3, 0x01], [0x03]);
      expect(() => rsaPublicKeyOfCertificate(cert.sublist(0, cert.length - 10)), throwsFormatException);
      expect(() => rsaPublicKeyOfCertificate([0x30, 0x80]), throwsFormatException);
      expect(() => rsaPublicKeyOfCertificate(handmadeCertificate([0xc3, 0x01], [0x03])), throwsFormatException);
    });

    test('PEM to DER', () {
      final cert = handmadeCertificate([0x00, 0xc3, 0x01], [0x03]);
      final b64 = base64.encode(cert);
      final pem =
          'junk\r\n-----BEGIN CERTIFICATE-----\r\n${b64.substring(0, 20)}\r\n${b64.substring(20)}\r\n'
          '-----END CERTIFICATE-----\r\n';
      expect(derOfPem(pem), cert);
      expect(() => derOfPem(pem, label: 'PRIVATE KEY'), throwsFormatException);
    });

    test('agrees with openssl on real certificates', () {
      for (final cert in [tvCert, phone, otherPhone]) {
        final key = rsaPublicKeyOfCertificate(derOfPem(cert.certPem));
        expect(key.modulus, cert.modulus);
        expect(key.modulus.length, 256);
        expect(key.exponent, cert.exponent);
      }
    });
  });

  group('PlatformRemoteIdentity', () {
    test('asks the dev.shiv.orbit/atvidentity channel to load, and reads cert and key', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      const channel = MethodChannel('dev.shiv.orbit/atvidentity');
      final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return {'cert': phone.certPem, 'key': phone.keyPem};
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
      final credentials = await const PlatformRemoteIdentity().load();
      expect(calls, ['load']);
      expect((credentials.certPem, credentials.keyPem), (phone.certPem, phone.keyPem));

      messenger.setMockMethodCallHandler(channel, (call) async => <String, Object?>{});
      await expectLater(const PlatformRemoteIdentity().load(), throwsFormatException);
    });
  });
}
