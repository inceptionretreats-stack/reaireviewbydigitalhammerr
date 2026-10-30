import 'package:flutter/material.dart';

import '../theme.dart';

/// A list of short phrases (services, keywords) edited as removable chips.
class ChipsInput extends StatefulWidget {
  const ChipsInput({
    super.key,
    required this.label,
    required this.values,
    required this.onChanged,
    this.hint,
    this.maxItems = 30,
    this.maxLength = 80,
  });

  final String label;
  final String? hint;
  final List<String> values;
  final ValueChanged<List<String>> onChanged;
  final int maxItems;
  final int maxLength;

  @override
  State<ChipsInput> createState() => _ChipsInputState();
}

class _ChipsInputState extends State<ChipsInput> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _add() {
    final value = _controller.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (value.isEmpty) return;
    String? error;
    if (value.length > widget.maxLength) {
      error = 'Keep each one under ${widget.maxLength} characters.';
    } else if (widget.values.length >= widget.maxItems) {
      error = 'You can add up to ${widget.maxItems}.';
    } else if (widget.values.any((existing) => existing.toLowerCase() == value.toLowerCase())) {
      error = 'Already added.';
    }
    setState(() => _error = error);
    if (error != null) return;
    widget.onChanged([...widget.values, value]);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _add(),
          decoration: InputDecoration(
            labelText: widget.label,
            hintText: widget.hint,
            errorText: _error,
            suffixIcon: IconButton(tooltip: 'Add', icon: const Icon(Icons.add), onPressed: _add),
          ),
        ),
        if (widget.values.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final value in widget.values)
                InputChip(
                  label: Text(value),
                  backgroundColor: Brand.accentSoft,
                  onDeleted: () => widget.onChanged(widget.values.where((item) => item != value).toList()),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
