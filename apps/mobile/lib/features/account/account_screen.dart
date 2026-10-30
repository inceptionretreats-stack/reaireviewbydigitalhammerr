import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The website's account settings: details, password and signed-in devices. One account works
/// on both; a password changed here is the password for the website too.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: AsyncBody(
        value: ref.watch(accountProvider),
        onRetry: () => ref.invalidate(accountProvider),
        data: (account) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            _DetailsCard(account: account),
            const SizedBox(height: 16),
            if (account.hasPassword)
              const _PasswordCard()
            else
              const SectionCard(
                title: 'Password',
                subtitle:
                    'You sign in with Google. To use the app, set a password with "Forgot password?" on the sign-in screen.',
                child: SizedBox.shrink(),
              ),
            const SizedBox(height: 16),
            _DevicesCard(account: account),
          ],
        ),
      ),
    );
  }
}

class _DetailsCard extends ConsumerStatefulWidget {
  const _DetailsCard({required this.account});

  final Account account;

  @override
  ConsumerState<_DetailsCard> createState() => _DetailsCardState();
}

class _DetailsCardState extends ConsumerState<_DetailsCard> {
  late final _name = TextEditingController(text: widget.account.fullName);
  late final _email = TextEditingController(text: widget.account.email);
  late final _mobile = TextEditingController(text: widget.account.mobile.replaceFirst(RegExp(r'^\+91'), ''));
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  bool get _emailChanged => _email.text.trim().toLowerCase() != widget.account.email.toLowerCase();

  @override
  void dispose() {
    for (final controller in [_name, _email, _mobile, _password]) {
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
          .updateAccount(
            fullName: _name.text.trim(),
            email: _email.text.trim(),
            mobile: _mobile.text.trim(),
            currentPassword: _emailChanged ? _password.text : null,
          );
      _password.clear();
      ref.invalidate(accountProvider);
      if (mounted) showMessage(context, 'Account details saved');
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Your details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 12)],
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Full name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          if (_emailChanged && widget.account.hasPassword) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Current password',
                helperText: 'Needed to change your email.',
              ),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _mobile,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Mobile', prefixText: '+91 '),
          ),
          const SizedBox(height: 16),
          BusyButton(label: 'Save details', busy: _busy, onPressed: _save),
        ],
      ),
    );
  }
}

class _PasswordCard extends ConsumerStatefulWidget {
  const _PasswordCard();

  @override
  ConsumerState<_PasswordCard> createState() => _PasswordCardState();
}

class _PasswordCardState extends ConsumerState<_PasswordCard> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _change() async {
    if (_next.text.length < 12) {
      setState(() => _error = 'Use at least 12 characters for the new password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final body = await ref
          .read(repositoryProvider)
          .changePassword(currentPassword: _current.text, newPassword: _next.text);
      // The server rotates this device's session and signs every other device out.
      await ref.read(authControllerProvider.notifier).replaceToken(body);
      _current.clear();
      _next.clear();
      ref.invalidate(accountProvider);
      final others = (body['other_sessions_signed_out'] as num?)?.toInt() ?? 0;
      if (mounted) {
        showMessage(
          context,
          others > 0
              ? 'Password changed. $others other ${others == 1 ? 'device was' : 'devices were'} signed out.'
              : 'Password changed.',
        );
      }
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Change password',
      subtitle: 'Also signs you out of the website and your other devices.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 12)],
          TextField(
            controller: _current,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Current password'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _next,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(
              labelText: 'New password',
              helperText: 'At least 12 characters.',
            ),
          ),
          const SizedBox(height: 16),
          BusyButton(label: 'Change password', busy: _busy, onPressed: _change),
        ],
      ),
    );
  }
}

class _DevicesCard extends ConsumerStatefulWidget {
  const _DevicesCard({required this.account});

  final Account account;

  @override
  ConsumerState<_DevicesCard> createState() => _DevicesCardState();
}

class _DevicesCardState extends ConsumerState<_DevicesCard> {
  bool _busy = false;

  Future<void> _signOutOthers() async {
    final ok = await confirm(
      context,
      title: 'Sign out everywhere else?',
      message: 'Any browser or phone signed in to your account, other than this one, will be signed out.',
      confirmLabel: 'Sign out others',
    );
    if (!ok) return;
    setState(() => _busy = true);
    try {
      final count = await ref.read(repositoryProvider).signOutOtherDevices();
      ref.invalidate(accountProvider);
      if (mounted) {
        showMessage(context, count == 0 ? 'No other devices were signed in.' : 'Signed out $count.');
      }
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final others = widget.account.otherLiveSessions;
    return SectionCard(
      title: 'Signed-in devices',
      subtitle: others == 0
          ? 'Only this phone is signed in.'
          : 'This phone and $others other ${others == 1 ? 'browser or device' : 'browsers or devices'}.',
      child: OutlinedButton.icon(
        onPressed: _busy || others == 0 ? null : _signOutOthers,
        icon: const Icon(Icons.devices_other),
        label: const Text('Sign out other devices'),
        style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
      ),
    );
  }
}
