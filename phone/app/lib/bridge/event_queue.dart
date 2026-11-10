/// Events for the page (`{"event":...,"data":...}`), held until the page has said `hello`.
///
/// While held, only the newest `status`, `tvstate`, `account`, `lifecycle` and `screen` are kept (each is a whole snapshot,
/// so an older one says nothing the newer does not); other events (`volumeKey`) are kept in order, the newest [limit] of
/// them.
class EventQueue {
  EventQueue(this._send, {this.limit = 32});

  final void Function(Map<String, Object?> message) _send;
  final int limit;
  final List<Map<String, Object?>> _held = [];
  bool _open = false;

  static const Set<String> snapshots = {'status', 'tvstate', 'account', 'lifecycle', 'screen'};

  /// True after [open] (the page said hello) until [close] (a new page started loading).
  bool get isOpen => _open;

  /// The events waiting for the page, oldest first.
  List<Map<String, Object?>> get held => List.unmodifiable(_held);

  void push(String event, Object? data) {
    final message = <String, Object?>{'event': event, 'data': data};
    if (_open) {
      _send(message);
      return;
    }
    if (snapshots.contains(event)) _held.removeWhere((held) => held['event'] == event);
    _held.add(message);
    while (_held.length > limit) {
      _held.removeAt(0);
    }
  }

  /// The page is ready: everything held goes out, in order, and later events go straight through.
  void open() {
    if (_open) return;
    _open = true;
    final held = List.of(_held);
    _held.clear();
    for (final message in held) {
      _send(message);
    }
  }

  /// A new page is loading: hold events again until it says hello.
  void close() => _open = false;
}
