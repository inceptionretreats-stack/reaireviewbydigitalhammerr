import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The buttons on the public page: show or hide, change text and target, and reorder. Same
/// controls as the website's profile page (PATCH /business/links/{id}, POST …/reorder).
class LinksScreen extends ConsumerStatefulWidget {
  const LinksScreen({super.key});

  @override
  ConsumerState<LinksScreen> createState() => _LinksScreenState();
}

class _LinksScreenState extends ConsumerState<LinksScreen> {
  List<BusinessLink>? _order;
  bool _saving = false;

  Future<void> _patch(BusinessLink link, Map<String, dynamic> patch) async {
    try {
      await ref.read(repositoryProvider).updateLink(link.id, patch);
      ref.invalidate(linksProvider);
      ref.invalidate(setupProgressProvider);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
  }

  Future<void> _reorder(List<BusinessLink> links, int from, int to) async {
    final next = [...links];
    next.insert(to, next.removeAt(from));
    setState(() {
      _order = next;
      _saving = true;
    });
    try {
      await ref.read(repositoryProvider).reorderLinks(next.map((link) => link.id).toList());
      ref.invalidate(linksProvider);
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) {
        setState(() {
          _order = null;
          _saving = false;
        });
      }
    }
  }

  Future<void> _edit(BusinessLink link) async {
    final changed = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _LinkSheet(link: link),
    );
    if (changed != null && changed.isNotEmpty) await _patch(link, changed);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Buttons on your page'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
            ),
        ],
      ),
      body: AsyncBody(
        value: ref.watch(linksProvider),
        onRetry: () => ref.invalidate(linksProvider),
        data: (links) {
          final ordered = _order ?? links;
          return ReorderableListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            header: const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Text(
                'Drag to reorder. Turn a button off to hide it from your public page.',
                style: TextStyle(color: Brand.inkMuted),
              ),
            ),
            onReorderItem: (from, to) => _reorder(ordered, from, to),
            children: [
              for (final link in ordered)
                Card(
                  key: ValueKey(link.id),
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(_icon(link.type), color: link.enabled ? Brand.accent : Brand.inkFaint),
                    title: Text(link.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      link.type == LinkType.googleReview
                          ? 'Uses your Google review link'
                          : link.target == null
                          ? 'Not set'
                          : link.type.takesPhone
                          ? formatPhone(link.target!)
                          : link.target!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () => _edit(link),
                    trailing: Switch(
                      value: link.enabled,
                      onChanged: link.target == null && link.type != LinkType.googleReview
                          ? null
                          : (value) => _patch(link, {'enabled': value}),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  static IconData _icon(LinkType type) => switch (type) {
    LinkType.googleReview => Icons.star_outline,
    LinkType.whatsapp => Icons.chat_outlined,
    LinkType.call => Icons.call_outlined,
    LinkType.instagram => Icons.camera_alt_outlined,
    LinkType.facebook => Icons.thumb_up_alt_outlined,
    LinkType.website => Icons.language,
    LinkType.directions => Icons.directions_outlined,
    LinkType.custom => Icons.link,
  };
}

class _LinkSheet extends StatefulWidget {
  const _LinkSheet({required this.link});

  final BusinessLink link;

  @override
  State<_LinkSheet> createState() => _LinkSheetState();
}

class _LinkSheetState extends State<_LinkSheet> {
  late final _label = TextEditingController(text: widget.link.label);
  late final _target = TextEditingController(
    text: widget.link.type.takesPhone
        ? (widget.link.phone ?? '').replaceFirst(RegExp(r'^\+91'), '')
        : widget.link.url ?? '',
  );

  @override
  void dispose() {
    _label.dispose();
    _target.dispose();
    super.dispose();
  }

  void _done() {
    final link = widget.link;
    final patch = <String, dynamic>{};
    if (_label.text.trim() != link.label) patch['label'] = _label.text.trim();
    final target = _target.text.trim();
    if (link.type.takesPhone && target != (link.phone ?? '').replaceFirst(RegExp(r'^\+91'), '')) {
      patch['phone'] = target.isEmpty ? null : target;
    } else if (link.type.takesUrl && target != (link.url ?? '')) {
      patch['url'] = target.isEmpty ? null : target;
    }
    Navigator.pop(context, patch);
  }

  @override
  Widget build(BuildContext context) {
    final link = widget.link;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Edit button', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          TextField(
            controller: _label,
            maxLength: 80,
            decoration: const InputDecoration(labelText: 'Button text'),
          ),
          if (link.type != LinkType.googleReview) ...[
            const SizedBox(height: 6),
            TextField(
              controller: _target,
              keyboardType: link.type.takesPhone ? TextInputType.phone : TextInputType.url,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: link.type.takesPhone ? 'Phone number' : 'Link (https://…)',
                prefixText: link.type.takesPhone ? '+91 ' : null,
                helperText: 'Leave empty to remove. An empty button is hidden.',
              ),
            ),
          ],
          const SizedBox(height: 18),
          FilledButton(onPressed: _done, child: const Text('Save')),
        ],
      ),
    );
  }
}
