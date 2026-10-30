import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/catalog.dart';
import '../../core/config.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// Business name, category, description, city, state and web address: onboarding step one and
/// the profile screen, both saving through PATCH /business like the website's BusinessStep.
class BusinessDetailsForm extends ConsumerStatefulWidget {
  const BusinessDetailsForm({
    super.key,
    required this.business,
    required this.onSaved,
    this.submitLabel = 'Save',
  });

  final Business business;
  final VoidCallback onSaved;
  final String submitLabel;

  @override
  ConsumerState<BusinessDetailsForm> createState() => _BusinessDetailsFormState();
}

class _BusinessDetailsFormState extends ConsumerState<BusinessDetailsForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.business.isShell ? '' : widget.business.name);
  late final _description = TextEditingController(text: widget.business.description ?? '');
  late final _city = TextEditingController(text: widget.business.city ?? '');
  late final _state = TextEditingController(text: widget.business.state ?? '');
  late final _slug = TextEditingController(text: widget.business.slug ?? '');
  late String? _category = widget.business.category == Business.shellCategory
      ? null
      : widget.business.category;
  late bool _slugEdited = widget.business.slug != null;

  Timer? _debounce;
  SlugCheck? _slugCheck;
  bool _checking = false;
  bool _busy = false;
  String? _error;
  Set<String> _badFields = {};

  @override
  void dispose() {
    _debounce?.cancel();
    for (final controller in [_name, _description, _city, _state, _slug]) {
      controller.dispose();
    }
    super.dispose();
  }

  /// The website's `normalizeSlug`: lowercase, hyphen-separated, at most 48 characters.
  static String _slugFrom(String value) {
    final slug = value
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'-+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');
    return slug.length > 48 ? slug.substring(0, 48).replaceAll(RegExp(r'-$'), '') : slug;
  }

  void _onNameChanged(String value) {
    if (_slugEdited) return;
    _slug.text = _slugFrom(value);
    _scheduleSlugCheck();
  }

  void _scheduleSlugCheck() {
    _debounce?.cancel();
    final candidate = _slug.text.trim();
    if (candidate.isEmpty) {
      setState(() => _slugCheck = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 450), () async {
      setState(() => _checking = true);
      try {
        final check = await ref.read(repositoryProvider).checkSlug(candidate);
        if (mounted && _slug.text.trim() == candidate) setState(() => _slugCheck = check);
      } catch (_) {
        // Availability is advisory; the save itself is the authority.
      } finally {
        if (mounted) setState(() => _checking = false);
      }
    });
  }

  Future<void> _save() async {
    setState(() => _badFields = {});
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(repositoryProvider)
          .updateBusiness(
            name: _name.text.trim(),
            category: _category!,
            description: _description.text,
            city: _city.text.trim(),
            state: _state.text.trim(),
            slug: _slug.text.trim(),
            timezone: widget.business.timezone,
          );
      refreshBusiness(ref);
      if (mounted) widget.onSaved();
    } on ApiException catch (error) {
      setState(() {
        _error = error.message;
        _badFields = error.fields.toSet();
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = Uri.parse(AppConfig.webBaseUrl).authority;
    final categories = [
      ...businessCategories,
      if (_category != null && !businessCategories.contains(_category)) _category!,
    ];
    final check = _slugCheck;

    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Brand.dangerSoft,
                borderRadius: BorderRadius.circular(Brand.radius),
              ),
              child: Text(_error!, style: const TextStyle(color: Brand.danger)),
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            controller: _name,
            onChanged: _onNameChanged,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(
              labelText: 'Business name',
              errorText: _badFields.contains('name') ? 'Check the business name.' : null,
            ),
            validator: (value) => (value ?? '').trim().length < 2 ? 'Enter your business name.' : null,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _category,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Category'),
            items: [
              for (final category in categories)
                DropdownMenuItem(
                  value: category,
                  child: Text(category, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (value) => setState(() => _category = value),
            validator: (value) => value == null ? 'Choose a category.' : null,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _description,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Short description (optional)',
              hintText: 'What you offer, in a line or two.',
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: _city,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'City'),
                  validator: (value) => (value ?? '').trim().isEmpty ? 'Enter your city.' : null,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextFormField(
                  controller: _state,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'State'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _slug,
            autocorrect: false,
            keyboardType: TextInputType.url,
            onChanged: (_) {
              _slugEdited = true;
              _scheduleSlugCheck();
            },
            decoration: InputDecoration(
              labelText: 'Web address',
              prefixText: '$host/',
              suffixIcon: _checking
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : check == null
                  ? null
                  : Icon(
                      check.available ? Icons.check_circle : Icons.error_outline,
                      color: check.available ? Brand.success : Brand.danger,
                    ),
              helperText: check?.available == true ? 'Available' : null,
              errorText: check != null && !check.available
                  ? check.message
                  : _badFields.contains('slug')
                  ? 'Choose another address.'
                  : null,
            ),
            validator: (value) => (value ?? '').trim().length < 3 ? 'Use at least 3 characters.' : null,
          ),
          if (check != null && !check.available && check.suggestions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Try:', style: TextStyle(color: Brand.inkMuted)),
                ),
                for (final suggestion in check.suggestions)
                  ActionChip(
                    label: Text(suggestion),
                    onPressed: () {
                      _slug.text = suggestion;
                      _slugEdited = true;
                      _scheduleSlugCheck();
                    },
                  ),
              ],
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                  )
                : Text(widget.submitLabel),
          ),
        ],
      ),
    );
  }
}

/// A loading wrapper so screens can drop the form in with the current business.
class BusinessDetailsSection extends ConsumerWidget {
  const BusinessDetailsSection({super.key, required this.onSaved, this.submitLabel = 'Save'});

  final VoidCallback onSaved;
  final String submitLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncBody(
      value: ref.watch(businessProvider),
      onRetry: () => ref.invalidate(businessProvider),
      data: (business) => BusinessDetailsForm(business: business, onSaved: onSaved, submitLabel: submitLabel),
    );
  }
}
