import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/config.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';
import 'auth_scaffold.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  bool _accepted = false;
  bool _busy = false;
  bool _obscure = true;
  String? _error;
  Set<String> _badFields = {};

  @override
  void dispose() {
    for (final controller in [_name, _email, _mobile, _password]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _badFields = {});
    if (!_form.currentState!.validate()) return;
    if (!_accepted) {
      setState(() => _error = 'Please accept the Terms and Privacy Policy to continue.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .signUp(fullName: _name.text, email: _email.text, mobile: _mobile.text, password: _password.text);
    } on ApiException catch (error) {
      setState(() {
        _error = error.message;
        _badFields = error.fields.toSet();
      });
      _form.currentState!.validate();
    } catch (_) {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _serverFlag(String field) => _badFields.contains(field) ? ' ' : null;

  @override
  Widget build(BuildContext context) {
    final linkStyle = const TextStyle(color: Brand.accent, fontWeight: FontWeight.w600);
    return AuthScaffold(
      title: 'Create your account',
      subtitle: 'Free to start. Set up your review QR in a few minutes.',
      child: Form(
        key: _form,
        child: AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null) ...[InlineNotice(message: _error!), const SizedBox(height: 16)],
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Your full name'),
                textCapitalization: TextCapitalization.words,
                autofillHints: const [AutofillHints.name],
                textInputAction: TextInputAction.next,
                validator: (value) => (value == null || value.trim().length < 2)
                    ? 'Enter your name.'
                    : _serverFlag('full_name'),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _email,
                decoration: const InputDecoration(labelText: 'Email'),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
                validator: (value) => (value == null || !value.contains('@'))
                    ? 'Enter a valid email address.'
                    : _serverFlag('email'),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _mobile,
                decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 '),
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumberNational],
                textInputAction: TextInputAction.next,
                validator: (value) {
                  final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
                  if (digits.length != 10) return 'Enter a valid 10-digit mobile number.';
                  return _serverFlag('mobile');
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _password,
                obscureText: _obscure,
                autofillHints: const [AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: 'Password',
                  helperText: 'At least 12 characters.',
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Show password' : 'Hide password',
                    icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (value) => (value == null || value.length < 12)
                    ? 'Use at least 12 characters.'
                    : _serverFlag('password'),
              ),
              const SizedBox(height: 10),
              CheckboxListTile(
                value: _accepted,
                onChanged: (value) => setState(() => _accepted = value ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                title: Text.rich(
                  TextSpan(
                    text: 'I agree to the ',
                    children: [
                      TextSpan(
                        text: 'Terms',
                        style: linkStyle,
                        recognizer: TapGestureRecognizer()
                          ..onTap = () => launchUrl(AppConfig.webPage('/legal/terms')),
                      ),
                      const TextSpan(text: ' and '),
                      TextSpan(
                        text: 'Privacy Policy',
                        style: linkStyle,
                        recognizer: TapGestureRecognizer()
                          ..onTap = () => launchUrl(AppConfig.webPage('/legal/privacy')),
                      ),
                    ],
                  ),
                  style: const TextStyle(fontSize: 14),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                      )
                    : const Text('Create account'),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Already have an account?', style: TextStyle(color: Brand.inkMuted)),
                  TextButton(
                    onPressed: _busy ? null : () => context.pushReplacement('/login'),
                    child: const Text('Sign in'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
