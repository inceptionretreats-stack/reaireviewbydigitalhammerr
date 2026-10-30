import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// Where the app finds the Ai Review website and its API.
///
/// The app and the website are one product: the same accounts, the same database, the same
/// `/api/v1`. Only the origin differs between environments.
///
/// - Release builds talk to production.
/// - Debug builds talk to the local dev server started from the repository root
///   (`pnpm --filter @ai-review/web dev --hostname 127.0.0.1 --port 3000`). The Android
///   emulator reaches the host's loopback at 10.0.2.2.
/// - Either can be overridden: `flutter run --dart-define=WEB_BASE_URL=https://example.com`.
class AppConfig {
  AppConfig._();

  static const String _override = String.fromEnvironment('WEB_BASE_URL');
  static const String productionOrigin = 'https://aireview.digitalhammerr.com';

  static final String webBaseUrl = _resolveWebBaseUrl();

  static String get apiBaseUrl => '$webBaseUrl/api/v1';

  /// A page on the website, for the few flows that stay on the web (checkout, password reset).
  static Uri webPage(String path) => Uri.parse('$webBaseUrl$path');

  static String _resolveWebBaseUrl() {
    if (_override.isNotEmpty) return _override.replaceAll(RegExp(r'/+$'), '');
    if (kReleaseMode) return productionOrigin;
    if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:3000';
    return 'http://127.0.0.1:3000';
  }
}
