import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/chips_input.dart';
import '../../core/widgets/common.dart';

/// What the Ai knows about the business when it drafts a customer's review: the same fields as
/// the website's AiContextStep and Ai review page, saved through PUT /ai/context.
class AiContextForm extends ConsumerStatefulWidget {
  const AiContextForm({super.key, required this.initial, required this.onSaved, this.submitLabel = 'Save'});

  final AiContext initial;
  final VoidCallback onSaved;
  final String submitLabel;

  @override
  ConsumerState<AiContextForm> createState() => _AiContextFormState();
}

class _AiContextFormState extends ConsumerState<AiContextForm> {
  late final _summary = TextEditingController(text: widget.initial.summary ?? '');
  late List<String> _services = [...widget.initial.services];
  late List<String> _terms = [...widget.initial.contextTerms];
  late String _language = widget.initial.draftLanguage;
  bool _busy = false;
  bool _previewing = false;
  String? _error;

  @override
  void dispose() {
    _summary.dispose();
    super.dispose();
  }

  Future<bool> _persist() async {
    setState(() => _error = null);
    try {
      await ref
          .read(repositoryProvider)
          .saveAiContext(
            summary: _summary.text,
            services: _services,
            contextTerms: _terms,
            draftLanguage: _language,
          );
      ref.invalidate(aiContextProvider);
      ref.invalidate(modesProvider);
      ref.invalidate(setupProgressProvider);
      return true;
    } on ApiException catch (error) {
      setState(() => _error = error.message);
      return false;
    }
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final saved = await _persist();
    if (mounted) setState(() => _busy = false);
    if (saved && mounted) widget.onSaved();
  }

  /// Saves first, because the sample is generated from the stored settings (as on the web).
  Future<void> _preview() async {
    setState(() => _previewing = true);
    try {
      if (!await _persist()) return;
      final text = await ref.read(repositoryProvider).testPreview();
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (context) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Sample review', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text(
                "This is the kind of draft a customer sees. It isn't posted anywhere and doesn't use your quota.",
                style: TextStyle(color: Brand.inkMuted),
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Brand.surface,
                  borderRadius: BorderRadius.circular(Brand.radius),
                ),
                child: Text(text, style: const TextStyle(fontSize: 15, height: 1.5)),
              ),
            ],
          ),
        ),
      );
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 14)],
        TextField(
          controller: _summary,
          maxLines: 4,
          maxLength: 2000,
          decoration: const InputDecoration(
            labelText: 'About your business',
            hintText: 'e.g. Family-run South Indian restaurant known for filter coffee and crisp dosas.',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 6),
        ChipsInput(
          label: 'Services or products',
          hint: 'Type one and tap +',
          values: _services,
          onChanged: (values) => setState(() => _services = values),
        ),
        const SizedBox(height: 14),
        ChipsInput(
          label: 'Words customers might mention',
          hint: 'e.g. quick service, clean, friendly staff',
          values: _terms,
          onChanged: (values) => setState(() => _terms = values),
        ),
        const SizedBox(height: 18),
        const Text('Draft language', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'hinglish', label: Text('Hinglish')),
            ButtonSegment(value: 'en', label: Text('English')),
          ],
          selected: {_language},
          onSelectionChanged: (selection) => setState(() => _language = selection.first),
        ),
        const SizedBox(height: 22),
        BusyButton(label: widget.submitLabel, busy: _busy, onPressed: _previewing ? null : _save),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _busy || _previewing ? null : _preview,
          icon: _previewing
              ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.auto_awesome_outlined),
          label: Text(_previewing ? 'Writing a sample…' : 'Try a sample review'),
        ),
      ],
    );
  }
}

class AiContextSection extends ConsumerWidget {
  const AiContextSection({super.key, required this.onSaved, this.submitLabel = 'Save'});

  final VoidCallback onSaved;
  final String submitLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncBody(
      value: ref.watch(aiContextProvider),
      onRetry: () => ref.invalidate(aiContextProvider),
      data: (context) => AiContextForm(initial: context, onSaved: onSaved, submitLabel: submitLabel),
    );
  }
}
