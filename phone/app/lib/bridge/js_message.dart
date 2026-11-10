import 'dart:convert';

/// The script that hands [message] to the page: `window.orbitReceive(message)` (phone/SPEC.md, "The bridge").
///
/// The message is JSON-encoded, and that JSON text goes in as one JS string literal that the page's own JSON.parse
/// reads, so no part of any value is ever read as code. The literal is pure ASCII: `<`, `>`, `&` and everything from
/// U+007F up (U+2028 and U+2029 among them) are `\uXXXX` escapes, so no `</script>`, no line separator and no encoding
/// on the way through the platform channel can change it.
String receiveScript(Map<String, Object?> message) =>
    '(function(){var f=window.orbitReceive;'
    'if(typeof f==="function")f(JSON.parse(${jsStringLiteral(jsonEncode(message))}));})();';

/// [text] as a double-quoted JS (and JSON) string literal in ASCII only.
String jsStringLiteral(String text) {
  final quoted = jsonEncode(text);
  final out = StringBuffer();
  for (final unit in quoted.codeUnits) {
    if (unit == 0x3C || unit == 0x3E || unit == 0x26 || unit >= 0x7F) {
      out.write(r'\u');
      out.write(unit.toRadixString(16).padLeft(4, '0'));
    } else {
      out.writeCharCode(unit);
    }
  }
  return out.toString();
}
