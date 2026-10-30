import 'package:ai_review/features/welcome/welcome_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  testWidgets('the landing page leads to sign-up and sign-in', (tester) async {
    // A phone-sized screen. The hero's "Ai" animates forever, so pump fixed frames rather than
    // waiting for the tree to settle.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);

    final router = GoRouter(
      initialLocation: '/welcome',
      routes: [
        GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
        GoRoute(
          path: '/signup',
          builder: (_, _) => const Scaffold(body: Text('signup page')),
        ),
        GoRoute(
          path: '/login',
          builder: (_, _) => const Scaffold(body: Text('login page')),
        ),
      ],
    );
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pump();

    expect(find.text('Aap bas scan karo…'), findsOneWidget);
    expect(find.text('Review Likhna Ab Easy Hai — AI Hai Na.'), findsOneWidget);

    Future<void> tapAndNavigate(String label) async {
      await tester.ensureVisible(find.text(label).first);
      await tester.pump();
      await tester.tap(find.text(label).first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
    }

    await tapAndNavigate('Create your free QR');
    expect(find.text('signup page'), findsOneWidget);

    router.pop();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    await tapAndNavigate('I already have an account');
    expect(find.text('login page'), findsOneWidget);
  });
}
