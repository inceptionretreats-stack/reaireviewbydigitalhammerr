import 'dart:convert';
import 'dart:typed_data';

import 'package:ai_review/core/api/api_client.dart';
import 'package:ai_review/core/api/api_exception.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// Answers every request with a canned response and records what was sent.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? body, Future<void>? cancel) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body, {Map<String, List<String>> headers = const {}}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
        ...headers,
      },
    );

void main() {
  late _FakeAdapter adapter;
  late int unauthorizedCalls;

  ApiClient client(ResponseBody Function(RequestOptions) respond) {
    adapter = _FakeAdapter(respond);
    unauthorizedCalls = 0;
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))..httpClientAdapter = adapter;
    return ApiClient(dio: dio, onUnauthorized: () => unauthorizedCalls++);
  }

  test('marks every request as the owner app, and adds the bearer token once signed in', () async {
    final api = client((_) => _json(200, {'ok': true}));

    await api.get('/business');
    expect(adapter.requests.last.headers['x-client'], 'ai-review-mobile');
    expect(adapter.requests.last.headers.containsKey('authorization'), isFalse);

    api.token = 'secret-token';
    await api.post('/qr', {'source_label': 'Counter'});
    expect(adapter.requests.last.headers['authorization'], 'Bearer secret-token');
    expect(adapter.requests.last.method, 'POST');
  });

  test('drops null query parameters instead of sending them as "null"', () async {
    final api = client((_) => _json(200, {}));

    await api.get('/analytics/overview', query: {'from': null, 'to': '2026-10-30'});

    expect(adapter.requests.last.queryParameters, {'to': '2026-10-30'});
  });

  test("maps the server's error envelope, including fields and Retry-After", () async {
    final api = client(
      (_) => _json(
        429,
        {
          'error': {
            'code': 'AUTH_RATE_LIMITED',
            'message': 'Too many sign-in attempts.',
            'request_id': 'req-1',
            'details': {
              'fields': ['email'],
            },
          },
        },
        headers: {
          'retry-after': ['30'],
        },
      ),
    );

    final error = await api
        .post('/auth/login')
        .then<ApiException?>((_) => null, onError: (e) => e as ApiException);

    expect(error!.code, 'AUTH_RATE_LIMITED');
    expect(error.message, 'Too many sign-in attempts.');
    expect(error.status, 429);
    expect(error.fields, ['email']);
    expect(error.retryAfterSeconds, 30);
    expect(error.requestId, 'req-1');
  });

  test('a revoked session signs the app out, but a failed sign-in does not', () async {
    final api = client(
      (_) => _json(401, {
        'error': {'code': 'AUTH_REQUIRED', 'message': 'Please sign in and try again.', 'request_id': 'r'},
      }),
    );

    await expectLater(api.get('/business'), throwsA(isA<ApiException>()));
    expect(unauthorizedCalls, 0, reason: 'no token was held, so nothing was revoked');

    api.token = 'revoked';
    await expectLater(api.get('/business'), throwsA(isA<ApiException>()));
    expect(unauthorizedCalls, 1);
  });

  test('a non-JSON failure still becomes a readable ApiException', () async {
    final api = client((_) => ResponseBody.fromString('<html>500</html>', 500));

    final error = await api.get('/x').then<ApiException?>((_) => null, onError: (e) => e as ApiException);

    expect(error!.code, ApiException.unexpected);
    expect(error.status, 500);
  });

  test('an unreachable server is reported as a network problem', () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
      ..httpClientAdapter = _ThrowingAdapter();
    final api = ApiClient(dio: dio, onUnauthorized: () {});

    final error = await api.get('/x').then<ApiException?>((_) => null, onError: (e) => e as ApiException);

    expect(error!.code, ApiException.network);
  });
}

class _ThrowingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? body, Future<void>? cancel) =>
      throw DioException.connectionError(requestOptions: options, reason: 'offline');

  @override
  void close({bool force = false}) {}
}
