// Typed views of the website's /api/v1 responses.
//
// Field names follow the wire exactly, including the few camelCase keys the server leaks
// (`publishedAt`, `sortOrder`, `autoDisabled`, `isActive`). When the web changes a response shape,
// this file is the one place the app needs to follow it.

DateTime? _date(Object? value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

int _int(Object? value) => value is num ? value.toInt() : 0;

double? _double(Object? value) => value is num ? value.toDouble() : null;

List<String> _strings(Object? value) =>
    value is List ? value.map((item) => item.toString()).toList() : const [];

Map<String, dynamic> _map(Object? value) => value is Map ? value.cast<String, dynamic>() : const {};

List<Map<String, dynamic>> _maps(Object? value) =>
    value is List ? value.whereType<Map>().map((item) => item.cast<String, dynamic>()).toList() : const [];

// ---------------------------------------------------------------------------------------------
// Account

class Account {
  Account({
    required this.fullName,
    required this.email,
    required this.mobile,
    required this.hasPassword,
    required this.otherLiveSessions,
  });

  factory Account.fromJson(Map<String, dynamic> json) => Account(
    fullName: json['full_name'] as String? ?? '',
    email: json['email'] as String? ?? '',
    mobile: json['mobile'] as String? ?? '',
    hasPassword: json['has_password'] as bool? ?? false,
    otherLiveSessions: _int(json['other_live_sessions']),
  );

  final String fullName;
  final String email;
  final String mobile;
  final bool hasPassword;
  final int otherLiveSessions;
}

// ---------------------------------------------------------------------------------------------
// Business

enum BusinessStatus { draft, active, suspended, closed }

BusinessStatus _businessStatus(Object? value) => switch (value) {
  'ACTIVE' => BusinessStatus.active,
  'SUSPENDED' => BusinessStatus.suspended,
  'CLOSED' => BusinessStatus.closed,
  _ => BusinessStatus.draft,
};

class Business {
  Business({
    required this.name,
    required this.category,
    required this.description,
    required this.city,
    required this.state,
    required this.timezone,
    required this.status,
    required this.publishedAt,
    required this.slug,
  });

  factory Business.fromJson(Map<String, dynamic> json) => Business(
    name: json['name'] as String? ?? '',
    category: json['category'] as String? ?? '',
    description: json['description'] as String?,
    city: json['city'] as String?,
    state: json['state'] as String?,
    timezone: json['timezone'] as String? ?? 'Asia/Kolkata',
    status: _businessStatus(json['status']),
    publishedAt: _date(json['publishedAt']),
    slug: json['slug'] as String?,
  );

  /// The category signup gives the placeholder business (`SHELL_CATEGORY`).
  static const shellCategory = 'PENDING';

  final String name;
  final String category;
  final String? description;
  final String? city;
  final String? state;
  final String timezone;
  final BusinessStatus status;
  final DateTime? publishedAt;
  final String? slug;

  bool get isShell => category == shellCategory || name.trim().isEmpty;
  bool get isActive => status == BusinessStatus.active;
  bool get isDraft => status == BusinessStatus.draft;
  bool get isFrozen => status == BusinessStatus.suspended || status == BusinessStatus.closed;

  /// The web's `hasBusinessDetails` onboarding flag (apps/web/lib/onboarding-progress.ts).
  bool get hasDetails => !isShell && (city ?? '').trim().isNotEmpty && slug != null;
}

class SlugCheck {
  SlugCheck({required this.slug, required this.available, this.reason, this.suggestions = const []});

  factory SlugCheck.fromJson(Map<String, dynamic> json) => SlugCheck(
    slug: json['slug'] as String? ?? '',
    available: json['available'] as bool? ?? false,
    reason: json['reason'] as String?,
    suggestions: _strings(json['suggestions']),
  );

  final String slug;
  final bool available;
  final String? reason;
  final List<String> suggestions;

  String get message => switch (reason) {
    null => available ? 'Available' : 'Not available',
    'TAKEN' => 'Already taken.',
    'TOO_SHORT' => 'Use at least 3 characters.',
    'TOO_LONG' => 'Use 48 characters or fewer.',
    'INVALID_CHARACTERS' => 'Use only lowercase letters, numbers and hyphens.',
    'LEADING_OR_TRAILING_HYPHEN' => "Can't start or end with a hyphen.",
    'CONSECUTIVE_HYPHENS' => "Can't contain two hyphens in a row.",
    'RESERVED' => 'That address is reserved.',
    'NUMERIC_ONLY' => "Can't be numbers only.",
    _ => 'Not available.',
  };
}

class BillingDetails {
  BillingDetails({
    required this.legalName,
    required this.gstin,
    required this.stateCode,
    required this.address,
  });

  factory BillingDetails.fromJson(Map<String, dynamic> json) => BillingDetails(
    legalName: json['billing_legal_name'] as String? ?? '',
    gstin: json['gstin'] as String? ?? '',
    stateCode: json['billing_state_code'] as String? ?? '',
    address: json['billing_address'] as String? ?? '',
  );

  final String legalName;
  final String gstin;
  final String stateCode;
  final String address;

  Map<String, dynamic> toJson() => {
    'billing_legal_name': legalName,
    'gstin': gstin,
    'billing_state_code': stateCode,
    'billing_address': address,
  };
}

enum LinkType { googleReview, whatsapp, call, instagram, facebook, website, directions, custom }

const _linkTypeWire = {
  'GOOGLE_REVIEW': LinkType.googleReview,
  'WHATSAPP': LinkType.whatsapp,
  'CALL': LinkType.call,
  'INSTAGRAM': LinkType.instagram,
  'FACEBOOK': LinkType.facebook,
  'WEBSITE': LinkType.website,
  'DIRECTIONS': LinkType.directions,
  'CUSTOM': LinkType.custom,
};

extension LinkTypeTarget on LinkType {
  /// WhatsApp and Call take a phone number; Google Review has no target of its own; the rest
  /// take an https URL.
  bool get takesPhone => this == LinkType.whatsapp || this == LinkType.call;
  bool get takesUrl => !takesPhone && this != LinkType.googleReview;
}

class BusinessLink {
  BusinessLink({
    required this.id,
    required this.type,
    required this.label,
    required this.url,
    required this.phone,
    required this.enabled,
    required this.sortOrder,
  });

  factory BusinessLink.fromJson(Map<String, dynamic> json) => BusinessLink(
    id: json['id'] as String,
    type: _linkTypeWire[json['type']] ?? LinkType.custom,
    label: json['label'] as String? ?? '',
    url: json['url'] as String?,
    phone: json['phone'] as String?,
    enabled: json['enabled'] as bool? ?? false,
    sortOrder: _int(json['sortOrder']),
  );

  final String id;
  final LinkType type;
  final String label;
  final String? url;
  final String? phone;
  final bool enabled;
  final int sortOrder;

  String? get target => type.takesPhone ? phone : url;
}

class ReviewDestination {
  ReviewDestination({required this.url, required this.enabled, required this.kind});

  factory ReviewDestination.fromJson(Map<String, dynamic> json) => ReviewDestination(
    url: json['url'] as String?,
    enabled: json['enabled'] as bool? ?? json['url'] != null,
    kind: json['kind'] as String?,
  );

  final String? url;
  final bool enabled;

  /// `composer` opens Google's write-a-review box; `listing` opens the business page.
  final String? kind;
}

class PublishResult {
  PublishResult({required this.slug, required this.publicUrl, required this.qrCode, required this.qrUrl});

  factory PublishResult.fromJson(Map<String, dynamic> json) => PublishResult(
    slug: json['slug'] as String? ?? '',
    publicUrl: json['public_url'] as String? ?? '',
    qrCode: json['qr_code'] as String? ?? '',
    qrUrl: json['qr_url'] as String? ?? '',
  );

  final String slug;
  final String publicUrl;
  final String qrCode;
  final String qrUrl;
}

// ---------------------------------------------------------------------------------------------
// AI

class AiContext {
  AiContext({
    required this.summary,
    required this.services,
    required this.contextTerms,
    required this.draftLanguage,
    required this.hasModes,
  });

  factory AiContext.fromJson(Map<String, dynamic> json) => AiContext(
    summary: json['summary'] as String?,
    services: _strings(json['services']),
    contextTerms: _strings(json['context_terms']),
    draftLanguage: json['draft_language'] as String? ?? 'hinglish',
    hasModes: (json['modes'] as List?)?.isNotEmpty ?? false,
  );

  final String? summary;
  final List<String> services;
  final List<String> contextTerms;

  /// `en` or `hinglish`.
  final String draftLanguage;

  /// The first save creates the "Balanced" mode, so this is the web's proxy for "AI context set".
  final bool hasModes;
}

class ReviewMode {
  ReviewMode({
    required this.id,
    required this.name,
    required this.description,
    required this.contextTerms,
    required this.isActive,
    required this.isArchived,
  });

  factory ReviewMode.fromJson(Map<String, dynamic> json) => ReviewMode(
    id: json['id'] as String,
    name: json['name'] as String? ?? '',
    description: json['description'] as String?,
    contextTerms: _strings(json['context_terms']),
    isActive: json['is_active'] as bool? ?? false,
    isArchived: json['is_archived'] as bool? ?? false,
  );

  final String id;
  final String name;
  final String? description;
  final List<String> contextTerms;
  final bool isActive;
  final bool isArchived;
}

// ---------------------------------------------------------------------------------------------
// QR codes

class QrSource {
  QrSource({
    required this.id,
    required this.code,
    required this.label,
    required this.note,
    required this.active,
    required this.createdAt,
    required this.resolveUrl,
  });

  factory QrSource.fromJson(Map<String, dynamic> json) => QrSource(
    id: json['id'] as String,
    code: json['code'] as String? ?? '',
    label: json['source_label'] as String? ?? '',
    note: json['internal_note'] as String?,
    active: json['status'] == 'ACTIVE',
    createdAt: _date(json['created_at']),
    resolveUrl: json['resolve_url'] as String? ?? '',
  );

  final String id;
  final String code;
  final String label;
  final String? note;
  final bool active;
  final DateTime? createdAt;

  /// `{site}/r/{CODE}`: what the printed QR encodes.
  final String resolveUrl;
}

// ---------------------------------------------------------------------------------------------
// Customers and review requests

const customerStatusLabels = {
  'NOT_CONTACTED': 'Not contacted',
  'MESSAGE_PREPARED': 'Message prepared',
  'MESSAGE_SENT_MANUAL': 'Message sent',
  'LINK_CLICKED': 'Link opened',
  'AI_GENERATED': 'Draft created',
  'REVIEW_COPIED': 'Review copied',
  'GOOGLE_OPENED': 'Opened Google',
  'PRIVATE_FEEDBACK': 'Sent feedback',
};

class Customer {
  Customer({
    required this.id,
    required this.name,
    required this.mobile,
    required this.email,
    required this.visitDate,
    required this.note,
    required this.status,
    required this.createdAt,
  });

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
    id: json['id'] as String,
    name: json['name'] as String? ?? '',
    mobile: json['mobile'] as String? ?? '',
    email: json['email'] as String?,
    visitDate: json['visit_date'] as String?,
    note: json['note'] as String?,
    status: json['status'] as String? ?? 'NOT_CONTACTED',
    createdAt: _date(json['created_at']),
  );

  final String id;
  final String name;
  final String mobile;
  final String? email;

  /// `YYYY-MM-DD`.
  final String? visitDate;
  final String? note;
  final String status;
  final DateTime? createdAt;

  String get statusLabel => customerStatusLabels[status] ?? status;

  /// Only these two can be set by the owner; the rest are observed from the customer's journey.
  static const ownerSettable = {'NOT_CONTACTED', 'MESSAGE_SENT_MANUAL'};
}

class CustomerPage {
  CustomerPage({required this.customers, required this.page, required this.totalPages, required this.total});

  factory CustomerPage.fromJson(Map<String, dynamic> json) => CustomerPage(
    customers: _maps(json['customers']).map(Customer.fromJson).toList(),
    page: _int(json['page']),
    totalPages: _int(json['total_pages']),
    total: _int(json['total']),
  );

  final List<Customer> customers;
  final int page;
  final int totalPages;
  final int total;
}

class ReviewRequest {
  ReviewRequest({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.renderedMessage,
    required this.reviewLink,
    required this.whatsappUrl,
    required this.preparedAt,
    required this.markedSentAt,
    required this.firstClickedAt,
  });

  /// Both the list (GET) and create (POST) shapes.
  factory ReviewRequest.fromJson(Map<String, dynamic> json) {
    final customer = _map(json['customer']);
    return ReviewRequest(
      id: json['id'] as String,
      customerId: customer['id'] as String? ?? '',
      customerName: customer['name'] as String? ?? '',
      renderedMessage: json['rendered_message'] as String? ?? '',
      reviewLink: json['review_link'] as String?,
      whatsappUrl: json['whatsapp_url'] as String?,
      preparedAt: _date(json['prepared_at']),
      markedSentAt: _date(json['marked_sent_at']),
      firstClickedAt: _date(json['first_clicked_at']),
    );
  }

  final String id;
  final String customerId;
  final String customerName;
  final String renderedMessage;
  final String? reviewLink;
  final String? whatsappUrl;
  final DateTime? preparedAt;
  final DateTime? markedSentAt;
  final DateTime? firstClickedAt;
}

class RequestPreview {
  RequestPreview({
    required this.renderedMessage,
    required this.templateText,
    required this.unknownVariables,
    required this.preparedLength,
    required this.lengthLimit,
  });

  factory RequestPreview.fromJson(Map<String, dynamic> json) => RequestPreview(
    renderedMessage: json['rendered_message'] as String? ?? '',
    templateText: json['template_text'] as String? ?? '',
    unknownVariables: _strings(json['unknown_variables']),
    preparedLength: _int(json['prepared_length']),
    lengthLimit: _int(json['length_limit']),
  );

  final String renderedMessage;
  final String templateText;
  final List<String> unknownVariables;
  final int preparedLength;
  final int lengthLimit;
}

// ---------------------------------------------------------------------------------------------
// Feedback

class FeedbackItem {
  FeedbackItem({
    required this.id,
    required this.message,
    required this.name,
    required this.mobile,
    required this.status,
    required this.createdAt,
  });

  factory FeedbackItem.fromJson(Map<String, dynamic> json) => FeedbackItem(
    id: json['id'] as String,
    message: json['message'] as String? ?? '',
    name: json['name'] as String?,
    mobile: json['mobile'] as String?,
    status: json['status'] as String? ?? 'NEW',
    createdAt: _date(json['created_at']),
  );

  final String id;
  final String message;
  final String? name;
  final String? mobile;

  /// NEW, READ or ARCHIVED.
  final String status;
  final DateTime? createdAt;

  FeedbackItem withStatus(String next) =>
      FeedbackItem(id: id, message: message, name: name, mobile: mobile, status: next, createdAt: createdAt);
}

class FeedbackPage {
  FeedbackPage({required this.items, required this.nextCursor, required this.counts});

  factory FeedbackPage.fromJson(Map<String, dynamic> json) {
    final counts = _map(json['counts']);
    return FeedbackPage(
      items: _maps(json['feedback']).map(FeedbackItem.fromJson).toList(),
      nextCursor: json['next_cursor'] as String?,
      counts: {
        for (final key in ['new', 'read', 'archived', 'total']) key: _int(counts[key]),
      },
    );
  }

  final List<FeedbackItem> items;
  final String? nextCursor;
  final Map<String, int> counts;
}

// ---------------------------------------------------------------------------------------------
// Analytics

class AnalyticsRange {
  AnalyticsRange({required this.from, required this.to, required this.days});

  factory AnalyticsRange.fromJson(Map<String, dynamic> json) => AnalyticsRange(
    from: json['from'] as String? ?? '',
    to: json['to'] as String? ?? '',
    days: _int(json['days']),
  );

  final String from;
  final String to;
  final int days;
}

class FunnelStep {
  FunnelStep({required this.event, required this.label, required this.sessions, required this.shareOfEntry});

  factory FunnelStep.fromJson(Map<String, dynamic> json) => FunnelStep(
    event: json['event'] as String? ?? '',
    label: json['label'] as String? ?? '',
    sessions: _int(json['sessions']),
    shareOfEntry: _double(json['share_of_entry']),
  );

  final String event;
  final String label;
  final int sessions;
  final double? shareOfEntry;
}

class TrendDay {
  TrendDay({required this.date, required this.pending, required this.counts});

  factory TrendDay.fromJson(Map<String, dynamic> json) => TrendDay(
    date: json['date'] as String? ?? '',
    pending: json['pending'] as bool? ?? false,
    counts: _map(json['counts']).map((key, value) => MapEntry(key, _int(value))),
  );

  final String date;
  final bool pending;
  final Map<String, int> counts;
}

class AnalyticsOverview {
  AnalyticsOverview({
    required this.range,
    required this.totals,
    required this.uniqueVisitors,
    required this.funnel,
    required this.reachedGooglePercent,
    required this.funnelEmpty,
    required this.trend,
  });

  factory AnalyticsOverview.fromJson(Map<String, dynamic> json) {
    final funnel = _map(json['funnel']);
    return AnalyticsOverview(
      range: AnalyticsRange.fromJson(_map(json['range'])),
      totals: _map(json['totals']).map((key, value) => MapEntry(key, _int(value))),
      uniqueVisitors: _int(json['unique_visitor_sessions']),
      funnel: _maps(funnel['steps']).map(FunnelStep.fromJson).toList(),
      reachedGooglePercent: _double(funnel['reached_google_percent']),
      funnelEmpty: funnel['is_empty'] as bool? ?? true,
      trend: _maps(_map(json['trend'])['days']).map(TrendDay.fromJson).toList(),
    );
  }

  final AnalyticsRange range;

  /// Missing keys mean zero.
  final Map<String, int> totals;
  final int uniqueVisitors;
  final List<FunnelStep> funnel;
  final double? reachedGooglePercent;
  final bool funnelEmpty;
  final List<TrendDay> trend;

  int total(String event) => totals[event] ?? 0;
}

class QrAnalyticsRow {
  QrAnalyticsRow({required this.label, required this.scans, required this.drafts, required this.googleOpens});

  factory QrAnalyticsRow.fromJson(Map<String, dynamic> json) => QrAnalyticsRow(
    label: json['label'] as String? ?? '',
    scans: _int(json['scans']),
    drafts: _int(json['drafts_created']),
    googleOpens: _int(json['google_pages_opened']),
  );

  final String label;
  final int scans;
  final int drafts;
  final int googleOpens;
}

class LinkAnalyticsRow {
  LinkAnalyticsRow({required this.label, required this.clicks});

  factory LinkAnalyticsRow.fromJson(Map<String, dynamic> json) =>
      LinkAnalyticsRow(label: json['label'] as String? ?? '', clicks: _int(json['clicks']));

  final String label;
  final int clicks;
}

// ---------------------------------------------------------------------------------------------
// Subscription

class Payment {
  Payment({
    required this.id,
    required this.status,
    required this.amountPaise,
    required this.paidAt,
    required this.createdAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    id: json['id'] as String,
    status: json['status'] as String? ?? '',
    amountPaise: _int(json['amount_paise']),
    paidAt: _date(json['paid_at']),
    createdAt: _date(json['created_at']),
  );

  final String id;
  final String status;
  final int amountPaise;
  final DateTime? paidAt;
  final DateTime? createdAt;
}

class Subscription {
  Subscription({
    required this.status,
    required this.expiresAt,
    required this.usageKind,
    required this.used,
    required this.limit,
    required this.remaining,
    required this.pricePaise,
    required this.paymentsConfigured,
    required this.renewalOffered,
    required this.daysLeft,
    required this.payments,
  });

  factory Subscription.fromJson(Map<String, dynamic> json) {
    final plan = _map(json['plan']);
    final usage = _map(json['usage']);
    final renewal = _map(json['renewal']);
    return Subscription(
      status: plan['status'] as String? ?? 'FREE',
      expiresAt: _date(plan['expires_at']),
      usageKind: usage['kind'] as String? ?? 'FREE',
      used: _int(usage['used']),
      limit: _int(usage['limit']),
      remaining: _int(usage['remaining']),
      pricePaise: _int(json['price_paise']),
      paymentsConfigured: json['payments_configured'] as bool? ?? false,
      renewalOffered: renewal['offered'] as bool? ?? false,
      daysLeft: renewal['days_left'] is num ? _int(renewal['days_left']) : null,
      payments: _maps(json['payments']).map(Payment.fromJson).toList(),
    );
  }

  /// FREE, CHECKOUT_PENDING, PRO_ACTIVE, PAST_DUE, EXPIRED or CANCELLED.
  final String status;
  final DateTime? expiresAt;
  final String usageKind;
  final int used;
  final int limit;
  final int remaining;
  final int pricePaise;
  final bool paymentsConfigured;
  final bool renewalOffered;
  final int? daysLeft;
  final List<Payment> payments;

  bool get isPro => status == 'PRO_ACTIVE' || status == 'PAST_DUE';
}
