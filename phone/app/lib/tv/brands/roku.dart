/// Roku players and Roku TVs, driven through ECP (External Control Protocol): plain HTTP on port 8060, nothing to
/// pair. The one thing that can stand in the way is a setting on the Roku (Roku OS 13 and later): when "Control by
/// mobile apps" is not on Default, ECP answers 403 to phones, and [BrandRefused.setting] tells the person where to
/// change it.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'brand.dart';

/// A Roku at [address]. Volume and power keys work on a Roku TV ([isTv]), and on a streaming player that says it was
/// set up to work the TV's volume or power (device-info since Roku OS 15.0); on any other player they stay hidden.
class RokuTv extends BrandTv {
  RokuTv({required this.address, this.port = 8060, this.timeout = const Duration(seconds: 3)});

  @override
  final String address;

  final int port;

  /// How long one request may take before the Roku counts as not answering.
  final Duration timeout;

  /// The text the person sees when the Roku's network setting blocks phones. Roku's own menu names.
  static const String settingMessage =
      'On the Roku, go to Settings › System › Advanced system settings › Control by mobile apps, '
      'and set Network access to Default or Enabled.';

  static const String _cannot = 'This Roku cannot do that.';
  static const String _failed = 'The Roku did not accept that.';

  /// Roku's key names (ECP `keypress`), for the keys every Roku has.
  static const Map<String, String> _keys = {
    RemoteKey.up: 'Up',
    RemoteKey.down: 'Down',
    RemoteKey.left: 'Left',
    RemoteKey.right: 'Right',
    RemoteKey.ok: 'Select',
    RemoteKey.back: 'Back',
    RemoteKey.home: 'Home',
    RemoteKey.settings: 'Info',
    RemoteKey.playPause: 'Play',
    RemoteKey.forward: 'Fwd',
    RemoteKey.rewind: 'Rev',
    RemoteKey.previous: 'InstantReplay',
  };

  /// Volume keys: a Roku TV's own, or the TV's through a player set up for it.
  static const Map<String, String> _tvKeys = {
    RemoteKey.mute: 'VolumeMute',
    RemoteKey.volumeUp: 'VolumeUp',
    RemoteKey.volumeDown: 'VolumeDown',
  };

  /// How long a read of the power mode stays fresh: [state] runs often, device-info is a bigger answer.
  static const Duration _powerFresh = Duration(seconds: 10);

  final HttpClient _http = HttpClient();
  bool _open = false;
  bool _closedForGood = false;
  bool _isTv = false;
  bool _volumeKeys = false;
  bool _powerKey = false;
  String? _model;
  String? _deviceName;
  bool _powerOn = true;
  DateTime? _powerReadAt;

  void Function()? _onClosed;
  void Function()? _onChanged;

  @override
  void Function()? get onClosed => _onClosed;

  @override
  set onClosed(void Function()? value) => _onClosed = value;

  @override
  void Function()? get onChanged => _onChanged;

  @override
  set onChanged(void Function()? value) => _onChanged = value;

  @override
  TvKind get kind => TvKind.roku;

  @override
  PairingWay get pairingWay => PairingWay.none;

  @override
  String? get secret => null;

  @override
  bool get isOpen => _open;

  /// True for a Roku TV (device-info `is-tv`), false for a player or before [connect].
  bool get isTv => _isTv;

  /// The model ("Roku Ultra", "55R6A5R"), or null when the Roku does not say.
  @override
  String? get model => _model;

  /// The name the owner gave the Roku, else its friendly or default name.
  String? get deviceName => _deviceName;

  @override
  Set<String> get caps => {
    Cap.keys,
    Cap.media,
    Cap.type,
    Cap.apps,
    Cap.launch,
    Cap.settings,
    Cap.nowPlaying,
    if (_volumeKeys) ...{Cap.volume, Cap.mute},
    if (_powerKey) Cap.power,
  };

  @override
  Future<void> connect() async {
    _closedForGood = false;
    await _readDeviceInfo();
    _open = true;
  }

  @override
  Future<void> startPairing() async => throw const BrandError(_cannot, unsupported: true);

  @override
  Future<void> finishPairing(String code) async => throw const BrandError(_cannot, unsupported: true);

  @override
  Future<void> key(String key) async {
    final word = _keys[key] ?? (_volumeKeys ? _tvKeys[key] : null);
    if (word == null) throw const BrandError(_cannot, unsupported: true);
    await _post('/keypress/$word');
  }

  /// One `Lit_` key per character, in order: ECP takes a single character per request. Characters are taken by code
  /// point so an emoji goes out whole, percent-encoded as UTF-8.
  @override
  Future<void> type(String text, {bool submit = false}) async {
    for (final rune in text.runes) {
      await _post('/keypress/Lit_${Uri.encodeComponent(String.fromCharCode(rune))}');
    }
    if (submit) await _post('/keypress/Enter');
  }

  /// Apps and the Roku's own menus; the TV inputs (HDMI, antenna: type `tvin`) are not apps and stay out. Older Roku
  /// OS lists apps with no type at all (`<app id="12">Netflix</app>`), and those are apps too.
  @override
  Future<List<TvApp>> apps() async {
    final body = utf8.decode((await _get('/query/apps')).bytes, allowMalformed: true);
    final list = <TvApp>[];
    for (final tag in _appTags(body)) {
      final type = tag.attrs['type'];
      final id = tag.attrs['id'];
      if (id == null || id.isEmpty || (type != null && type != 'appl' && type != 'menu')) continue;
      list.add(TvApp(id, tag.text));
    }
    list.sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return list;
  }

  @override
  Future<void> launch(String id) => _post('/launch/${Uri.encodeComponent(id)}');

  @override
  Future<(String, Uint8List)?> icon(String id) async {
    final reply = await _get('/query/icon/${Uri.encodeComponent(id)}', missingOk: true);
    if (reply.status == 404 || reply.bytes.isEmpty) return null;
    return (reply.type ?? 'image/png', reply.bytes);
  }

  @override
  Future<Map<String, Object?>> state() async {
    final body = utf8.decode((await _get('/query/active-app')).bytes, allowMalformed: true);
    final tags = _appTags(body);
    final id = tags.isEmpty ? null : tags.first.attrs['id'];
    // With nothing open the Roku names itself ("Roku") and gives no id: that is its Home screen.
    final hasApp = id != null && id.isNotEmpty;
    final label = tags.isEmpty ? '' : tags.first.text;
    final out = <String, Object?>{'app': hasApp && label.isNotEmpty ? label : 'Home', 'pkg': hasApp ? id : null};
    final read = _powerReadAt;
    if (read == null || DateTime.now().difference(read) >= _powerFresh) await _readDeviceInfo();
    out['on'] = _powerOn;
    return out;
  }

  @override
  Future<void> setVolume(int level) async => throw const BrandError(_cannot, unsupported: true);

  /// PowerOff: a Roku TV goes to standby, and so does the TV behind a player set up for TV power control. Any other
  /// player has no off key that ECP offers.
  @override
  Future<void> sleep() async {
    if (!_powerKey) throw const BrandError(_cannot, unsupported: true);
    await _post('/keypress/PowerOff');
  }

  @override
  Future<void> close() async {
    _closedForGood = true;
    _open = false;
    _http.close(force: true);
  }

  // ---- ECP over HTTP ----

  /// Reads device-info and keeps what the Roku says about itself.
  Future<void> _readDeviceInfo() async {
    final body = utf8.decode((await _get('/query/device-info')).bytes, allowMalformed: true);
    String? field(String name) => _tagText(body, name);
    String? firstOf(List<String> names) {
      for (final n in names) {
        final v = field(n);
        if (v != null && v.isNotEmpty) return v;
      }
      return null;
    }

    _isTv = field('is-tv')?.toLowerCase() == 'true';
    // Roku OS 15.0 and later: a player set up to work the TV (HDMI-CEC or IR) says so, and then takes the same keys.
    _volumeKeys = _isTv || field('supports-audio-volume-control')?.toLowerCase() == 'true';
    _powerKey = _isTv || field('supports-tv-power-control')?.toLowerCase() == 'true';
    _model = field('model-name');
    _deviceName = firstOf(['user-device-name', 'friendly-device-name', 'default-device-name']);
    final power = field('power-mode');
    // A player may leave the field out: it answers, so it is on.
    _powerOn = power == null || power == 'PowerOn';
    _powerReadAt = DateTime.now();
  }

  Future<_Reply> _get(String path, {bool missingOk = false}) => _send('GET', path, missingOk: missingOk);

  Future<void> _post(String path) => _send('POST', path);

  Future<_Reply> _send(String method, String path, {bool missingOk = false}) async {
    final _Reply reply;
    try {
      final request = await _http.openUrl(method, Uri.parse('http://$address:$port$path')).timeout(timeout);
      if (method == 'POST') request.contentLength = 0;
      final response = await request.close().timeout(timeout);
      final bytes = BytesBuilder(copy: false);
      await for (final chunk in response.timeout(timeout)) {
        bytes.add(chunk);
      }
      reply = _Reply(response.statusCode, bytes.takeBytes(), response.headers.contentType?.mimeType);
    } on Object catch (e) {
      _dropped();
      throw BrandUnreachable(e);
    }
    // 403, and on some firmware of 2024 401: the network-access setting stops phones.
    if (reply.status == 403 || reply.status == 401) throw const BrandRefused(BrandRefused.setting, settingMessage);
    if (missingOk && reply.status == 404) return reply;
    if (reply.status < 200 || reply.status >= 300) throw const BrandError(_failed);
    return reply;
  }

  /// No answer: the Roku went to sleep or off the network. Tell the link once, unless we closed it ourselves.
  void _dropped() {
    if (!_open || _closedForGood) return;
    _open = false;
    _onClosed?.call();
  }

  // ---- a tiny reader for ECP's flat XML ----

  static String? _tagText(String xml, String name) {
    final m = RegExp('<${RegExp.escape(name)}(?:\\s[^>]*)?>([^<]*)</${RegExp.escape(name)}\\s*>').firstMatch(xml);
    if (m == null) return null;
    return _decode(m.group(1)!).trim();
  }

  static List<_AppTag> _appTags(String xml) {
    final out = <_AppTag>[];
    for (final m in RegExp(r'<app\b([^>]*?)(?:/>|>([^<]*)</app\s*>)').allMatches(xml)) {
      final attrs = <String, String>{};
      for (final a in RegExp('([\\w:-]+)\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').allMatches(m.group(1)!)) {
        attrs[a.group(1)!] = _decode(a.group(2) ?? a.group(3) ?? '');
      }
      out.add(_AppTag(attrs, _decode(m.group(2) ?? '').trim()));
    }
    return out;
  }

  /// The five named entities and numeric ones (&#38; and &#x26;). `&amp;` goes last so "&amp;lt;" stays "&lt;".
  static String _decode(String s) {
    if (!s.contains('&')) return s;
    return s.replaceAllMapped(RegExp(r'&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|quot|apos|amp);'), (m) {
      final e = m.group(1)!;
      switch (e) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'amp':
          return '&';
      }
      final code = e.startsWith('#x') ? int.tryParse(e.substring(2), radix: 16) : int.tryParse(e.substring(1));
      if (code == null || code <= 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return m.group(0)!;
      return String.fromCharCode(code);
    });
  }
}

class _Reply {
  const _Reply(this.status, this.bytes, this.type);

  final int status;
  final Uint8List bytes;
  final String? type;
}

class _AppTag {
  const _AppTag(this.attrs, this.text);

  final Map<String, String> attrs;
  final String text;
}
