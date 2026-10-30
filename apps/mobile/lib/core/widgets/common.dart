import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../theme.dart';

/// The four-colour strip from the top of every website page.
class BrandBar extends StatelessWidget {
  const BrandBar({super.key, this.height = 4});

  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: const Row(
        // Stretch: a childless ColoredBox has no height of its own.
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: ColoredBox(color: Brand.blue)),
          Expanded(child: ColoredBox(color: Brand.red)),
          Expanded(child: ColoredBox(color: Brand.yellow)),
          Expanded(child: ColoredBox(color: Brand.green)),
        ],
      ),
    );
  }
}

/// The "Ai Review / by Digital Hammerr" lockup from the website header.
class BrandLockup extends StatelessWidget {
  const BrandLockup({super.key, this.large = false});

  final bool large;

  @override
  Widget build(BuildContext context) {
    final barHeights = large ? [14.0, 20.0, 26.0, 32.0] : [10.0, 14.0, 18.0, 22.0];
    const colors = [Brand.blue, Brand.red, Brand.yellow, Brand.green];
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (var i = 0; i < 4; i++)
          Container(
            width: large ? 6 : 4.5,
            height: barHeights[i],
            margin: const EdgeInsets.only(right: 3),
            decoration: BoxDecoration(color: colors[i], borderRadius: BorderRadius.circular(2)),
          ),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Ai Review',
              style: TextStyle(
                fontSize: large ? 24 : 17,
                fontWeight: FontWeight.w700,
                color: Brand.ink,
                height: 1.1,
              ),
            ),
            Text(
              'by Digital Hammerr',
              style: TextStyle(fontSize: large ? 13 : 11, fontWeight: FontWeight.w600, color: Brand.inkMuted),
            ),
          ],
        ),
      ],
    );
  }
}

/// Renders an [AsyncValue] with consistent loading, error (with retry) and data states.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.data, this.onRetry});

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: data,
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorState(message: messageFor(error), onRetry: onRetry),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 40, color: Brand.inkFaint),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Brand.inkMuted),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(color: Brand.accentSoft, shape: BoxShape.circle),
            child: Icon(icon, color: Brand.accent, size: 28),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Brand.inkMuted),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 18), action!],
        ],
      ),
    );
  }
}

/// A titled card, the basic building block of every dashboard screen.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    this.title,
    this.subtitle,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (title != null) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(title!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                  ?trailing,
                ],
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(subtitle!, style: const TextStyle(color: Brand.inkMuted, fontSize: 13)),
              ],
              const SizedBox(height: 12),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

enum Tone { neutral, accent, success, warning, danger }

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.tone = Tone.neutral});

  final String label;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      Tone.neutral => (Brand.surfaceSunk, Brand.inkMuted),
      Tone.accent => (Brand.accentSoft, Brand.accent),
      Tone.success => (Brand.successSoft, Brand.success),
      Tone.warning => (Brand.warningSoft, Brand.warning),
      Tone.danger => (Brand.dangerSoft, Brand.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// A coloured message box, used for form-level errors and notices.
class InlineNotice extends StatelessWidget {
  const InlineNotice({super.key, required this.message, this.tone = Tone.danger});

  final String message;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, icon) = switch (tone) {
      Tone.danger => (Brand.dangerSoft, Brand.danger, Icons.error_outline),
      Tone.warning => (Brand.warningSoft, Brand.warning, Icons.info_outline),
      Tone.success => (Brand.successSoft, Brand.success, Icons.check_circle_outline),
      _ => (Brand.accentSoft, Brand.accent, Icons.info_outline),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Brand.radius)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: fg, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: fg, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}

/// A full-width primary button that shows a spinner while [busy].
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
            )
          : Text(label),
    );
  }
}

/// A stat tile for the dashboard rows.
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.icon, this.hint});

  final String label;
  final String value;
  final IconData? icon;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (icon != null) ...[Icon(icon, size: 16, color: Brand.inkMuted), const SizedBox(width: 6)],
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Brand.inkMuted, fontSize: 12.5),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
            if (hint != null) Text(hint!, style: const TextStyle(color: Brand.inkFaint, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

/// A message suitable for a user, from any error the API layer can raise.
String messageFor(Object error) {
  if (error is ApiException) return error.message;
  return 'Something went wrong. Please try again.';
}

void showMessage(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? Brand.danger : Brand.ink));
}

Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          style: destructive ? FilledButton.styleFrom(backgroundColor: Brand.danger) : null,
          onPressed: () => Navigator.pop(context, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}
