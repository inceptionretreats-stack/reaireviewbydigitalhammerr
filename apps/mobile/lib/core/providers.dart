import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_controller.dart';
import 'config.dart';
import 'format.dart';
import 'models.dart';
import 'repository.dart';

final repositoryProvider = Provider<Repository>((ref) => Repository(ref.watch(apiClientProvider)));

// Every data provider is keyed off the signed-in state, so signing out (or into another account)
// throws away the previous owner's data instead of showing it for a frame.
Repository _repo(Ref ref) {
  ref.watch(authControllerProvider.select((state) => state is SignedIn));
  return ref.watch(repositoryProvider);
}

final accountProvider = FutureProvider<Account>((ref) => _repo(ref).account());

final businessProvider = FutureProvider<Business>((ref) => _repo(ref).business());

final reviewDestinationProvider = FutureProvider<ReviewDestination>((ref) => _repo(ref).reviewDestination());

final linksProvider = FutureProvider<List<BusinessLink>>((ref) => _repo(ref).links());

final billingProvider = FutureProvider<BillingDetails>((ref) => _repo(ref).billing());

final aiContextProvider = FutureProvider<AiContext>((ref) => _repo(ref).aiContext());

final modesProvider = FutureProvider<List<ReviewMode>>((ref) => _repo(ref).modes());

final qrSourcesProvider = FutureProvider<List<QrSource>>((ref) => _repo(ref).qrSources());

final subscriptionProvider = FutureProvider<Subscription>((ref) => _repo(ref).subscription());

final reviewRequestsProvider = FutureProvider<List<ReviewRequest>>((ref) => _repo(ref).reviewRequests());

/// The inbox counts for the badge on the Feedback tab and the home screen.
final feedbackCountsProvider = FutureProvider<Map<String, int>>(
  (ref) async => (await _repo(ref).feedback()).counts,
);

/// Analytics for the last [days] days, ending today in the business's timezone.
final analyticsProvider = FutureProvider.family<AnalyticsOverview, int>((ref, days) {
  final to = DateTime.now();
  return _repo(ref).analyticsOverview(
    from: isoDate(to.subtract(Duration(days: days - 1))),
    to: isoDate(to),
  );
});

/// The web's onboarding progress flags (apps/web/lib/onboarding-progress.ts), derived from the
/// API exactly as the website derives them from the database.
class SetupProgress {
  SetupProgress({
    required this.business,
    required this.hasReviewLink,
    required this.hasContactLinks,
    required this.hasAiContext,
  });

  final Business business;
  final bool hasReviewLink;
  final bool hasContactLinks;
  final bool hasAiContext;

  bool get hasDetails => business.hasDetails;
  bool get published => !business.isDraft;
  bool get readyToPublish => hasDetails && hasReviewLink;

  /// The web's `resumeStep`: the first required step not yet done.
  int get resumeStep {
    if (published) return 4;
    if (!hasDetails) return 0;
    if (!hasReviewLink) return 1;
    return 4;
  }

  int get doneCount =>
      [hasDetails, hasReviewLink, hasContactLinks, hasAiContext, published].where((done) => done).length;
}

final setupProgressProvider = FutureProvider<SetupProgress>((ref) async {
  final business = await ref.watch(businessProvider.future);
  final results = await Future.wait([
    ref.watch(reviewDestinationProvider.future),
    ref.watch(linksProvider.future),
    ref.watch(aiContextProvider.future),
  ]);
  final destination = results[0] as ReviewDestination;
  final links = results[1] as List<BusinessLink>;
  final ai = results[2] as AiContext;
  return SetupProgress(
    business: business,
    hasReviewLink: destination.url != null,
    hasContactLinks: links.any(
      (link) => link.type != LinkType.googleReview && (link.url != null || link.phone != null),
    ),
    hasAiContext: ai.hasModes,
  );
});

/// The public URLs of the business, built the way the server builds them.
class PublicLinks {
  PublicLinks(this.slug);

  final String slug;

  String get profile => '${AppConfig.webBaseUrl}/$slug';
  String get review => '${AppConfig.webBaseUrl}/$slug/review';
}

/// Everything that changes when the business configuration changes; call after a save so the
/// home screen, setup card and lists all reflect it.
void refreshBusiness(WidgetRef ref) {
  ref.invalidate(businessProvider);
  ref.invalidate(reviewDestinationProvider);
  ref.invalidate(linksProvider);
  ref.invalidate(aiContextProvider);
  ref.invalidate(modesProvider);
  ref.invalidate(qrSourcesProvider);
}
