import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// QR sources: one printed code per place it's displayed (counter, table, bill), so analytics can
/// tell them apart. Same list as the website's QR page.
class QrScreen extends ConsumerWidget {
  const QrScreen({super.key});

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final created = await showModalBottomSheet<QrSource>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const QrEditSheet(),
    );
    if (created != null && context.mounted) context.go('/qr/${created.id}');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final business = ref.watch(businessProvider).value;
    final active = business?.isActive ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('QR codes')),
      floatingActionButton: active
          ? FloatingActionButton.extended(
              onPressed: () => _create(context, ref),
              icon: const Icon(Icons.add),
              label: const Text('New QR'),
            )
          : null,
      body: AsyncBody(
        value: ref.watch(qrSourcesProvider),
        onRetry: () => ref.invalidate(qrSourcesProvider),
        data: (sources) => RefreshIndicator(
          onRefresh: () => ref.refresh(qrSourcesProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              if (!active)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: InlineNotice(
                    tone: Tone.warning,
                    message: business?.isDraft ?? true
                        ? 'Publish your page to get your QR code. Your first one is created when you go live.'
                        : 'Your page is paused, so QR codes show an "unavailable" page.',
                  ),
                ),
              if (sources.isEmpty)
                EmptyState(
                  icon: Icons.qr_code_2,
                  title: 'No QR codes yet',
                  message: 'Finish setup and publish to get your first QR code.',
                  action: FilledButton(
                    onPressed: () => context.push('/onboarding'),
                    child: const Text('Continue setup'),
                  ),
                )
              else ...[
                const Text(
                  'Make one QR for each place customers see it. Scans are counted separately.',
                  style: TextStyle(color: Brand.inkMuted),
                ),
                const SizedBox(height: 12),
                for (final source in sources) ...[_QrTile(source: source), const SizedBox(height: 10)],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _QrTile extends StatelessWidget {
  const _QrTile({required this.source});

  final QrSource source;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(Brand.radius + 4),
        onTap: () => context.go('/qr/${source.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Opacity(
                opacity: source.active ? 1 : 0.35,
                child: QrImageView(data: source.resolveUrl, size: 64, padding: EdgeInsets.zero),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(source.label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 2),
                    Text(
                      source.code,
                      style: const TextStyle(color: Brand.inkMuted, letterSpacing: 1.2, fontSize: 13),
                    ),
                    if (source.note != null && source.note!.isNotEmpty)
                      Text(
                        source.note!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Brand.inkFaint, fontSize: 13),
                      ),
                  ],
                ),
              ),
              StatusChip(source.active ? 'Active' : 'Off', tone: source.active ? Tone.success : Tone.neutral),
              const Icon(Icons.chevron_right, color: Brand.inkFaint),
            ],
          ),
        ),
      ),
    );
  }
}

/// Create a QR source, or rename / re-note an existing one.
class QrEditSheet extends ConsumerStatefulWidget {
  const QrEditSheet({super.key, this.existing});

  final QrSource? existing;

  @override
  ConsumerState<QrEditSheet> createState() => _QrEditSheetState();
}

class _QrEditSheetState extends ConsumerState<QrEditSheet> {
  late final _label = TextEditingController(text: widget.existing?.label ?? '');
  late final _note = TextEditingController(text: widget.existing?.note ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _label.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_label.text.trim().isEmpty) {
      setState(() => _error = 'Give this QR a name, like "Front counter".');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(repositoryProvider);
      final existing = widget.existing;
      final saved = existing == null
          ? await repository.createQr(label: _label.text.trim(), note: _note.text)
          : await repository.updateQr(existing.id, label: _label.text.trim(), note: _note.text.trim());
      ref.invalidate(qrSourcesProvider);
      if (mounted) Navigator.pop(context, saved);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.existing == null ? 'New QR code' : 'Edit QR code',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 16),
          if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 12)],
          TextField(
            controller: _label,
            autofocus: widget.existing == null,
            maxLength: 120,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Where it will be shown',
              hintText: 'e.g. Table 4, Billing counter',
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _note,
            maxLength: 500,
            decoration: const InputDecoration(labelText: 'Private note (optional)'),
          ),
          const SizedBox(height: 12),
          BusyButton(
            label: widget.existing == null ? 'Create QR code' : 'Save',
            busy: _busy,
            onPressed: _save,
          ),
        ],
      ),
    );
  }
}
