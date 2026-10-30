import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config.dart';
import 'api_exception.dart';

/// The one HTTP client for the website's `/api/v1`.
///
/// Every request carries `X-Client: ai-review-mobile`; once signed in it also carries
/// `Authorization: Bearer <session token>`. The server treats both as proof the request is not a
/// cross-site forgery (apps/web/lib/mobile-client.ts), which is what lets a native app use the
/// same API the website's own pages call.
class ApiClient {
  ApiClient({Dio? dio, required this.onUnauthorized})
    : _dio = dio ?? Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl)) {
    _dio.options
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 60)
      ..headers.addAll({
        'x-client': 'ai-review-mobile',
        'accept': 'application/json',
        // Shown on the website's "Sessions" list, so the owner can tell this device apart.
        if (!kIsWeb) 'user-agent': 'AiReview-Mobile/1.0 (${Platform.operatingSystem})',
      });
  }

  final Dio _dio;

  /// Called when an authenticated request comes back AUTH_REQUIRED: the session was revoked or
  /// expired (for example, "sign out other devices" on the website).
  final void Function() onUnauthorized;

  String? _token;

  set token(String? value) => _token = value;

  Future<dynamic> get(String path, {Map<String, Object?>? query}) => _send('GET', path, query: query);

  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body: body ?? {});

  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body: body ?? {});

  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body ?? {});

  Future<dynamic> delete(String path, [Object? body]) => _send('DELETE', path, body: body);

  Future<Uint8List> getBytes(String path, {Map<String, Object?>? query}) async {
    final response = await _request<List<int>>('GET', path, query: query, responseType: ResponseType.bytes);
    return Uint8List.fromList(response.data ?? const []);
  }

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, Object?>? query}) async {
    final response = await _request<dynamic>(method, path, body: body, query: query);
    return response.data;
  }

  Future<Response<T>> _request<T>(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    ResponseType? responseType,
  }) async {
    final authenticated = _token != null;
    try {
      return await _dio.request<T>(
        path,
        data: body,
        queryParameters: query == null
            ? null
            : {
                for (final entry in query.entries)
                  if (entry.value != null) entry.key: entry.value,
              },
        options: Options(
          method: method,
          responseType: responseType,
          contentType: body == null ? null : Headers.jsonContentType,
          headers: {if (_token != null) 'authorization': 'Bearer $_token'},
        ),
      );
    } on DioException catch (error) {
      final failure = _toApiException(error);
      if (authenticated && failure.isUnauthorized) onUnauthorized();
      throw failure;
    }
  }

  ApiException _toApiException(DioException error) {
    final response = error.response;
    if (response == null) {
      return ApiException(
        code: ApiException.network,
        message: "Can't reach Ai Review. Check your internet connection and try again.",
      );
    }

    final data = response.data;
    final envelope = data is Map ? data['error'] : null;
    final retryAfter = int.tryParse(response.headers.value('retry-after') ?? '');
    if (envelope is Map) {
      return ApiException(
        code: envelope['code']?.toString() ?? ApiException.unexpected,
        message: envelope['message']?.toString() ?? 'Something went wrong. Please try again.',
        status: response.statusCode,
        details: (envelope['details'] as Map?)?.cast<String, dynamic>() ?? const {},
        requestId: envelope['request_id']?.toString(),
        retryAfterSeconds: retryAfter,
      );
    }
    return ApiException(
      code: ApiException.unexpected,
      message: 'Something went wrong (HTTP ${response.statusCode}). Please try again.',
      status: response.statusCode,
      retryAfterSeconds: retryAfter,
    );
  }
}
