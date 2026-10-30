import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// Plan, usage and payment history, with upgrade through Razorpay Checkout. The order is created
/// and the payment verified by the same endpoints the website uses, so a payment made here
/// activates Pro on the website too (and the Razorpay webhook covers an app closed mid-payment).
class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  final _razorpay = Razorpay();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onFailure);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _upgrade() async {
    setState(() => _busy = true);
    try {
      final order = await ref.read(repositoryProvider).startCheckout();
      final prefill = (order['prefill'] as Map?)?.cast<String, dynamic>() ?? const {};
      final mobile = ref.read(accountProvider).value?.mobile;
      _razorpay.open({
        'key': order['key_id'],
        'order_id': order['order_id'],
        'amount': order['amount_paise'],
        'currency': order['currency'] ?? 'INR',
        'name': 'Ai Review by Digital Hammerr',
        'description': 'Pro plan · ${order['business_name'] ?? ''}',
        'prefill': {'name': prefill['name'], 'email': prefill['email'], 'contact': ?mobile},
        'theme': {'color': '#1967D2'},
      });
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      setState(() => _busy = false);
    }
  }

  Future<void> _onSuccess(PaymentSuccessResponse response) async {
    try {
      final activated = await ref
          .read(repositoryProvider)
          .verifyPayment(
            orderId: response.orderId ?? '',
            paymentId: response.paymentId ?? '',
            signature: response.signature ?? '',
          );
      if (mounted) {
        showMessage(
          context,
          activated ? 'Welcome to Pro! Your receipt is on its way by email.' : 'Payment received.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      ref.invalidate(subscriptionProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  void _onFailure(PaymentFailureResponse response) {
    ref.invalidate(subscriptionProvider);
    if (!mounted) return;
    setState(() => _busy = false);
    // Code 2 is the customer closing Checkout; that is not an error worth shouting about.
    if (response.code != Razorpay.PAYMENT_CANCELLED) {
      showMessage(context, response.message ?? 'The payment did not go through.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final business = ref.watch(businessProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Subscription')),
      body: AsyncBody(
        value: ref.watch(subscriptionProvider),
        onRetry: () => ref.invalidate(subscriptionProvider),
        data: (subscription) => RefreshIndicator(
          onRefresh: () => ref.refresh(subscriptionProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              _PlanSummary(subscription: subscription),
              const SizedBox(height: 16),
              if (subscription.renewalOffered && AppConfig.inAppPayments) ...[
                _UpgradeCard(
                  subscription: subscription,
                  busy: _busy,
                  canPay: (business?.isActive ?? false) && subscription.paymentsConfigured,
                  reason: !(business?.isActive ?? false)
                      ? 'Publish your page to upgrade.'
                      : !subscription.paymentsConfigured
                      ? 'Payments are paused right now. Please try again later.'
                      : null,
                  onUpgrade: _upgrade,
                ),
                const SizedBox(height: 16),
              ],
              if (!AppConfig.inAppPayments) ...[
                const InlineNotice(
                  tone: Tone.accent,
                  message:
                      "Changing your plan isn't available in the app. Your plan and usage are shown here.",
                ),
                const SizedBox(height: 16),
              ],
              _PaymentHistory(payments: subscription.payments),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlanSummary extends StatelessWidget {
  const _PlanSummary({required this.subscription});

  final Subscription subscription;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (subscription.status) {
      'PRO_ACTIVE' => ('Pro', Tone.success),
      'PAST_DUE' => ('Pro · payment due', Tone.warning),
      'CHECKOUT_PENDING' => ('Payment pending', Tone.warning),
      'EXPIRED' => ('Expired', Tone.danger),
      'CANCELLED' => ('Cancelled', Tone.danger),
      _ => ('Free', Tone.neutral),
    };
    final share = subscription.limit == 0 ? 0.0 : subscription.used / subscription.limit;
    return SectionCard(
      title: 'Your plan',
      trailing: StatusChip(label, tone: tone),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${formatCount(subscription.remaining)} Ai drafts left',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: share.clamp(0, 1),
              minHeight: 8,
              backgroundColor: Brand.surfaceSunk,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${formatCount(subscription.used)} of ${formatCount(subscription.limit)} used'
            '${subscription.expiresAt != null ? ' · valid until ${formatDay(subscription.expiresAt)}' : ''}',
            style: const TextStyle(color: Brand.inkMuted),
          ),
        ],
      ),
    );
  }
}

class _UpgradeCard extends StatelessWidget {
  const _UpgradeCard({
    required this.subscription,
    required this.busy,
    required this.canPay,
    required this.reason,
    required this.onUpgrade,
  });

  final Subscription subscription;
  final bool busy;
  final bool canPay;
  final String? reason;
  final VoidCallback onUpgrade;

  @override
  Widget build(BuildContext context) {
    final renewing = subscription.isPro;
    return Card(
      color: Brand.accentSoft,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              renewing ? 'Renew Pro' : 'Upgrade to Pro',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              renewing && subscription.daysLeft != null
                  ? '${subscription.daysLeft} days left. Renewing adds a year after your current period ends.'
                  : 'More Ai drafts for your customers, for a whole year.',
              style: const TextStyle(color: Brand.inkMuted),
            ),
            const SizedBox(height: 12),
            Text(
              '${formatRupees(subscription.pricePaise)} / year',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.accent),
            ),
            const SizedBox(height: 12),
            BusyButton(
              label: renewing ? 'Renew now' : 'Upgrade now',
              busy: busy,
              onPressed: canPay ? onUpgrade : null,
            ),
            if (reason != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(reason!, style: const TextStyle(color: Brand.inkMuted)),
              ),
          ],
        ),
      ),
    );
  }
}

class _PaymentHistory extends StatelessWidget {
  const _PaymentHistory({required this.payments});

  final List<Payment> payments;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Payments',
      subtitle: 'Receipts are emailed to you and listed on the website.',
      child: payments.isEmpty
          ? const Text('No payments yet.', style: TextStyle(color: Brand.inkMuted))
          : Column(
              children: [
                for (final payment in payments)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      formatRupees(payment.amountPaise),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(formatDay(payment.paidAt ?? payment.createdAt)),
                    trailing: StatusChip(
                      switch (payment.status) {
                        'CAPTURED' => 'Paid',
                        'REFUNDED' => 'Refunded',
                        'FAILED' => 'Failed',
                        _ => 'Pending',
                      },
                      tone: switch (payment.status) {
                        'CAPTURED' => Tone.success,
                        'FAILED' => Tone.danger,
                        _ => Tone.neutral,
                      },
                    ),
                  ),
              ],
            ),
    );
  }
}
