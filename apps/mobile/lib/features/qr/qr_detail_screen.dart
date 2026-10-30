import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';
import 'qr_screen.dart';

class QrDetailScreen extends ConsumerStatefulWidget {
  const QrDetailScreen({super.key, required this.id});

  final String id;

  @override
  ConsumerState<QrDetailScreen> createState() => _QrDetailScreenState();
}

class _QrDetailScreenState extends ConsumerState<QrDetailScreen> {
  bool _sharing = false;
  bool _toggling = false;

  /// Shares the branded, print-ready card the website generates (900x1350 PNG).
  Future<void> _shareCard(QrSource source) async {
    setState(() => _sharing = true);
    try {
      final bytes = await ref.read(repositoryProvider).qrCard(source.id);
      final name = source.label.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-');
      await shareFile(bytes, filename: 'ai-review-qr-$name-${source.code}.png');
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  Future<void> _toggle(QrSource source) async {
    if (source.active) {
      final ok = await confirm(
        context,
        title: 'Turn off this QR code?',
        message:
            'Anyone scanning "${source.label}" will see an unavailable page until you turn it back on. Your other QR codes keep working.',
        confirmLabel: 'Turn off',
        destructive: true,
      );
      if (!ok) return;
    }
    setState(() => _toggling = true);
    try {
      await ref.read(repositoryProvider).updateQr(source.id, active: !source.active);
      ref.invalidate(qrSourcesProvider);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _toggling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sources = ref.watch(qrSourcesProvider);
    final active = ref.watch(businessProvider).value?.isActive ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('QR code')),
      body: AsyncBody(
        value: sources,
        onRetry: () => ref.invalidate(qrSourcesProvider),
        data: (sources) {
          final source = sources.where((source) => source.id == widget.id).firstOrNull;
          if (source == null) {
            return const EmptyState(icon: Icons.qr_code_2, title: 'This QR code no longer exists');
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
            children: [
              Center(
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: Brand.bg,
                    border: Border.all(color: Brand.line),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Opacity(
                    opacity: source.active ? 1 : 0.3,
                    child: QrImageView(data: source.resolveUrl, size: 220, padding: EdgeInsets.zero),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                source.label,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(
                '${source.code} · created ${formatDay(source.createdAt)}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Brand.inkMuted),
              ),
              if (source.note != null && source.note!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  source.note!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Brand.inkFaint),
                ),
              ],
              const SizedBox(height: 22),
              BusyButton(
                label: 'Share printable QR card',
                busy: _sharing,
                onPressed: () => _shareCard(source),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => copyText(context, source.resolveUrl, what: 'Link copied'),
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copy link'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => openExternal(context, source.resolveUrl),
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: const Text('Test it'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              if (active)
                Card(
                  child: Column(
                    children: [
                      SwitchListTile(
                        value: source.active,
                        onChanged: _toggling ? null : (_) => _toggle(source),
                        title: const Text('QR code is on', style: TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(
                          source.active ? 'Scans open your review page.' : 'Scans show an unavailable page.',
                        ),
                      ),
                      const Divider(),
                      ListTile(
                        leading: const Icon(Icons.edit_outlined),
                        title: const Text('Rename or add a note'),
                        onTap: () => showModalBottomSheet<void>(
                          context: context,
                          isScrollControlled: true,
                          showDragHandle: true,
                          builder: (_) => QrEditSheet(existing: source),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
