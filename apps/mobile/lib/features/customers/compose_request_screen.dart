import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';

/// Ask one customer for a review. The platform never sends messages itself: the owner sends from
/// their own WhatsApp or SMS, and then marks the request sent, exactly as on the website.
class ComposeRequestScreen extends ConsumerStatefulWidget {
  const ComposeRequestScreen({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<ComposeRequestScreen> createState() => _ComposeRequestScreenState();
}

class _ComposeRequestScreenState extends ConsumerState<ComposeRequestScreen> {
  final _template = TextEditingController();
  RequestPreview? _preview;
  ReviewRequest? _prepared;
  String? _customerName;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  @override
  void dispose() {
    _template.dispose();
    super.dispose();
  }

  Future<void> _loadPreview({String? templateText}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final preview = await ref
          .read(repositoryProvider)
          .previewRequest(customerId: widget.customerId, templateText: templateText);
      if (!mounted) return;
      setState(() {
        _preview = preview;
        if (templateText == null) _template.text = preview.templateText;
      });
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Mints the tracked link. Each call creates a new request, so it only runs once per screen.
  Future<ReviewRequest?> _prepare() async {
    if (_prepared != null) return _prepared;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final prepared = await ref
          .read(repositoryProvider)
          .prepareRequest(customerId: widget.customerId, templateText: _template.text.trim());
      ref.invalidate(reviewRequestsProvider);
      setState(() {
        _prepared = prepared;
        _customerName = prepared.customerName;
      });
      return prepared;
    } on ApiException catch (error) {
      setState(() => _error = error.message);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send(String channel) async {
    final request = await _prepare();
    if (request == null || !mounted) return;
    switch (channel) {
      case 'whatsapp':
        await openExternal(context, request.whatsappUrl!);
      case 'sms':
        await launchUrl(Uri(scheme: 'sms', queryParameters: {'body': request.renderedMessage}));
      default:
        await shareText(request.renderedMessage);
    }
    if (!mounted) return;
    final sent = await confirm(
      context,
      title: 'Did you send it?',
      message: 'Mark this request as sent so you can track who you have asked.',
      confirmLabel: 'Yes, mark sent',
    );
    if (sent) {
      try {
        await ref.read(repositoryProvider).markRequestSent(request.id);
        ref.invalidate(reviewRequestsProvider);
        if (mounted) {
          showMessage(context, 'Marked as sent');
          Navigator.pop(context);
        }
      } on ApiException catch (error) {
        if (mounted) showMessage(context, error.message, error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    final prepared = _prepared;
    final tooLong = preview != null && preview.preparedLength > preview.lengthLimit;
    return Scaffold(
      appBar: AppBar(title: Text(_customerName == null ? 'Ask for a review' : 'Ask $_customerName')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 14)],
          SectionCard(
            title: 'Message',
            subtitle:
                'Use {customer_name}, {business_name} and {review_link}. The link is tracked, so you can see when they open it.',
            child: TextField(
              controller: _template,
              enabled: prepared == null,
              minLines: 4,
              maxLines: 8,
              maxLength: 1200,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                suffixIcon: prepared == null
                    ? IconButton(
                        tooltip: 'Update preview',
                        icon: const Icon(Icons.refresh),
                        onPressed: () => _loadPreview(templateText: _template.text.trim()),
                      )
                    : null,
              ),
            ),
          ),
          const SizedBox(height: 14),
          SectionCard(
            title: 'Preview',
            child: _loading
                ? const Center(
                    child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()),
                  )
                : Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFDCF8C6),
                      borderRadius: BorderRadius.circular(Brand.radius),
                    ),
                    child: Text(
                      prepared?.renderedMessage ?? preview?.renderedMessage ?? '',
                      style: const TextStyle(height: 1.45),
                    ),
                  ),
          ),
          if (preview != null && preview.unknownVariables.isNotEmpty) ...[
            const SizedBox(height: 10),
            InlineNotice(
              tone: Tone.warning,
              message:
                  'Not recognised: ${preview.unknownVariables.map((v) => '{$v}').join(', ')}. These will be sent as typed.',
            ),
          ],
          if (tooLong) ...[
            const SizedBox(height: 10),
            const InlineNotice(message: 'This message is too long to send. Shorten it a little.'),
          ],
          const SizedBox(height: 20),
          if (prepared?.whatsappUrl != null || prepared == null)
            BusyButton(
              label: 'Send on WhatsApp',
              busy: _busy,
              onPressed: _loading || tooLong ? null : () => _send('whatsapp'),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy || _loading || tooLong ? null : () => _send('sms'),
                  icon: const Icon(Icons.sms_outlined, size: 18),
                  label: const Text('SMS'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy || _loading || tooLong ? null : () => _send('share'),
                  icon: const Icon(Icons.share, size: 18),
                  label: const Text('Other app'),
                ),
              ),
            ],
          ),
          if (prepared != null && prepared.whatsappUrl == null)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text(
                "This number can't be opened in WhatsApp, so use SMS or another app.",
                style: TextStyle(color: Brand.inkMuted),
              ),
            ),
        ],
      ),
    );
  }
}
