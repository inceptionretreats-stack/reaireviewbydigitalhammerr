/// An error from the Ai Review API, or from failing to reach it.
///
/// The server's envelope (apps/web/lib/api-error.ts) is
/// `{ "error": { "code", "message", "request_id", "details"? } }`. Its messages are written for
/// the owner, so screens show [message] as is.
class ApiException implements Exception {
  ApiException({
    required this.code,
    required this.message,
    this.status,
    this.details = const {},
    this.retryAfterSeconds,
    this.requestId,
  });

  /// Client-side codes for failures that never produced a server envelope.
  static const network = 'NETWORK';
  static const unexpected = 'UNEXPECTED';

  final String code;
  final String message;
  final int? status;
  final Map<String, dynamic> details;
  final int? retryAfterSeconds;
  final String? requestId;

  bool get isUnauthorized => code == 'AUTH_REQUIRED';

  /// Field names the server flagged in a VALIDATION_FAILED response (`details.fields`).
  List<String> get fields =>
      (details['fields'] as List?)?.map((field) => field.toString()).toList() ?? const [];

  @override
  String toString() => 'ApiException($code, $status): $message';
}
