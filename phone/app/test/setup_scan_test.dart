import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/setup/setup_scan.dart';

void main() {
  group('mergeScan (setupScan merging by address)', () {
    test('one address seen on several service types becomes one TV, orbit if any was _orbit._tcp', () {
      final merged = mergeScan([
        const ScannedService(address: '192.168.1.7', serviceName: 'Android TV 1234', model: null),
        const ScannedService(address: '192.168.1.7', fn: 'Family room', serviceName: 'Chromecast', model: 'MiTV-AXFU0'),
        const ScannedService(address: '192.168.1.7', orbit: true),
      ]);
      expect(merged, [
        {'name': 'Family room', 'address': '192.168.1.7', 'model': 'MiTV-AXFU0', 'orbit': true},
      ]);
    });

    test('name is TXT fn, else the service name; model is TXT md, else null', () {
      final merged = mergeScan([
        const ScannedService(address: '10.0.0.5', serviceName: 'Bedroom cast'),
        const ScannedService(address: '10.0.0.9', fn: 'Lounge', model: 'AFTKA'),
      ]);
      expect(merged, [
        {'name': 'Bedroom cast', 'address': '10.0.0.5', 'model': null, 'orbit': false},
        {'name': 'Lounge', 'address': '10.0.0.9', 'model': 'AFTKA', 'orbit': false},
      ]);
    });

    test('a friendly name wins over a bare service name whatever the order', () {
      final serviceFirst = mergeScan([
        const ScannedService(address: '1.1.1.1', serviceName: 'raw-name'),
        const ScannedService(address: '1.1.1.1', fn: 'Nice Name'),
      ]);
      final fnFirst = mergeScan([
        const ScannedService(address: '1.1.1.1', fn: 'Nice Name'),
        const ScannedService(address: '1.1.1.1', serviceName: 'raw-name'),
      ]);
      expect(serviceFirst.single['name'], 'Nice Name');
      expect(fnFirst.single['name'], 'Nice Name');
    });

    test('blank TXT values and empty addresses are ignored; result is sorted by name then address', () {
      final merged = mergeScan([
        const ScannedService(address: '  ', fn: 'Ghost'),
        const ScannedService(address: '192.168.1.20', fn: '  ', serviceName: '  ', model: '  '),
        const ScannedService(address: '192.168.1.8', fn: 'Apple'),
        const ScannedService(address: '192.168.1.9', fn: 'apple'),
      ]);
      expect(merged.map((m) => m['address']), ['192.168.1.8', '192.168.1.9', '192.168.1.20']);
      expect(merged[0]['name'], 'Apple');
      // The all-blank entry falls back to the default name.
      expect(merged.last, {'name': 'TV', 'address': '192.168.1.20', 'model': null, 'orbit': false});
    });
  });
}
