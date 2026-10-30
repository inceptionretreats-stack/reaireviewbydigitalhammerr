import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_controller.dart';
import '../features/account/account_screen.dart';
import '../features/account/subscription_screen.dart';
import '../features/ai/ai_settings_screen.dart';
import '../features/ai/review_modes_screen.dart';
import '../features/analytics/analytics_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/signup_screen.dart';
import '../features/business/billing_screen.dart';
import '../features/business/business_profile_screen.dart';
import '../features/business/links_screen.dart';
import '../features/customers/customers_screen.dart';
import '../features/customers/compose_request_screen.dart';
import '../features/feedback/feedback_screen.dart';
import '../features/home/home_screen.dart';
import '../features/more/more_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/qr/qr_detail_screen.dart';
import '../features/qr/qr_screen.dart';
import '../features/welcome/promo_video.dart';
import '../features/welcome/welcome_screen.dart';
import 'shell.dart';

/// The only places a signed-out visitor can be: the landing page and the two auth forms.
const _authPaths = {'/welcome', '/login', '/signup'};

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/home',
    refreshListenable: refresh,
    observers: [routeObserver],
    redirect: (context, state) {
      // A website dashboard link opened in the app (App Links) arrives as its web path.
      final fromWeb = screenForWebPath(state.uri.path);
      if (fromWeb != null) return fromWeb;

      final auth = ref.read(authControllerProvider);
      final path = state.matchedLocation;
      return switch (auth) {
        AuthLoading() => path == '/splash' ? null : '/splash',
        // A first visit lands on the welcome page; a revoked session goes straight to sign-in,
        // which explains why.
        SignedOut(:final reason) =>
          _authPaths.contains(path) ? null : (reason == null ? '/welcome' : '/login'),
        SignedIn(:final isNewAccount) =>
          _authPaths.contains(path) || path == '/splash' ? (isNewAccount ? '/onboarding' : '/home') : null,
      };
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const _Splash()),
      GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, _) => const SignupScreen()),
      GoRoute(
        path: '/onboarding',
        builder: (_, state) =>
            OnboardingScreen(initialStep: int.tryParse(state.uri.queryParameters['step'] ?? '')),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/home', builder: (_, _) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/qr',
                builder: (_, _) => const QrScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) => QrDetailScreen(id: state.pathParameters['id']!),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/customers', builder: (_, _) => const CustomersScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/feedback', builder: (_, _) => const FeedbackScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())],
          ),
        ],
      ),
      // Full-screen pages pushed above the tabs.
      GoRoute(path: '/analytics', builder: (_, _) => const AnalyticsScreen()),
      GoRoute(
        path: '/request/:customerId',
        builder: (_, state) => ComposeRequestScreen(customerId: state.pathParameters['customerId']!),
      ),
      GoRoute(path: '/business', builder: (_, _) => const BusinessProfileScreen()),
      GoRoute(path: '/review-link', builder: (_, _) => const ReviewLinkScreen()),
      GoRoute(path: '/links', builder: (_, _) => const LinksScreen()),
      GoRoute(path: '/billing', builder: (_, _) => const BillingScreen()),
      GoRoute(path: '/ai', builder: (_, _) => const AiSettingsScreen()),
      GoRoute(path: '/modes', builder: (_, _) => const ReviewModesScreen()),
      GoRoute(path: '/account', builder: (_, _) => const AccountScreen()),
      GoRoute(path: '/subscription', builder: (_, _) => const SubscriptionScreen()),
    ],
  );
});

/// The app screen for a website dashboard path (apps/web/app/(app)/app/**), or null when the path
/// is not a dashboard link. Unknown dashboard pages land on Home.
String? screenForWebPath(String path) {
  if (path != '/app' && !path.startsWith('/app/')) return null;
  final section = path.split('/').elementAtOrNull(2) ?? '';
  return switch (section) {
    'qr' => '/qr',
    'customers' || 'review-requests' => '/customers',
    'feedback' => '/feedback',
    'analytics' => '/analytics',
    'subscription' => '/subscription',
    'settings' => '/account',
    'profile' => '/business',
    'ai-review' => '/ai',
    'review-modes' => '/modes',
    _ => '/home',
  };
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}
