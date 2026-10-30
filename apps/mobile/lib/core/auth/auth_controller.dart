import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import 'token_store.dart';

sealed class AuthState {
  const AuthState();
}

/// The stored token has not been read yet (app start).
class AuthLoading extends AuthState {
  const AuthLoading();
}

class SignedOut extends AuthState {
  const SignedOut({this.reason});

  /// Shown on the sign-in screen, e.g. after the website revoked this device's session.
  final String? reason;
}

class SignedIn extends AuthState {
  const SignedIn({this.isNewAccount = false});

  /// Just signed up: the router sends a new owner into setup, as the website does after signup.
  final bool isNewAccount;
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(onUnauthorized: () => ref.read(authControllerProvider.notifier).sessionEnded());
});

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Owns the session token: sign in, sign up, sign out, and reacting to a revoked session.
class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _restore();
    return const AuthLoading();
  }

  ApiClient get _api => ref.read(apiClientProvider);
  TokenStore get _store => ref.read(tokenStoreProvider);

  Future<void> _restore() async {
    String? token;
    try {
      token = await _store.read();
    } catch (_) {
      // A keystore that cannot be read (e.g. after a backup restore) means signing in again.
      token = null;
    }
    _api.token = token;
    state = token == null ? const SignedOut() : const SignedIn();
  }

  Future<void> signIn({required String email, required String password}) async {
    final body = await _api.post('/auth/login', {
      'email': email.trim(),
      'password': password,
      'remember_me': true,
    });
    await _adopt(body);
  }

  Future<void> signUp({
    required String fullName,
    required String email,
    required String mobile,
    required String password,
  }) async {
    final body = await _api.post('/auth/signup', {
      'full_name': fullName.trim(),
      'email': email.trim(),
      'mobile': mobile.trim(),
      'password': password,
      'accept_terms': true,
    });
    await _adopt(body, isNewAccount: true);
  }

  /// A password change rotates the session; the server hands the new token back.
  Future<void> replaceToken(dynamic body) async {
    final token = _tokenFrom(body);
    if (token == null) return;
    await _store.write(token);
    _api.token = token;
  }

  Future<void> signOut() async {
    try {
      await _api.post('/auth/logout');
    } catch (_) {
      // Revoking on the server is best effort; the device forgets the token either way.
    }
    await _forget();
    state = const SignedOut();
  }

  /// The server no longer accepts this device's session.
  Future<void> sessionEnded() async {
    if (state is! SignedIn) return;
    await _forget();
    state = const SignedOut(reason: 'You were signed out. Please sign in again.');
  }

  Future<void> _adopt(dynamic body, {bool isNewAccount = false}) async {
    final token = _tokenFrom(body);
    if (token == null) {
      throw StateError('The server did not return a session for the app.');
    }
    await _store.write(token);
    _api.token = token;
    state = SignedIn(isNewAccount: isNewAccount);
  }

  Future<void> _forget() async {
    _api.token = null;
    try {
      await _store.clear();
    } catch (_) {}
  }

  static String? _tokenFrom(dynamic body) {
    if (body is! Map) return null;
    final session = body['session'];
    if (session is! Map) return null;
    return session['token'] as String?;
  }
}
