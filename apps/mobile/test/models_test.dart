import 'package:ai_review/core/models.dart';
import 'package:ai_review/core/providers.dart';
import 'package:flutter_test/flutter_test.dart';

/// Shapes taken from the website's route handlers (apps/web/app/api/v1).
void main() {
  group('Business', () {
    test('reads the camelCase publishedAt the server leaks', () {
      final business = Business.fromJson({
        'name': 'Cafe Aroma',
        'category': 'Cafe or coffee shop',
        'description': null,
        'city': 'Pune',
        'state': 'Maharashtra',
        'timezone': 'Asia/Kolkata',
        'status': 'ACTIVE',
        'publishedAt': '2026-10-01T10:00:00.000Z',
        'slug': 'cafe-aroma',
      });

      expect(business.isActive, isTrue);
      expect(business.publishedAt, isNotNull);
      expect(business.hasDetails, isTrue);
    });

    test('treats the signup placeholder as a shell without details', () {
      final business = Business.fromJson({
        'name': 'Mobile Dev',
        'category': 'PENDING',
        'city': null,
        'status': 'DRAFT',
        'slug': null,
      });

      expect(business.isShell, isTrue);
      expect(business.isDraft, isTrue);
      expect(business.hasDetails, isFalse);
    });
  });

  test('BusinessLink reads sortOrder and the right target per type', () {
    final whatsapp = BusinessLink.fromJson({
      'id': 'a',
      'type': 'WHATSAPP',
      'label': 'WhatsApp',
      'url': null,
      'phone': '+919876543210',
      'enabled': true,
      'sortOrder': 2,
    });
    final instagram = BusinessLink.fromJson({
      'id': 'b',
      'type': 'INSTAGRAM',
      'label': 'Instagram',
      'url': 'https://instagram.com/x',
      'phone': null,
      'enabled': false,
      'sortOrder': 3,
    });

    expect(whatsapp.sortOrder, 2);
    expect(whatsapp.target, '+919876543210');
    expect(instagram.target, 'https://instagram.com/x');
    expect(LinkType.googleReview.takesUrl, isFalse);
    expect(LinkType.call.takesPhone, isTrue);
  });

  test('ReviewRequest reads both the list and the create response', () {
    final listed = ReviewRequest.fromJson({
      'id': 'r1',
      'customer': {'id': 'c1', 'name': 'Asha', 'mobile': '+919876543210'},
      'rendered_message': 'Hi Asha',
      'review_link': 'https://x/r/req/abc',
      'whatsapp_url': 'https://wa.me/919876543210?text=Hi',
      'prepared_at': '2026-10-01T10:00:00.000Z',
      'marked_sent_at': null,
      'first_clicked_at': '2026-10-02T10:00:00.000Z',
      'last_clicked_at': null,
    });
    final created = ReviewRequest.fromJson({
      'id': 'r2',
      'prepared_at': '2026-10-01T10:00:00.000Z',
      'marked_sent_at': null,
      'rendered_message': 'Hi Ravi',
      'review_link': 'https://x/r/req/def',
      'review_link_is_tracked': true,
      'whatsapp_url': null,
      'unknown_variables': [],
      'customer': {'id': 'c2', 'name': 'Ravi'},
    });

    expect(listed.customerName, 'Asha');
    expect(listed.firstClickedAt, isNotNull);
    expect(created.customerId, 'c2');
    expect(created.whatsappUrl, isNull);
  });

  test('AnalyticsOverview treats missing event keys as zero', () {
    final overview = AnalyticsOverview.fromJson({
      'range': {'from': '2026-10-01', 'to': '2026-10-30', 'days': 30},
      'totals': {'qr_scan': 12},
      'unique_visitor_sessions': 9,
      'funnel': {
        'is_empty': false,
        'reached_google_percent': 40.0,
        'steps': [
          {'event': 'qr_scan', 'label': 'QR code scanned', 'sessions': 10, 'share_of_entry': 100.0},
        ],
      },
      'trend': {
        'days': [
          {
            'date': '2026-10-30',
            'pending': false,
            'live': true,
            'counts': {'qr_scan': 3},
          },
        ],
      },
    });

    expect(overview.total('qr_scan'), 12);
    expect(overview.total('google_open'), 0);
    expect(overview.funnel.single.sessions, 10);
    expect(overview.trend.single.counts['qr_scan'], 3);
  });

  test('Subscription counts PAST_DUE as Pro, like the server does for usage', () {
    final subscription = Subscription.fromJson({
      'plan': {'status': 'PAST_DUE', 'expires_at': null},
      'usage': {'kind': 'PRO', 'used': 5, 'limit': 2000, 'remaining': 1995},
      'price_paise': 99900,
      'payments_configured': true,
      'renewal': {'offered': true, 'days_left': 3},
      'payments': [],
    });

    expect(subscription.isPro, isTrue);
    expect(subscription.daysLeft, 3);
    expect(subscription.remaining, 1995);
  });

  group('SetupProgress.resumeStep follows the website', () {
    Business business({String category = 'Restaurant', String? city = 'Pune', String status = 'DRAFT'}) =>
        Business.fromJson({'name': 'X', 'category': category, 'city': city, 'status': status, 'slug': 'x'});

    SetupProgress progress(Business b, {bool reviewLink = false}) =>
        SetupProgress(business: b, hasReviewLink: reviewLink, hasContactLinks: false, hasAiContext: false);

    test('details first, then the review link, then finish', () {
      expect(progress(business(category: 'PENDING')).resumeStep, 0);
      expect(progress(business()).resumeStep, 1);
      expect(progress(business(), reviewLink: true).resumeStep, 4);
      expect(progress(business(), reviewLink: true).readyToPublish, isTrue);
    });

    test('a published business resumes at finish', () {
      expect(progress(business(status: 'ACTIVE', category: 'PENDING')).resumeStep, 4);
    });
  });
}
