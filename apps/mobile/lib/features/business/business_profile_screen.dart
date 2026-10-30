import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../core/widgets/common.dart';
import 'business_details_form.dart';
import 'review_link_form.dart';

class BusinessProfileScreen extends ConsumerWidget {
  const BusinessProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Business profile')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: [
          const Text(
            'Changes show on your public page and in Ai drafts straight away.',
            style: TextStyle(color: Brand.inkMuted),
          ),
          const SizedBox(height: 18),
          BusinessDetailsSection(onSaved: () => showMessage(context, 'Business profile saved')),
          const SizedBox(height: 18),
          const Text(
            'Your logo and cover photo are managed on the website.',
            style: TextStyle(color: Brand.inkFaint, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class ReviewLinkScreen extends StatelessWidget {
  const ReviewLinkScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Google review link')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: [
          const Text(
            'After writing their review, customers are sent here to post it. Every QR code uses this link.',
            style: TextStyle(color: Brand.inkMuted),
          ),
          const SizedBox(height: 18),
          ReviewLinkSection(onSaved: () => showMessage(context, 'Review link saved')),
        ],
      ),
    );
  }
}
