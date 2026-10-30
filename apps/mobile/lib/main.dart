import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'core/theme.dart';

void main() {
  runApp(
    ProviderScope(
      // A failed request is shown with a "Try again" button; silent automatic retries would
      // repeat a rejected request (e.g. a revoked session) in the background.
      retry: (retryCount, error) => null,
      child: const AiReviewApp(),
    ),
  );
}

class AiReviewApp extends ConsumerWidget {
  const AiReviewApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Ai Review',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
