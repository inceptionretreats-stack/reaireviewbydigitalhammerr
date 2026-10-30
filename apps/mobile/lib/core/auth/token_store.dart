import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps the session token in the platform keystore (Android Keystore / iOS Keychain).
///
/// The token is the same opaque session the website keeps in its HttpOnly cookie: one row in the
/// shared sessions table. Signing out of "other devices" on the website revokes it here too.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'ai_review.session_token';
  final FlutterSecureStorage _storage;

  Future<String?> read() => _storage.read(key: _key);

  Future<void> write(String token) => _storage.write(key: _key, value: token);

  Future<void> clear() => _storage.delete(key: _key);
}
