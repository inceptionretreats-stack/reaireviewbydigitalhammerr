import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The web dashboard's SetupProgressCard: five steps, two optional, with a button to resume.
class SetupCard extends ConsumerWidget {
  const SetupCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progress = ref.watch(setupProgressProvider);
    return progress.when(
      loading: () => const Card(
        child: SizedBox(height: 160, child: Center(child: CircularProgressIndicator())),
      ),
      error: (error, _) =>
          ErrorState(message: messageFor(error), onRetry: () => ref.invalidate(setupProgressProvider)),
      data: (progress) {
        final steps = [
          ('Business details', progress.hasDetails, false),
          ('Google review link', progress.hasReviewLink, false),
          ('Contact buttons', progress.hasContactLinks, true),
          ('Ai review settings', progress.hasAiContext, true),
          ('Publish your page', progress.published, false),
        ];
        return SectionCard(
          title: 'Finish setting up',
          subtitle: '${progress.doneCount} of 5 done · your page goes live when you publish.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (index, (label, done, optional)) in steps.indexed)
                InkWell(
                  onTap: () => context.push('/onboarding?step=$index'),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Icon(
                          done ? Icons.check_circle : Icons.radio_button_unchecked,
                          color: done ? Brand.success : Brand.inkFaint,
                          size: 22,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            label,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: done ? Brand.inkMuted : Brand.ink,
                            ),
                          ),
                        ),
                        if (optional && !done) const StatusChip('Optional'),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => context.push('/onboarding?step=${progress.resumeStep}'),
                child: Text(progress.readyToPublish ? 'Review and publish' : 'Continue setup'),
              ),
            ],
          ),
        );
      },
    );
  }
}
