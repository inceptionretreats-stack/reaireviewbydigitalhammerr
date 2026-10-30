import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../core/widgets/common.dart';
import 'ai_context_form.dart';

class AiSettingsScreen extends StatelessWidget {
  const AiSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ai review settings'),
        actions: [TextButton(onPressed: () => context.push('/modes'), child: const Text('Modes'))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: [
          const Text(
            'The Ai uses this to suggest reviews that mention what you actually offer. Customers always edit and approve their review before posting.',
            style: TextStyle(color: Brand.inkMuted),
          ),
          const SizedBox(height: 18),
          AiContextSection(onSaved: () => showMessage(context, 'Ai settings saved')),
        ],
      ),
    );
  }
}
