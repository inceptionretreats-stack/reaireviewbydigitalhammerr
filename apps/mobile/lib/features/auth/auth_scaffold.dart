import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The shared frame of the sign-in and sign-up screens, matching the website's auth pages.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({super.key, required this.title, required this.subtitle, required this.child});

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.bg,
      body: Column(
        children: [
          SizedBox(height: MediaQuery.paddingOf(context).top),
          const BrandBar(),
          Expanded(
            child: SafeArea(
              top: false,
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 440),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            IconButton(
                              tooltip: 'Back',
                              icon: const Icon(Icons.arrow_back),
                              // Opened from the welcome page; after a revoked session there is
                              // nothing underneath, so fall back to it.
                              onPressed: () => context.canPop() ? context.pop() : context.go('/welcome'),
                            ),
                            const SizedBox(width: 4),
                            const BrandLockup(large: true),
                          ],
                        ),
                        const SizedBox(height: 28),
                        Text(title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        Text(subtitle, style: const TextStyle(color: Brand.inkMuted, fontSize: 15)),
                        const SizedBox(height: 28),
                        child,
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
