import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../core/widgets/actions.dart';
import '../../core/widgets/common.dart';
import 'promo_video.dart';

/// What a signed-out owner sees first: the website's home page, in app form. Same promise, same
/// artwork, same steps, so someone who found Ai Review on the web recognises it here.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.bg,
      body: Column(
        children: [
          // The status bar sits over the top of the screen; the brand strip goes just below it.
          SizedBox(height: MediaQuery.paddingOf(context).top),
          const BrandBar(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 8, 6),
            child: Row(
              children: [
                const BrandLockup(),
                const Spacer(),
                TextButton(onPressed: () => context.push('/login'), child: const Text('Sign in')),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: const [
                _Hero(),
                _StepStrip(),
                SizedBox(height: 36),
                _HowItWorks(),
                SizedBox(height: 36),
                _OwnerFeatures(),
                SizedBox(height: 36),
                _Audience(),
                SizedBox(height: 36),
                _Pricing(),
                SizedBox(height: 28),
                _FinalCta(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Brand.bg, Brand.accentSoft],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Aap bas scan karo…', style: TextStyle(fontSize: 17, color: Brand.inkMuted)),
          const SizedBox(height: 6),
          const Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'Review '),
                WidgetSpan(
                  alignment: PlaceholderAlignment.baseline,
                  baseline: TextBaseline.alphabetic,
                  child: _AiWord(),
                ),
                TextSpan(text: '\nlikh dega'),
              ],
            ),
            style: TextStyle(
              fontSize: 46,
              height: 1.05,
              fontWeight: FontWeight.w800,
              color: Brand.ink,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Review Likhna Ab Easy Hai — AI Hai Na.',
            style: TextStyle(fontSize: 17, color: Brand.ink, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 4),
          const Text(
            'Get more Google reviews for your business with one QR code. Customers scan, Ai helps them write, they post.',
            style: TextStyle(fontSize: 15, color: Brand.inkMuted, height: 1.45),
          ),
          const SizedBox(height: 20),
          const PromoVideo(),
          const SizedBox(height: 8),
          // The heading of the website's video section.
          const Text(
            'Stop losing customers because of bad or missing reviews.',
            style: TextStyle(fontSize: 13, color: Brand.inkMuted, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => context.push('/signup'),
              icon: const Icon(Icons.qr_code_2),
              label: const Text('Create your free QR'),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () => context.push('/login'),
              style: OutlinedButton.styleFrom(backgroundColor: Brand.bg),
              child: const Text('I already have an account'),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Ai" in the hero, cycling through the brand colours like the website's HeroAiAccent.
class _AiWord extends StatefulWidget {
  const _AiWord();

  @override
  State<_AiWord> createState() => _AiWordState();
}

class _AiWordState extends State<_AiWord> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(seconds: 16))..repeat();
  late final _color = TweenSequence<Color?>([
    for (final (from, to) in const [
      (Brand.accent, Brand.red),
      (Brand.red, Color(0xFFE3A008)),
      (Color(0xFFE3A008), Brand.green),
      (Brand.green, Brand.accent),
    ])
      TweenSequenceItem(
        tween: ColorTween(begin: from, end: to),
        weight: 1,
      ),
  ]).animate(_controller);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: _color,
      builder: (context, _) {
        final color = reduceMotion ? Brand.accent : _color.value!;
        return Text(
          'Ai',
          style: TextStyle(
            fontSize: 46,
            height: 1.05,
            fontWeight: FontWeight.w800,
            color: color,
            decoration: TextDecoration.underline,
            decorationColor: color.withValues(alpha: 0.5),
            decorationThickness: 2.5,
          ),
        );
      },
    );
  }
}

/// Scan → Ai draft → Copy → Paste → Review: the strip under the website's hero.
class _StepStrip extends StatelessWidget {
  const _StepStrip();

  static const _steps = [
    (Icons.qr_code_scanner, 'Scan', Brand.green),
    (Icons.auto_awesome, 'Ai draft', Brand.blue),
    (Icons.copy_rounded, 'Copy', Brand.blue),
    (Icons.content_paste, 'Paste', Color(0xFFE3A008)),
    (Icons.star_rounded, 'Review', Brand.red),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Brand.accentSoft,
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
      child: Row(
        children: [
          for (final (index, (icon, label, color)) in _steps.indexed) ...[
            if (index > 0) const Icon(Icons.arrow_forward, size: 14, color: Brand.inkFaint),
            Expanded(
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Brand.bg,
                      shape: BoxShape.circle,
                      border: Border.all(color: color.withValues(alpha: 0.4)),
                    ),
                    child: Icon(icon, color: color, size: 20),
                  ),
                  const SizedBox(height: 6),
                  Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.kicker, required this.title, this.subtitle});

  final String kicker;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          kicker.toUpperCase(),
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: Brand.accent,
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(height: 6),
        Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, height: 1.15)),
        if (subtitle != null) ...[
          const SizedBox(height: 6),
          Text(subtitle!, style: const TextStyle(fontSize: 15, color: Brand.inkMuted, height: 1.4)),
        ],
      ],
    );
  }
}

class _HowItWorks extends StatelessWidget {
  const _HowItWorks();

  static const _steps = [
    ('Scan and choose', 'Customers scan your QR and choose the service(s) they actually used.', Brand.green),
    (
      'Shape a personal draft',
      'Ai helps turn their selections into an editable draft they can make their own.',
      Brand.blue,
    ),
    (
      'Post or send feedback',
      'They can copy and post their review on Google or send private feedback. Nothing posts automatically.',
      Brand.red,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionTitle(kicker: 'Why Ai Review', title: 'A simpler path from visit to review.'),
          const SizedBox(height: 16),
          Center(
            child: Image.asset(
              'assets/images/qr-standee.png',
              height: 190,
              semanticLabel: 'A table standee with your review QR code',
            ),
          ),
          const SizedBox(height: 12),
          for (final (index, (title, body, color)) in _steps.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                    child: Text(
                      '${index + 1}',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text(body, style: const TextStyle(color: Brand.inkMuted, height: 1.4)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Brand.surface,
              borderRadius: BorderRadius.circular(Brand.radius),
            ),
            child: const Row(
              children: [
                Icon(Icons.verified_user_outlined, color: Brand.success),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Ai drafts. Customers edit. They choose what to post.',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OwnerFeatures extends StatelessWidget {
  const _OwnerFeatures();

  static const _features = [
    (Icons.qr_code_2, 'QR codes for every counter', 'Make one per table or desk and see which gets scanned.'),
    (Icons.send_outlined, 'Ask on WhatsApp', 'Send customers a tracked review link in two taps.'),
    (Icons.inbox_outlined, 'Private feedback inbox', 'Unhappy customers tell you first, not Google.'),
    (Icons.insights_outlined, 'Know what works', 'Scans, Ai drafts and Google visits, day by day.'),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionTitle(
            kicker: 'In your pocket',
            title: 'Run your reviews from your phone.',
            subtitle: 'Everything on the Ai Review website, kept in sync.',
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 0.92,
            children: [
              for (final (icon, title, body) in _features)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Brand.bg,
                    border: Border.all(color: Brand.line),
                    borderRadius: BorderRadius.circular(Brand.radius + 4),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Brand.accentSoft,
                          borderRadius: BorderRadius.circular(Brand.radius),
                        ),
                        child: Icon(icon, color: Brand.accent, size: 22),
                      ),
                      const SizedBox(height: 10),
                      Text(title, style: const TextStyle(fontWeight: FontWeight.w700, height: 1.2)),
                      const SizedBox(height: 4),
                      Text(body, style: const TextStyle(color: Brand.inkMuted, fontSize: 13, height: 1.35)),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Audience extends StatelessWidget {
  const _Audience();

  // The website's BusinessAudienceStrip, first dozen.
  static const _businesses = [
    'Restaurants',
    'Cafés',
    'Salons',
    'Clinics',
    'Gyms',
    'Hotels',
    'Bakeries',
    'Pharmacies',
    'Boutiques',
    'Grocery shops',
    'Dry cleaners',
    'Coaching centres',
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionTitle(
            kicker: 'Made for local businesses',
            title: 'If customers visit you, it works for you.',
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (index, name) in _businesses.indexed)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  decoration: BoxDecoration(
                    color: Brand.surface,
                    borderRadius: BorderRadius.circular(999),
                    border: Border(
                      left: BorderSide(
                        color: const [Brand.blue, Brand.red, Brand.yellow, Brand.green][index % 4],
                        width: 3,
                      ),
                    ),
                  ),
                  child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Pricing extends StatelessWidget {
  const _Pricing();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Brand.ink, borderRadius: BorderRadius.circular(18)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Simple pricing. Built for your business.',
              style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, height: 1.2),
            ),
            const SizedBox(height: 8),
            const Text(
              'Start with Free. Upgrade when you need more.',
              style: TextStyle(color: Color(0xFFB8C4D4), fontSize: 15),
            ),
            const SizedBox(height: 16),
            const BrandBar(height: 3),
            const SizedBox(height: 16),
            TextButton.icon(
              style: TextButton.styleFrom(foregroundColor: Colors.white, padding: EdgeInsets.zero),
              onPressed: () => openExternal(context, AppConfig.webPage('/pricing').toString()),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: const Text('See plans and prices'),
            ),
          ],
        ),
      ),
    );
  }
}

class _FinalCta extends StatelessWidget {
  const _FinalCta();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FilledButton(onPressed: () => context.push('/signup'), child: const Text('Get started free')),
            const SizedBox(height: 12),
            const Text(
              'Already use Ai Review on the website? Sign in with the same email and password.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Brand.inkMuted, fontSize: 13),
            ),
            TextButton(onPressed: () => context.push('/login'), child: const Text('Sign in')),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton(
                  onPressed: () => openExternal(context, AppConfig.webPage('/legal/terms').toString()),
                  child: const Text('Terms', style: TextStyle(color: Brand.inkFaint, fontSize: 12)),
                ),
                TextButton(
                  onPressed: () => openExternal(context, AppConfig.webPage('/legal/privacy').toString()),
                  child: const Text('Privacy', style: TextStyle(color: Brand.inkFaint, fontSize: 12)),
                ),
                TextButton(
                  onPressed: () => openExternal(context, AppConfig.webPage('/legal/contact').toString()),
                  child: const Text('Contact', style: TextStyle(color: Brand.inkFaint, fontSize: 12)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
