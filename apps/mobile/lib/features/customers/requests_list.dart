import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

/// The 20 most recent review requests (GET /review-requests), same as the website lists them.
class RequestsList extends ConsumerWidget {
  const RequestsList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncBody(
      value: ref.watch(reviewRequestsProvider),
      onRetry: () => ref.invalidate(reviewRequestsProvider),
      data: (requests) => RefreshIndicator(
        onRefresh: () => ref.refresh(reviewRequestsProvider.future),
        child: requests.isEmpty
            ? ListView(
                children: const [
                  EmptyState(
                    icon: Icons.send_outlined,
                    title: 'No review requests yet',
                    message:
                        'Open Contacts and tap the send button next to a customer to ask them for a review.',
                  ),
                ],
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                itemCount: requests.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) => RequestCard(request: requests[index]),
              ),
      ),
    );
  }
}

class RequestCard extends ConsumerStatefulWidget {
  const RequestCard({super.key, required this.request});

  final ReviewRequest request;

  @override
  ConsumerState<RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<RequestCard> {
  bool _marking = false;

  Future<void> _markSent() async {
    setState(() => _marking = true);
    try {
      await ref.read(repositoryProvider).markRequestSent(widget.request.id);
      ref.invalidate(reviewRequestsProvider);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _marking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final (label, tone) = request.firstClickedAt != null
        ? ('Link opened ${timeAgo(request.firstClickedAt)}', Tone.success)
        : request.markedSentAt != null
        ? ('Sent ${timeAgo(request.markedSentAt)}', Tone.accent)
        : ('Prepared ${timeAgo(request.preparedAt)}', Tone.neutral);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(request.customerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                StatusChip(label, tone: tone),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              request.renderedMessage,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Brand.inkMuted),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              children: [
                TextButton.icon(
                  onPressed: () => copyText(context, request.renderedMessage, what: 'Message copied'),
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text('Copy'),
                ),
                if (request.whatsappUrl != null)
                  TextButton.icon(
                    onPressed: () => openExternal(context, request.whatsappUrl!),
                    icon: const Icon(Icons.chat_outlined, size: 18),
                    label: const Text('WhatsApp'),
                  ),
                if (request.markedSentAt == null)
                  TextButton.icon(
                    onPressed: _marking ? null : _markSent,
                    icon: const Icon(Icons.done, size: 18),
                    label: const Text('Mark sent'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
