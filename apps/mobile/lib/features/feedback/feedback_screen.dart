import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

/// Private feedback: what unhappy customers sent instead of posting publicly. Same inbox as the
/// website's feedback page; status changes made here show there and vice versa.
class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  static const _filters = [('inbox', 'Inbox'), ('new', 'Unread'), ('archived', 'Archived'), ('all', 'All')];

  String _status = 'inbox';
  final List<FeedbackItem> _items = [];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;
  Map<String, int> _counts = const {};

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    _items.clear();
    _cursor = null;
    _hasMore = true;
    await _loadMore();
    ref.invalidate(feedbackCountsProvider);
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final status = _status;
    try {
      final page = await ref.read(repositoryProvider).feedback(status: status, cursor: _cursor);
      if (!mounted || status != _status) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _counts = page.counts;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setStatus(FeedbackItem item, String status) async {
    try {
      await ref.read(repositoryProvider).setFeedbackStatus(item.id, status);
      final index = _items.indexWhere((existing) => existing.id == item.id);
      setState(() {
        if (index >= 0) _items[index] = item.withStatus(status);
        // Archiving takes an item out of the inbox views.
        if (status == 'ARCHIVED' && (_status == 'inbox' || _status == 'new')) {
          _items.removeWhere((existing) => existing.id == item.id);
        }
        if (status == 'READ' && _status == 'archived') {
          _items.removeWhere((existing) => existing.id == item.id);
        }
      });
      ref.invalidate(feedbackCountsProvider);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
  }

  Future<void> _open(FeedbackItem item) async {
    if (item.status == 'NEW') _setStatus(item, 'READ');
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => _FeedbackDetail(
        item: item,
        onArchive: () {
          Navigator.pop(context);
          _setStatus(item, 'ARCHIVED');
        },
        onRestore: () {
          Navigator.pop(context);
          _setStatus(item, 'READ');
        },
      ),
    );
  }

  String _filterLabel(String status, String label) {
    final count = switch (status) {
      'inbox' => (_counts['new'] ?? 0) + (_counts['read'] ?? 0),
      'new' => _counts['new'],
      'archived' => _counts['archived'],
      _ => _counts['total'],
    };
    return count == null ? label : '$label ($count)';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Private feedback')),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            if (notification.metrics.extentAfter < 300) _loadMore();
            return false;
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final (status, label) in _filters)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(_filterLabel(status, label)),
                          selected: _status == status,
                          onSelected: (_) {
                            setState(() => _status = status);
                            _reload();
                          },
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              if (_error != null && _items.isEmpty)
                ErrorState(message: messageFor(_error!), onRetry: _reload)
              else if (!_loading && _items.isEmpty)
                const EmptyState(
                  icon: Icons.inbox_outlined,
                  title: 'Nothing here',
                  message:
                      'When a customer chooses "Send private feedback" on your review page, it lands here instead of on Google.',
                )
              else
                for (final item in _items) _FeedbackTile(item: item, onTap: () => _open(item)),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(child: CircularProgressIndicator()),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FeedbackTile extends StatelessWidget {
  const _FeedbackTile({required this.item, required this.onTap});

  final FeedbackItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = item.status == 'NEW';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(Brand.radius + 4),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (unread)
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: const BoxDecoration(color: Brand.accent, shape: BoxShape.circle),
                    ),
                  Expanded(
                    child: Text(
                      item.name?.isNotEmpty == true ? item.name! : 'Anonymous',
                      style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w600),
                    ),
                  ),
                  Text(timeAgo(item.createdAt), style: const TextStyle(color: Brand.inkFaint, fontSize: 12)),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                item.message,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: unread ? Brand.ink : Brand.inkMuted),
              ),
              if (item.status == 'ARCHIVED') ...[const SizedBox(height: 8), const StatusChip('Archived')],
            ],
          ),
        ),
      ),
    );
  }
}

class _FeedbackDetail extends StatelessWidget {
  const _FeedbackDetail({required this.item, required this.onArchive, required this.onRestore});

  final FeedbackItem item;
  final VoidCallback onArchive;
  final VoidCallback onRestore;

  @override
  Widget build(BuildContext context) {
    final mobile = item.mobile;
    final canContact = mobile != null && mobile.startsWith('+');
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            item.name?.isNotEmpty == true ? item.name! : 'Anonymous',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
          Text(formatDayTime(item.createdAt), style: const TextStyle(color: Brand.inkMuted)),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Brand.surface,
              borderRadius: BorderRadius.circular(Brand.radius),
            ),
            child: SelectableText(item.message, style: const TextStyle(fontSize: 15, height: 1.5)),
          ),
          if (mobile != null) ...[
            const SizedBox(height: 12),
            Text('Contact: ${formatPhone(mobile)}', style: const TextStyle(color: Brand.inkMuted)),
          ],
          const SizedBox(height: 16),
          if (canContact)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => openExternal(context, 'tel:$mobile'),
                    icon: const Icon(Icons.call_outlined, size: 18),
                    label: const Text('Call'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => openExternal(context, whatsAppChat(mobile)),
                    icon: const Icon(Icons.chat_outlined, size: 18),
                    label: const Text('WhatsApp'),
                  ),
                ),
              ],
            ),
          const SizedBox(height: 10),
          item.status == 'ARCHIVED'
              ? FilledButton.tonal(onPressed: onRestore, child: const Text('Move back to inbox'))
              : FilledButton.tonal(onPressed: onArchive, child: const Text('Archive')),
        ],
      ),
    );
  }
}
