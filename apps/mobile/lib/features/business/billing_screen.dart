import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The buyer details printed on future invoices. PUT /business/billing clears any field that is
/// left out, so all four are always sent.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Billing details')),
      body: AsyncBody(
        value: ref.watch(billingProvider),
        onRetry: () => ref.invalidate(billingProvider),
        data: (billing) => _BillingForm(initial: billing),
      ),
    );
  }
}

class _BillingForm extends ConsumerStatefulWidget {
  const _BillingForm({required this.initial});

  final BillingDetails initial;

  @override
  ConsumerState<_BillingForm> createState() => _BillingFormState();
}

class _BillingFormState extends ConsumerState<_BillingForm> {
  late final _name = TextEditingController(text: widget.initial.legalName);
  late final _gstin = TextEditingController(text: widget.initial.gstin);
  late final _state = TextEditingController(text: widget.initial.stateCode);
  late final _address = TextEditingController(text: widget.initial.address);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in [_name, _gstin, _state, _address]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(repositoryProvider)
          .saveBilling(
            BillingDetails(
              legalName: _name.text.trim(),
              gstin: _gstin.text.trim().toUpperCase(),
              stateCode: _state.text.trim(),
              address: _address.text.trim(),
            ),
          );
      ref.invalidate(billingProvider);
      if (mounted) showMessage(context, 'Billing details saved');
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        const Text(
          'Used on invoices for future payments. Leave GSTIN empty if you are not GST registered.',
          style: TextStyle(color: Brand.inkMuted),
        ),
        const SizedBox(height: 18),
        if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 14)],
        TextField(
          controller: _name,
          maxLength: 200,
          decoration: const InputDecoration(labelText: 'Legal business name'),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _gstin,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(labelText: 'GSTIN (optional)', hintText: '22AAAAA0000A1Z5'),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _state,
          keyboardType: TextInputType.number,
          maxLength: 2,
          decoration: const InputDecoration(labelText: 'State code', hintText: 'e.g. 27 for Maharashtra'),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _address,
          maxLines: 3,
          maxLength: 500,
          decoration: const InputDecoration(labelText: 'Billing address', alignLabelWithHint: true),
        ),
        const SizedBox(height: 12),
        BusyButton(label: 'Save', busy: _busy, onPressed: _save),
      ],
    );
  }
}
