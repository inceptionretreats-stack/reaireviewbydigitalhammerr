import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = ref.watch(accountProvider).value;
    final business = ref.watch(businessProvider).value;

    Widget group(String title, List<Widget> tiles) => Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Brand.inkFaint,
                letterSpacing: 0.8,
              ),
            ),
          ),
          Card(
            child: Column(
              children: [
                for (final (index, tile) in tiles.indexed) ...[
                  if (index > 0) const Divider(indent: 56),
                  tile,
                ],
              ],
            ),
          ),
        ],
      ),
    );

    ListTile tile(IconData icon, String title, String route, {String? subtitle}) => ListTile(
      leading: Icon(icon, color: Brand.accent),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle == null ? null : Text(subtitle),
      trailing: const Icon(Icons.chevron_right, color: Brand.inkFaint),
      onTap: () => context.push(route),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(14),
              leading: CircleAvatar(
                radius: 24,
                backgroundColor: Brand.accentSoft,
                foregroundColor: Brand.accent,
                child: Text(
                  (account?.fullName.isNotEmpty ?? false) ? account!.fullName[0].toUpperCase() : '?',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20),
                ),
              ),
              title: Text(account?.fullName ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(account?.email ?? ''),
              trailing: const Icon(Icons.chevron_right, color: Brand.inkFaint),
              onTap: () => context.push('/account'),
            ),
          ),
          const SizedBox(height: 18),
          group('Your business', [
            tile(
              Icons.storefront_outlined,
              'Business profile',
              '/business',
              subtitle: business == null || business.isShell ? null : business.name,
            ),
            tile(Icons.star_outline, 'Google review link', '/review-link'),
            tile(Icons.touch_app_outlined, 'Buttons on your page', '/links'),
            if (business?.isDraft ?? false) tile(Icons.rocket_launch_outlined, 'Finish setup', '/onboarding'),
          ]),
          group('Ai reviews', [
            tile(Icons.auto_awesome_outlined, 'Ai review settings', '/ai'),
            tile(Icons.tune, 'Review modes', '/modes'),
          ]),
          group('Insights', [tile(Icons.insights_outlined, 'Analytics', '/analytics')]),
          group('Plan and billing', [
            tile(Icons.workspace_premium_outlined, 'Subscription', '/subscription'),
            tile(Icons.receipt_long_outlined, 'Billing details (GST)', '/billing'),
          ]),
          group('Website', [
            ListTile(
              leading: const Icon(Icons.language, color: Brand.accent),
              title: const Text('Open the website dashboard', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Everything here is also on the web, kept in sync.'),
              trailing: const Icon(Icons.open_in_new, color: Brand.inkFaint),
              onTap: () => openExternal(context, AppConfig.webPage('/app').toString()),
            ),
            if (business?.slug != null && (business?.isActive ?? false))
              ListTile(
                leading: const Icon(Icons.public, color: Brand.accent),
                title: const Text('View your public page', style: TextStyle(fontWeight: FontWeight.w600)),
                trailing: const Icon(Icons.open_in_new, color: Brand.inkFaint),
                onTap: () => openExternal(context, PublicLinks(business!.slug!).profile),
              ),
            ListTile(
              leading: const Icon(Icons.help_outline, color: Brand.accent),
              title: const Text('Help and contact', style: TextStyle(fontWeight: FontWeight.w600)),
              trailing: const Icon(Icons.open_in_new, color: Brand.inkFaint),
              onTap: () => openExternal(context, AppConfig.webPage('/legal/contact').toString()),
            ),
          ]),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
            onPressed: () async {
              final ok = await confirm(
                context,
                title: 'Sign out?',
                message: 'You can sign back in any time with your email and password.',
                confirmLabel: 'Sign out',
              );
              if (ok) await ref.read(authControllerProvider.notifier).signOut();
            },
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
          const SizedBox(height: 16),
          Text(
            'Ai Review by Digital Hammerr · ${Uri.parse(AppConfig.webBaseUrl).authority}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Brand.inkFaint, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
