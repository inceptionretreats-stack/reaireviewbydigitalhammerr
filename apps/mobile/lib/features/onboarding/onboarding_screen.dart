import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';
import '../ai/ai_context_form.dart';
import '../business/business_details_form.dart';
import '../business/contact_links_form.dart';
import '../business/review_link_form.dart';

/// The website's five-step setup (apps/web/components/onboarding/steps.ts), same order, same
/// required and optional steps, same API calls.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key, this.initialStep});

  final int? initialStep;

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  static const _titles = [
    ('Your business', 'How customers will recognise you.'),
    ('Google review link', 'Where customers post their review.'),
    ('Contact buttons', 'Optional buttons on your public page.'),
    ('Ai review settings', 'Help the Ai write reviews that sound like your customers.'),
    ('Publish', 'Go live and get your QR code.'),
  ];

  late int _step = (widget.initialStep ?? 0).clamp(0, 4);

  void _next() => setState(() => _step = (_step + 1).clamp(0, 4));

  void _leave() => context.canPop() ? context.pop() : context.go('/home');

  @override
  Widget build(BuildContext context) {
    final (title, subtitle) = _titles[_step];
    return Scaffold(
      backgroundColor: Brand.bg,
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close), tooltip: 'Close setup', onPressed: _leave),
        title: Text('Step ${_step + 1} of 5'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(
            value: (_step + 1) / 5,
            minHeight: 4,
            backgroundColor: Brand.surfaceSunk,
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          children: [
            _StepDots(current: _step, onTap: (step) => setState(() => _step = step)),
            const SizedBox(height: 20),
            Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(color: Brand.inkMuted, fontSize: 15)),
            const SizedBox(height: 22),
            switch (_step) {
              0 => BusinessDetailsSection(onSaved: _next, submitLabel: 'Save and continue'),
              1 => ReviewLinkSection(onSaved: _next, submitLabel: 'Save and continue'),
              2 => AsyncBody(
                value: ref.watch(linksProvider),
                onRetry: () => ref.invalidate(linksProvider),
                data: (links) => ContactLinksForm(links: links, onSaved: _next),
              ),
              3 => AiContextSection(onSaved: _next, submitLabel: 'Save and continue'),
              _ => _FinishStep(
                onDone: () => context.go('/home'),
                onEditStep: (s) => setState(() => _step = s),
              ),
            },
            if (_step == 2 || _step == 3) ...[
              const SizedBox(height: 4),
              TextButton(onPressed: _next, child: const Text('Skip for now')),
            ],
          ],
        ),
      ),
    );
  }
}

class _StepDots extends StatelessWidget {
  const _StepDots({required this.current, required this.onTap});

  final int current;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    const colors = [Brand.blue, Brand.red, Brand.yellow, Brand.green, Brand.accent];
    return Row(
      children: [
        for (var i = 0; i < 5; i++)
          Expanded(
            child: GestureDetector(
              onTap: () => onTap(i),
              child: Container(
                height: 6,
                margin: const EdgeInsets.symmetric(horizontal: 2),
                decoration: BoxDecoration(
                  color: i <= current ? colors[i] : Brand.surfaceSunk,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _FinishStep extends ConsumerStatefulWidget {
  const _FinishStep({required this.onDone, required this.onEditStep});

  final VoidCallback onDone;
  final ValueChanged<int> onEditStep;

  @override
  ConsumerState<_FinishStep> createState() => _FinishStepState();
}

class _FinishStepState extends ConsumerState<_FinishStep> {
  bool _busy = false;
  String? _error;
  PublishResult? _published;

  Future<void> _publish() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(repositoryProvider).publish();
      refreshBusiness(ref);
      ref.invalidate(setupProgressProvider);
      ref.invalidate(subscriptionProvider);
      setState(() => _published = result);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final published = _published;
    if (published != null) return _Published(result: published, onDone: widget.onDone);

    return AsyncBody(
      value: ref.watch(setupProgressProvider),
      onRetry: () => ref.invalidate(setupProgressProvider),
      data: (progress) {
        final rows = [
          ('Business details', progress.hasDetails, 0, true),
          ('Google review link', progress.hasReviewLink, 1, true),
          ('Contact buttons', progress.hasContactLinks, 2, false),
          ('Ai review settings', progress.hasAiContext, 3, false),
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (progress.published) ...[
              const InlineNotice(
                message: 'Your page is live. Publishing again applies any changes straight away.',
                tone: Tone.success,
              ),
              const SizedBox(height: 16),
            ],
            if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 16)],
            Card(
              child: Column(
                children: [
                  for (final (label, done, step, required) in rows)
                    ListTile(
                      leading: Icon(
                        done ? Icons.check_circle : Icons.radio_button_unchecked,
                        color: done ? Brand.success : (required ? Brand.danger : Brand.inkFaint),
                      ),
                      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: done ? null : Text(required ? 'Required' : 'Optional'),
                      trailing: TextButton(
                        onPressed: () => widget.onEditStep(step),
                        child: Text(done ? 'Edit' : 'Add'),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            BusyButton(
              label: progress.published ? 'Publish changes' : 'Publish my page',
              busy: _busy,
              onPressed: progress.readyToPublish ? _publish : null,
            ),
            if (!progress.readyToPublish)
              const Padding(
                padding: EdgeInsets.only(top: 10),
                child: Text(
                  'Add your business details and Google review link to publish.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Brand.inkMuted),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Published extends StatelessWidget {
  const _Published({required this.result, required this.onDone});

  final PublishResult result;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const InlineNotice(message: "You're live! Customers can now scan and review.", tone: Tone.success),
        const SizedBox(height: 20),
        Center(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: Brand.line),
              borderRadius: BorderRadius.circular(16),
            ),
            child: QrImageView(data: result.qrUrl, size: 200, padding: EdgeInsets.zero),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          result.publicUrl.replaceFirst(RegExp(r'^https?://'), ''),
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.accent),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: () => shareText('Scan or tap to review us: ${result.qrUrl}'),
          icon: const Icon(Icons.share),
          label: const Text('Share review link'),
        ),
        const SizedBox(height: 10),
        FilledButton(onPressed: onDone, child: const Text('Go to dashboard')),
      ],
    );
  }
}
