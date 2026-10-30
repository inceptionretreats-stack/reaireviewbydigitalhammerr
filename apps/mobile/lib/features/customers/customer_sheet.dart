import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

/// Add or edit a customer. PATCH is a full-record update on the server, so every field is sent.
class CustomerSheet extends ConsumerStatefulWidget {
  const CustomerSheet({super.key, this.existing});

  final Customer? existing;

  @override
  ConsumerState<CustomerSheet> createState() => _CustomerSheetState();
}

class _CustomerSheetState extends ConsumerState<CustomerSheet> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _mobile = TextEditingController(
    text: (widget.existing?.mobile ?? '').replaceFirst(RegExp(r'^\+91'), ''),
  );
  late final _email = TextEditingController(text: widget.existing?.email ?? '');
  late final _note = TextEditingController(text: widget.existing?.note ?? '');
  late String? _visitDate = widget.existing?.visitDate;
  late String? _status = widget.existing?.status;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in [_name, _mobile, _email, _note]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
      initialDate: DateTime.tryParse(_visitDate ?? '') ?? now,
    );
    if (picked != null) setState(() => _visitDate = isoDate(picked));
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _mobile.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name and mobile number.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final existing = widget.existing;
    try {
      await ref
          .read(repositoryProvider)
          .saveCustomer(
            id: existing?.id,
            name: _name.text,
            mobile: _mobile.text,
            email: _email.text,
            visitDate: _visitDate,
            note: _note.text,
            // Only send a status the owner may set, and only when it changed.
            status: existing != null && _status != existing.status ? _status : null,
          );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final existing = widget.existing!;
    final ok = await confirm(
      context,
      title: 'Delete ${existing.name}?',
      message: 'Their number is removed from your list and from past review requests.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await ref.read(repositoryProvider).deleteCustomer(existing.id);
      ref.invalidate(reviewRequestsProvider);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final existing = widget.existing;
    final statusEditable = existing != null && Customer.ownerSettable.contains(existing.status);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    existing == null ? 'Add customer' : 'Edit customer',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                ),
                if (existing != null) ...[
                  IconButton(
                    tooltip: 'WhatsApp',
                    onPressed: () => openExternal(context, whatsAppChat(existing.mobile)),
                    icon: const Icon(Icons.chat_outlined),
                  ),
                  IconButton(
                    tooltip: 'Call',
                    onPressed: () => openExternal(context, 'tel:${existing.mobile}'),
                    icon: const Icon(Icons.call_outlined),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 12)],
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 '),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email (optional)'),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: 'Visit date (optional)',
                  suffixIcon: _visitDate == null
                      ? const Icon(Icons.calendar_today_outlined)
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(() => _visitDate = null),
                        ),
                ),
                child: Text(
                  _visitDate == null ? 'Not set' : formatDay(DateTime.parse(_visitDate!)),
                  style: TextStyle(color: _visitDate == null ? Brand.inkFaint : Brand.ink),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              maxLines: 2,
              maxLength: 1000,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            if (existing != null) ...[
              const SizedBox(height: 4),
              if (statusEditable)
                DropdownButtonFormField<String>(
                  initialValue: _status,
                  decoration: const InputDecoration(labelText: 'Status'),
                  items: [
                    for (final status in Customer.ownerSettable)
                      DropdownMenuItem(value: status, child: Text(customerStatusLabels[status]!)),
                  ],
                  onChanged: (value) => setState(() => _status = value),
                )
              else
                Text(
                  'Status: ${existing.statusLabel} (updated automatically from what the customer did)',
                  style: const TextStyle(color: Brand.inkMuted),
                ),
            ],
            const SizedBox(height: 16),
            BusyButton(label: existing == null ? 'Add customer' : 'Save', busy: _busy, onPressed: _save),
            if (existing != null)
              TextButton(
                onPressed: _busy ? null : _delete,
                style: TextButton.styleFrom(foregroundColor: Brand.danger),
                child: const Text('Delete customer'),
              ),
          ],
        ),
      ),
    );
  }
}
