import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/chips_input.dart';
import '../../core/widgets/common.dart';

/// Review modes: alternative sets of focus words (e.g. "Festive menu") the owner can switch
/// between. One is active at a time; switching takes effect for every QR straight away.
class ReviewModesScreen extends ConsumerWidget {
  const ReviewModesScreen({super.key});

  Future<void> _run(BuildContext context, WidgetRef ref, Future<void> Function() action, String done) async {
    try {
      await action();
      ref.invalidate(modesProvider);
      ref.invalidate(aiContextProvider);
      if (context.mounted) showMessage(context, done);
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message, error: true);
    }
  }

  Future<void> _edit(BuildContext context, WidgetRef ref, [ReviewMode? mode]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ModeSheet(existing: mode),
    );
    if (saved == true) ref.invalidate(modesProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canManage = !(ref.watch(businessProvider).value?.isFrozen ?? false);
    final repository = ref.read(repositoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Review modes')),
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              onPressed: () => _edit(context, ref),
              icon: const Icon(Icons.add),
              label: const Text('New mode'),
            )
          : null,
      body: AsyncBody(
        value: ref.watch(modesProvider),
        onRetry: () => ref.invalidate(modesProvider),
        data: (modes) {
          final live = modes.where((mode) => !mode.isArchived).toList();
          final archived = modes.where((mode) => mode.isArchived).toList();
          if (modes.isEmpty) {
            return const EmptyState(
              icon: Icons.tune,
              title: 'No modes yet',
              message: 'Save your Ai review settings first. A "Balanced" mode is created for you.',
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              const Text(
                'Switch modes for seasons or offers. Your QR codes stay the same.',
                style: TextStyle(color: Brand.inkMuted),
              ),
              const SizedBox(height: 12),
              for (final mode in [...live, ...archived])
                Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                mode.name,
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 16,
                                  color: mode.isArchived ? Brand.inkFaint : Brand.ink,
                                ),
                              ),
                            ),
                            if (mode.isActive && !mode.isArchived)
                              const StatusChip('In use', tone: Tone.success)
                            else if (mode.isArchived)
                              const StatusChip('Archived'),
                          ],
                        ),
                        if (mode.description != null) ...[
                          const SizedBox(height: 4),
                          Text(mode.description!, style: const TextStyle(color: Brand.inkMuted)),
                        ],
                        if (mode.contextTerms.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [for (final term in mode.contextTerms) Chip(label: Text(term))],
                          ),
                        ],
                        if (canManage)
                          Wrap(
                            children: [
                              if (!mode.isActive && !mode.isArchived)
                                TextButton(
                                  onPressed: () => _run(
                                    context,
                                    ref,
                                    () => repository.activateMode(mode.id),
                                    '"${mode.name}" is now in use',
                                  ),
                                  child: const Text('Use this mode'),
                                ),
                              if (!mode.isArchived)
                                TextButton(
                                  onPressed: () => _edit(context, ref, mode),
                                  child: const Text('Edit'),
                                ),
                              if (!mode.isActive || mode.isArchived)
                                TextButton(
                                  onPressed: () => _run(
                                    context,
                                    ref,
                                    () => repository.updateMode(mode.id, {'is_archived': !mode.isArchived}),
                                    mode.isArchived ? 'Mode restored' : 'Mode archived',
                                  ),
                                  child: Text(mode.isArchived ? 'Restore' : 'Archive'),
                                ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _ModeSheet extends ConsumerStatefulWidget {
  const _ModeSheet({this.existing});

  final ReviewMode? existing;

  @override
  ConsumerState<_ModeSheet> createState() => _ModeSheetState();
}

class _ModeSheetState extends ConsumerState<_ModeSheet> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _description = TextEditingController(text: widget.existing?.description ?? '');
  late List<String> _terms = [...?widget.existing?.contextTerms];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final repository = ref.read(repositoryProvider);
    final description = _description.text.trim();
    try {
      final existing = widget.existing;
      if (existing == null) {
        await repository.createMode(
          name: _name.text.trim(),
          description: description.isEmpty ? null : description,
          contextTerms: _terms,
        );
      } else {
        await repository.updateMode(existing.id, {
          'name': _name.text.trim(),
          'description': description.isEmpty ? null : description,
          'context_terms': _terms,
        });
      }
      if (mounted) Navigator.pop(context, true);
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
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.existing == null ? 'New review mode' : 'Edit review mode',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 12)],
            TextField(
              controller: _name,
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Name', hintText: 'e.g. Diwali specials'),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _description,
              maxLength: 500,
              decoration: const InputDecoration(labelText: 'Description (optional)'),
            ),
            const SizedBox(height: 6),
            ChipsInput(
              label: 'Focus words',
              hint: 'e.g. sweets box, gift hampers',
              values: _terms,
              onChanged: (values) => setState(() => _terms = values),
            ),
            const SizedBox(height: 18),
            BusyButton(label: 'Save', busy: _busy, onPressed: _save),
          ],
        ),
      ),
    );
  }
}
