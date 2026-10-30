import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

/// Where customers are sent after copying their review. Saved through
/// PUT /business/review-destination, which validates it is a Google link.
class ReviewLinkForm extends ConsumerStatefulWidget {
  const ReviewLinkForm({super.key, required this.initial, required this.onSaved, this.submitLabel = 'Save'});

  final ReviewDestination initial;
  final VoidCallback onSaved;
  final String submitLabel;

  @override
  ConsumerState<ReviewLinkForm> createState() => _ReviewLinkFormState();
}

class _ReviewLinkFormState extends ConsumerState<ReviewLinkForm> {
  late final _url = TextEditingController(text: widget.initial.url ?? '');
  late String? _kind = widget.initial.kind;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final url = _url.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Paste your Google review link.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final saved = await ref.read(repositoryProvider).saveReviewDestination(url);
      _url.text = saved.url ?? url;
      setState(() => _kind = saved.kind);
      ref.invalidate(reviewDestinationProvider);
      ref.invalidate(setupProgressProvider);
      if (mounted) widget.onSaved();
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _url,
          keyboardType: TextInputType.url,
          autocorrect: false,
          maxLines: 2,
          minLines: 1,
          decoration: InputDecoration(
            labelText: 'Google review link',
            hintText: 'https://g.page/r/…/review',
            errorText: _error,
            errorMaxLines: 3,
            suffixIcon: IconButton(
              tooltip: 'Paste',
              icon: const Icon(Icons.content_paste),
              onPressed: () async {
                final data = await Clipboard.getData('text/plain');
                if (data?.text != null) _url.text = data!.text!.trim();
              },
            ),
          ),
        ),
        if (_kind != null && _error == null) ...[const SizedBox(height: 10), _KindNote(kind: _kind!)],
        const SizedBox(height: 14),
        const _HowToFind(),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                )
              : Text(widget.submitLabel),
        ),
        if ((widget.initial.url ?? '').isNotEmpty)
          TextButton.icon(
            onPressed: () => openExternal(context, _url.text.trim()),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('Test this link'),
          ),
      ],
    );
  }
}

class _KindNote extends StatelessWidget {
  const _KindNote({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    final (tone, text) = switch (kind) {
      'composer' => (Tone.success, "Opens Google's write-a-review box directly. Ideal."),
      'listing' => (
        Tone.warning,
        "Opens your Google business page. Customers will need to tap 'Write a review' themselves.",
      ),
      _ => (Tone.warning, "This is a Google link, but we can't tell whether it opens the review box."),
    };
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          tone == Tone.success ? Icons.check_circle : Icons.info_outline,
          size: 18,
          color: tone == Tone.success ? Brand.success : Brand.warning,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(text, style: const TextStyle(color: Brand.inkMuted)),
        ),
      ],
    );
  }
}

class _HowToFind extends StatelessWidget {
  const _HowToFind();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Brand.surface, borderRadius: BorderRadius.circular(Brand.radius)),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Where to find it', style: TextStyle(fontWeight: FontWeight.w700)),
          SizedBox(height: 6),
          Text(
            '1. Open Google Maps and search for your business.\n'
            "2. In your Google Business Profile, tap 'Ask for reviews'.\n"
            '3. Copy the link and paste it here.',
            style: TextStyle(color: Brand.inkMuted, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class ReviewLinkSection extends ConsumerWidget {
  const ReviewLinkSection({super.key, required this.onSaved, this.submitLabel = 'Save'});

  final VoidCallback onSaved;
  final String submitLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncBody(
      value: ref.watch(reviewDestinationProvider),
      onRetry: () => ref.invalidate(reviewDestinationProvider),
      data: (destination) => ReviewLinkForm(initial: destination, onSaved: onSaved, submitLabel: submitLabel),
    );
  }
}
