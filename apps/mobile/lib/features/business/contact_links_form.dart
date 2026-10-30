import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/widgets/common.dart';

/// Onboarding's contact buttons (WhatsApp, Call, Instagram, Facebook), saved through
/// PUT /business/links exactly as the website's LinksStep does.
class ContactLinksForm extends ConsumerStatefulWidget {
  const ContactLinksForm({super.key, required this.links, required this.onSaved});

  final List<BusinessLink> links;
  final VoidCallback onSaved;

  @override
  ConsumerState<ContactLinksForm> createState() => _ContactLinksFormState();
}

class _ContactLinksFormState extends ConsumerState<ContactLinksForm> {
  late final _whatsapp = TextEditingController(text: _local(_target(LinkType.whatsapp)));
  late final _call = TextEditingController(text: _local(_target(LinkType.call)));
  late final _instagram = TextEditingController(text: _target(LinkType.instagram));
  late final _facebook = TextEditingController(text: _target(LinkType.facebook));
  bool _busy = false;
  String? _error;
  Set<String> _badFields = {};

  String _target(LinkType type) => widget.links.where((link) => link.type == type).firstOrNull?.target ?? '';

  /// Stored numbers are E.164; show Indian numbers as the 10 digits the owner typed.
  static String _local(String e164) => e164.startsWith('+91') ? e164.substring(3) : e164;

  @override
  void dispose() {
    for (final controller in [_whatsapp, _call, _instagram, _facebook]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final values = [_whatsapp, _call, _instagram, _facebook].map((c) => c.text.trim()).toList();
    final nothingStored = widget.links.every(
      (link) => link.type == LinkType.googleReview || link.target == null,
    );
    // Like the website: skipping with everything blank writes nothing.
    if (values.every((value) => value.isEmpty) && nothingStored) {
      widget.onSaved();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _badFields = {};
    });
    try {
      await ref
          .read(repositoryProvider)
          .saveOnboardingLinks(
            whatsapp: values[0],
            call: values[1],
            instagram: values[2],
            facebook: values[3],
          );
      ref.invalidate(linksProvider);
      ref.invalidate(setupProgressProvider);
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

  InputDecoration _decoration(String label, String field, {String? hint, IconData? icon, String? prefix}) =>
      InputDecoration(
        labelText: label,
        hintText: hint,
        prefixText: prefix,
        prefixIcon: icon == null ? null : Icon(icon),
        errorText: _badFields.contains(field) ? 'Check this one.' : null,
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 14)],
        TextField(
          controller: _whatsapp,
          keyboardType: TextInputType.phone,
          decoration: _decoration('WhatsApp number', 'whatsapp', icon: Icons.chat_outlined, prefix: '+91 '),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _call,
          keyboardType: TextInputType.phone,
          decoration: _decoration('Phone number', 'call', icon: Icons.call_outlined, prefix: '+91 '),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _instagram,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: _decoration(
            'Instagram',
            'instagram',
            hint: 'https://instagram.com/yourbusiness',
            icon: Icons.camera_alt_outlined,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _facebook,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: _decoration(
            'Facebook',
            'facebook',
            hint: 'https://facebook.com/yourbusiness',
            icon: Icons.thumb_up_alt_outlined,
          ),
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                )
              : const Text('Save and continue'),
        ),
      ],
    );
  }
}
