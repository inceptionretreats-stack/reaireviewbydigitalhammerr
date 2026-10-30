import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';
import 'setup_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    refreshBusiness(ref);
    ref.invalidate(subscriptionProvider);
    ref.invalidate(feedbackCountsProvider);
    ref.invalidate(analyticsProvider(30));
    await ref.read(businessProvider.future);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final business = ref.watch(businessProvider);
    return Scaffold(
      appBar: AppBar(
        title: const BrandLockup(),
        bottom: const PreferredSize(preferredSize: Size.fromHeight(4), child: BrandBar()),
      ),
      body: AsyncBody(
        value: business,
        onRetry: () => ref.invalidate(businessProvider),
        data: (business) => RefreshIndicator(
          onRefresh: () => _refresh(ref),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              _Greeting(business: business),
              const SizedBox(height: 16),
              if (business.isDraft) ...[
                const SetupCard(),
                const SizedBox(height: 16),
              ] else if (business.isFrozen) ...[
                const _FrozenNotice(),
                const SizedBox(height: 16),
              ],
              if (business.slug != null && business.isActive) ...[
                _ReviewLinkCard(links: PublicLinks(business.slug!)),
                const SizedBox(height: 16),
              ],
              if (business.isActive) ...[const _Stats(), const SizedBox(height: 16)],
              const _PlanCard(),
              const SizedBox(height: 16),
              _QuickActions(active: business.isActive),
            ],
          ),
        ),
      ),
    );
  }
}

class _Greeting extends ConsumerWidget {
  const _Greeting({required this.business});

  final Business business;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final firstName = ref.watch(accountProvider).value?.fullName.split(' ').first;
    final (label, tone) = switch (business.status) {
      BusinessStatus.active => ('Live', Tone.success),
      BusinessStatus.draft => ('Setup in progress', Tone.warning),
      BusinessStatus.suspended => ('Suspended', Tone.danger),
      BusinessStatus.closed => ('Closed', Tone.danger),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          firstName == null || firstName.isEmpty ? 'Welcome' : 'Hi, $firstName',
          style: const TextStyle(color: Brand.inkMuted, fontSize: 15),
        ),
        const SizedBox(height: 2),
        Row(
          children: [
            Expanded(
              child: Text(
                business.isShell ? 'Your business' : business.name,
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              ),
            ),
            StatusChip(label, tone: tone),
          ],
        ),
      ],
    );
  }
}

class _FrozenNotice extends StatelessWidget {
  const _FrozenNotice();

  @override
  Widget build(BuildContext context) {
    return const SectionCard(
      title: 'Your public pages are paused',
      subtitle:
          'Customers scanning your QR see an "unavailable" page. Contact Digital Hammerr support to restore your account.',
      child: SizedBox.shrink(),
    );
  }
}

class _ReviewLinkCard extends ConsumerWidget {
  const _ReviewLinkCard({required this.links});

  final PublicLinks links;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sources = ref.watch(qrSourcesProvider).value ?? const <QrSource>[];
    final primary = sources.where((source) => source.active).firstOrNull;
    return SectionCard(
      title: 'Your review link',
      subtitle: 'Customers open this to write a review with Ai help.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (primary != null)
                GestureDetector(
                  onTap: () => context.go('/qr/${primary.id}'),
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    margin: const EdgeInsets.only(right: 14),
                    decoration: BoxDecoration(
                      border: Border.all(color: Brand.line),
                      borderRadius: BorderRadius.circular(Brand.radius),
                    ),
                    child: QrImageView(data: primary.resolveUrl, size: 84, padding: EdgeInsets.zero),
                  ),
                ),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Brand.surface,
                    borderRadius: BorderRadius.circular(Brand.radius),
                  ),
                  child: Text(
                    links.review.replaceFirst(RegExp(r'^https?://'), ''),
                    style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.accent),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => copyText(context, links.review, what: 'Review link copied'),
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text('Copy'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => shareText(
                    'Loved your visit? Share a quick review — Ai helps you write it: ${links.review}',
                  ),
                  icon: const Icon(Icons.share, size: 18),
                  label: const Text('Share'),
                ),
              ),
            ],
          ),
          TextButton.icon(
            onPressed: () => openExternal(context, links.profile),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('View your public page'),
          ),
        ],
      ),
    );
  }
}

class _Stats extends ConsumerWidget {
  const _Stats();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final analytics = ref.watch(analyticsProvider(30));
    final unread = ref.watch(feedbackCountsProvider).value?['new'] ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text('Last 30 days', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
            TextButton(onPressed: () => context.push('/analytics'), child: const Text('See all')),
          ],
        ),
        analytics.when(
          loading: () => const SizedBox(height: 120, child: Center(child: CircularProgressIndicator())),
          error: (error, _) =>
              ErrorState(message: messageFor(error), onRetry: () => ref.invalidate(analyticsProvider(30))),
          data: (data) => GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.7,
            children: [
              StatTile(
                label: 'QR scans',
                value: formatCount(data.total('qr_scan')),
                icon: Icons.qr_code_scanner,
              ),
              StatTile(
                label: 'Ai drafts written',
                value: formatCount(data.total('ai_generate_success')),
                icon: Icons.auto_awesome,
              ),
              StatTile(
                label: 'Sent to Google',
                value: formatCount(data.total('google_open')),
                icon: Icons.star_outline,
              ),
              GestureDetector(
                onTap: () => context.go('/feedback'),
                child: StatTile(
                  label: 'Unread feedback',
                  value: formatCount(unread),
                  icon: Icons.mark_email_unread_outlined,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PlanCard extends ConsumerWidget {
  const _PlanCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subscription = ref.watch(subscriptionProvider).value;
    if (subscription == null) return const SizedBox.shrink();
    final share = subscription.limit == 0 ? 0.0 : subscription.used / subscription.limit;
    return SectionCard(
      title: subscription.isPro ? 'Pro plan' : 'Free plan',
      subtitle: subscription.isPro && subscription.expiresAt != null
          ? 'Renews ${formatDay(subscription.expiresAt)}'
          : 'Ai drafts your customers can create',
      trailing: subscription.isPro
          ? const StatusChip('Pro', tone: Tone.accent)
          : TextButton(
              onPressed: () => context.push('/subscription'),
              child: Text(AppConfig.inAppPayments ? 'Upgrade' : 'View plan'),
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: share.clamp(0, 1),
              minHeight: 8,
              backgroundColor: Brand.surfaceSunk,
              color: share >= 0.9 ? Brand.danger : Brand.accent,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${formatCount(subscription.used)} of ${formatCount(subscription.limit)} used · '
            '${formatCount(subscription.remaining)} left',
            style: const TextStyle(color: Brand.inkMuted),
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    Widget action(IconData icon, String label, VoidCallback onTap) => Expanded(
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(Brand.radius + 4),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
            child: Column(
              children: [
                Icon(icon, color: Brand.accent),
                const SizedBox(height: 8),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Quick actions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        Row(
          children: [
            action(Icons.send_outlined, 'Ask for a review', () => context.go('/customers')),
            const SizedBox(width: 10),
            action(Icons.qr_code_2, 'QR codes', () => context.go('/qr')),
            const SizedBox(width: 10),
            action(Icons.auto_awesome_outlined, 'Ai settings', () => context.push('/ai')),
          ],
        ),
        if (!active) ...[
          const SizedBox(height: 10),
          const Text(
            'Review requests and new QR codes unlock once your page is live.',
            style: TextStyle(color: Brand.inkMuted, fontSize: 13),
          ),
        ],
      ],
    );
  }
}
