import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/pointer_udp.dart';

import 'mock_tv.dart';

const String token = '0123456789abcdef0123456789abcdef';

void main() {
  group('PointerDatagram.encode', () {
    test('is the SPEC line: o1 <token> <seq> m|s <dx> <dy>, single spaces', () {
      expect(PointerDatagram.encode(token: token, seq: 41, kind: 'm', dx: 3.5, dy: -1.2), 'o1 $token 41 m 3.5 -1.2');
      expect(PointerDatagram.encode(token: token, seq: 42, kind: 's', dx: 0, dy: -8), 'o1 $token 42 s 0 -8');
      final line = PointerDatagram.encode(token: token, seq: 7, kind: 'm', dx: 1, dy: 2);
      expect(line.split(' '), hasLength(6));
      expect(line, isNot(contains('  ')));
      expect(ascii.encode(line), isNotEmpty); // pure ASCII
    });

    test('numbers: two decimals at most, no exponent, no -0', () {
      expect(PointerDatagram.formatDelta(3.5), '3.5');
      expect(PointerDatagram.formatDelta(-1.2), '-1.2');
      expect(PointerDatagram.formatDelta(0), '0');
      expect(PointerDatagram.formatDelta(-0.0), '0');
      expect(PointerDatagram.formatDelta(-0.001), '0');
      expect(PointerDatagram.formatDelta(12.3456), '12.35');
      expect(PointerDatagram.formatDelta(1e-7), '0');
      expect(PointerDatagram.formatDelta(1e21), '10000');
      expect(PointerDatagram.formatDelta(-8), '-8');
      expect(PointerDatagram.formatDelta(double.nan), '0');
    });

    test('seq is masked to 31 bits', () {
      expect(
        PointerDatagram.encode(token: token, seq: 0x80000005, kind: 'm', dx: 0, dy: 0),
        startsWith('o1 $token 5 '),
      );
    });
  });

  group('PointerSender', () {
    late RawDatagramSocket tv;
    late List<String> lines;

    setUp(() async {
      lines = [];
      tv = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      tv.listen((event) {
        if (event == RawSocketEvent.read) {
          final d = tv.receive();
          if (d != null) lines.add(ascii.decode(d.data));
        }
      });
    });

    tearDown(() => tv.close());

    test('sends one datagram per move, seq up by one each time, on one socket', () async {
      final sender = PointerSender(startSeq: 1000);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: 3.5, dy: -1.2);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 's', dx: 0, dy: -8);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: -2, dy: 4.25);
      await eventually(() => lines.length == 3, what: 'three datagrams');
      expect(lines, ['o1 $token 1000 m 3.5 -1.2', 'o1 $token 1001 s 0 -8', 'o1 $token 1002 m -2 4.25']);
      sender.close();
    });

    test('seq wraps at 2^31 to 0', () async {
      final sender = PointerSender(startSeq: 0x7fffffff);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: 1, dy: 1);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: 1, dy: 1);
      await eventually(() => lines.length == 2, what: 'two datagrams');
      expect(lines.map((l) => l.split(' ')[2]), ['2147483647', '0']);
      expect(sender.nextSeq, 1);
      sender.close();
    });

    test('a move that is not a number is not sent, and nothing is sent after close', () async {
      final sender = PointerSender(startSeq: 5);
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: double.nan, dy: 1);
      sender.close();
      await sender.send(address: '127.0.0.1', port: tv.port, token: token, kind: 'm', dx: 1, dy: 1);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(lines, isEmpty);
      expect(sender.nextSeq, 5);
    });

    test('starts from the clock by default, so a reopened app numbers above the last run', () {
      final before = DateTime.now().millisecondsSinceEpoch & PointerDatagram.seqMask;
      final seq = PointerSender().nextSeq;
      final after = DateTime.now().millisecondsSinceEpoch & PointerDatagram.seqMask;
      expect(seq, inInclusiveRange(before, after));
    });
  });
}
