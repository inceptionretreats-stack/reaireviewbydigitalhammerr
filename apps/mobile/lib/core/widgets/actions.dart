import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'common.dart';

Future<void> copyText(BuildContext context, String text, {String what = 'Copied'}) async {
  await Clipboard.setData(ClipboardData(text: text));
  if (context.mounted) showMessage(context, what);
}

Future<void> shareText(String text, {String? subject}) =>
    SharePlus.instance.share(ShareParams(text: text, subject: subject));

/// Writes [bytes] to a temporary file and opens the system share sheet with it.
Future<void> shareFile(Uint8List bytes, {required String filename, String? text}) async {
  final directory = await getTemporaryDirectory();
  final file = File('${directory.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], text: text));
}

/// Opens a link outside the app (browser, WhatsApp, dialer).
Future<void> openExternal(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  final opened = uri != null && await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    showMessage(context, "Couldn't open that link.", error: true);
  }
}

/// A WhatsApp chat with [e164] (no message).
String whatsAppChat(String e164) => 'https://wa.me/${e164.replaceAll(RegExp(r'\D'), '')}';
