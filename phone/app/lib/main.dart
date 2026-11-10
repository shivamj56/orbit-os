import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'app/orbit_app.dart';
import 'app/theme.dart';
import 'cloud/firebase_backend.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Firebase (options from google-services.json) starts alongside the page; if it fails, the Wi-Fi path still works.
  final firebase = FirebaseBackend.start();
  await SystemChrome.setPreferredOrientations(const [DeviceOrientation.portraitUp]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(OrbitColors.systemBars);
  runApp(OrbitApp(firebase: firebase));
}
