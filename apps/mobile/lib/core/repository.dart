import 'dart:typed_data';

import 'api/api_client.dart';
import 'models.dart';

/// One method per website endpoint the owner app uses. Request and response shapes follow
/// apps/web/app/api/v1 exactly; see the comments on [models.dart] for the casing quirks.
class Repository {
  Repository(this._api);

  final ApiClient _api;

  Map<String, dynamic> _json(dynamic body) =>
      body is Map ? body.cast<String, dynamic>() : <String, dynamic>{};

  // ---- Account -------------------------------------------------------------------------------

  Future<Account> account() async => Account.fromJson(_json(await _api.get('/account')));

  Future<void> updateAccount({
    required String fullName,
    required String email,
    required String mobile,
    String? currentPassword,
  }) => _api.patch('/account', {
    'full_name': fullName,
    'email': email,
    'mobile': mobile,
    'current_password': ?currentPassword,
  });

  /// Returns the response body: it carries the rotated session token for the app.
  Future<Map<String, dynamic>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async => _json(
    await _api.post('/account/password', {'current_password': currentPassword, 'new_password': newPassword}),
  );

  Future<int> signOutOtherDevices() async =>
      (_json(await _api.post('/account/sessions/revoke-others'))['other_sessions_signed_out'] as num?)
          ?.toInt() ??
      0;

  // ---- Business ------------------------------------------------------------------------------

  Future<Business> business() async => Business.fromJson(_json(await _api.get('/business')));

  /// PATCH /business is a full replace; every field is sent, including the current timezone,
  /// which the server would otherwise reset to Asia/Kolkata.
  Future<String> updateBusiness({
    required String name,
    required String category,
    required String description,
    required String city,
    required String state,
    required String slug,
    required String timezone,
  }) async {
    final body = _json(
      await _api.patch('/business', {
        'name': name,
        'category': category,
        if (description.trim().isNotEmpty) 'description': description.trim(),
        'city': city,
        'state': state,
        'slug': slug,
        'timezone': timezone,
      }),
    );
    return body['slug'] as String? ?? slug;
  }

  Future<SlugCheck> checkSlug(String slug) async =>
      SlugCheck.fromJson(_json(await _api.get('/business/slug-available', query: {'slug': slug})));

  Future<BillingDetails> billing() async =>
      BillingDetails.fromJson(_json(await _api.get('/business/billing')));

  Future<BillingDetails> saveBilling(BillingDetails details) async =>
      BillingDetails.fromJson(_json(await _api.put('/business/billing', details.toJson())));

  Future<List<BusinessLink>> links() async {
    final body = _json(await _api.get('/business/links'));
    final rows = (body['sections'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => BusinessLink.fromJson(row.cast<String, dynamic>()))
        .toList();
    return rows..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  }

  /// The onboarding "contact buttons" step. Resets the five default sections' order and
  /// visibility, exactly as the web onboarding does.
  Future<void> saveOnboardingLinks({
    required String whatsapp,
    required String call,
    required String instagram,
    required String facebook,
  }) => _api.put('/business/links', {
    'sections': [
      {'type': 'WHATSAPP', 'phone': whatsapp},
      {'type': 'CALL', 'phone': call},
      {'type': 'INSTAGRAM', 'url': instagram},
      {'type': 'FACEBOOK', 'url': facebook},
    ],
  });

  Future<void> updateLink(String id, Map<String, dynamic> patch) => _api.patch('/business/links/$id', patch);

  Future<void> reorderLinks(List<String> order) => _api.post('/business/links/reorder', {'order': order});

  Future<ReviewDestination> reviewDestination() async =>
      ReviewDestination.fromJson(_json(await _api.get('/business/review-destination')));

  Future<ReviewDestination> saveReviewDestination(String url) async {
    final body = _json(await _api.put('/business/review-destination', {'url': url}));
    return ReviewDestination(url: body['url'] as String?, enabled: true, kind: body['kind'] as String?);
  }

  Future<PublishResult> publish() async =>
      PublishResult.fromJson(_json(await _api.post('/business/publish')));

  // ---- AI ------------------------------------------------------------------------------------

  Future<AiContext> aiContext() async => AiContext.fromJson(_json(await _api.get('/ai/context')));

  /// PUT /ai/context is a full replace.
  Future<void> saveAiContext({
    required String summary,
    required List<String> services,
    required List<String> contextTerms,
    required String draftLanguage,
  }) => _api.put('/ai/context', {
    if (summary.trim().isNotEmpty) 'summary': summary.trim(),
    'services': services,
    'context_terms': contextTerms,
    'draft_language': draftLanguage,
  });

  Future<List<ReviewMode>> modes() async {
    final body = _json(await _api.get('/ai/modes'));
    return (body['modes'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => ReviewMode.fromJson(row.cast<String, dynamic>()))
        .toList();
  }

  Future<void> createMode({
    required String name,
    String? description,
    List<String> contextTerms = const [],
  }) => _api.post('/ai/modes', {'name': name, 'description': description, 'context_terms': contextTerms});

  Future<void> updateMode(String id, Map<String, dynamic> patch) => _api.patch('/ai/modes/$id', patch);

  Future<void> activateMode(String id) => _api.post('/ai/modes/$id/activate');

  /// Generates a sample customer review from the saved AI context. Can take up to a minute.
  Future<String> testPreview() async =>
      _json(await _api.post('/ai/test-preview'))['review_text'] as String? ?? '';

  // ---- QR codes ------------------------------------------------------------------------------

  Future<List<QrSource>> qrSources() async {
    final body = _json(await _api.get('/qr'));
    return (body['sources'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => QrSource.fromJson(row.cast<String, dynamic>()))
        .toList();
  }

  Future<QrSource> createQr({required String label, String? note}) async {
    final body = _json(
      await _api.post('/qr', {
        'source_label': label,
        if (note != null && note.trim().isNotEmpty) 'internal_note': note.trim(),
      }),
    );
    return QrSource.fromJson(_json(body['source']));
  }

  Future<QrSource> updateQr(String id, {String? label, String? note, bool? active}) async {
    final body = _json(
      await _api.patch('/qr/$id', {
        'source_label': ?label,
        // The server rejects null here; an empty string clears the note.
        'internal_note': ?note,
        if (active != null) 'status': active ? 'ACTIVE' : 'DISABLED',
      }),
    );
    return QrSource.fromJson(_json(body['source']));
  }

  /// The branded, printable QR card (900x1350), the same file the website downloads.
  Future<Uint8List> qrCard(String id, {String format = 'png'}) =>
      _api.getBytes('/qr/$id/download', query: {'format': format});

  // ---- Customers and review requests ---------------------------------------------------------

  Future<CustomerPage> customers({String query = '', int page = 1, int perPage = 25}) async =>
      CustomerPage.fromJson(
        _json(
          await _api.get(
            '/customers',
            query: {'q': query.isEmpty ? null : query, 'page': page, 'per_page': perPage},
          ),
        ),
      );

  Future<Customer> saveCustomer({
    String? id,
    required String name,
    required String mobile,
    String? email,
    String? visitDate,
    String? note,
    String? status,
  }) async {
    final payload = {
      'name': name.trim(),
      'mobile': mobile.trim(),
      if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
      if (visitDate != null && visitDate.isNotEmpty) 'visit_date': visitDate,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      // Status is only accepted on update, and only the owner-settable values.
      if (id != null && status != null) 'status': status,
    };
    final body = _json(
      id == null ? await _api.post('/customers', payload) : await _api.patch('/customers/$id', payload),
    );
    return Customer.fromJson(_json(body['customer']));
  }

  Future<void> deleteCustomer(String id) => _api.delete('/customers/$id');

  Future<List<ReviewRequest>> reviewRequests() async {
    final body = _json(await _api.get('/review-requests'));
    return (body['requests'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => ReviewRequest.fromJson(row.cast<String, dynamic>()))
        .toList();
  }

  Future<RequestPreview> previewRequest({required String customerId, String? templateText}) async =>
      RequestPreview.fromJson(
        _json(
          await _api.post('/review-requests/preview', {
            'customer_id': customerId,
            'template_text': ?templateText,
          }),
        ),
      );

  /// Mints a new tracked link every call; only call it when the owner is about to send.
  Future<ReviewRequest> prepareRequest({required String customerId, String? templateText}) async =>
      ReviewRequest.fromJson(
        _json(
          await _api.post('/review-requests', {'customer_id': customerId, 'template_text': ?templateText}),
        ),
      );

  Future<void> markRequestSent(String id) => _api.post('/review-requests/$id/mark-sent');

  // ---- Feedback ------------------------------------------------------------------------------

  Future<FeedbackPage> feedback({String status = 'inbox', String? cursor}) async => FeedbackPage.fromJson(
    _json(await _api.get('/feedback', query: {'status': status, 'limit': 25, 'cursor': cursor})),
  );

  Future<void> setFeedbackStatus(String id, String status) => _api.patch('/feedback/$id', {'status': status});

  // ---- Analytics -----------------------------------------------------------------------------

  Map<String, Object?> _range(String? from, String? to) => {'from': from, 'to': to};

  Future<AnalyticsOverview> analyticsOverview({String? from, String? to}) async =>
      AnalyticsOverview.fromJson(_json(await _api.get('/analytics/overview', query: _range(from, to))));

  Future<List<QrAnalyticsRow>> analyticsQr({String? from, String? to}) async {
    final body = _json(await _api.get('/analytics/qr', query: _range(from, to)));
    return (body['sources'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => QrAnalyticsRow.fromJson(row.cast<String, dynamic>()))
        .toList();
  }

  Future<List<LinkAnalyticsRow>> analyticsLinks({String? from, String? to}) async {
    final body = _json(await _api.get('/analytics/links', query: _range(from, to)));
    return (body['links'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => LinkAnalyticsRow.fromJson(row.cast<String, dynamic>()))
        .toList();
  }

  // ---- Subscription --------------------------------------------------------------------------

  Future<Subscription> subscription() async => Subscription.fromJson(_json(await _api.get('/subscription')));

  /// Creates a Razorpay order. Returns the options Razorpay Checkout needs.
  Future<Map<String, dynamic>> startCheckout() async => _json(await _api.post('/subscription/checkout'));

  Future<bool> verifyPayment({
    required String orderId,
    required String paymentId,
    required String signature,
  }) async {
    final body = _json(
      await _api.post('/subscription/verify', {
        'razorpay_order_id': orderId,
        'razorpay_payment_id': paymentId,
        'razorpay_signature': signature,
      }),
    );
    return body['activated'] as bool? ?? false;
  }
}
