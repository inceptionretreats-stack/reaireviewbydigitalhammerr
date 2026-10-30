import 'package:flutter/material.dart';

/// The website's design tokens (apps/web/app/globals.css), so the app and the site read as one
/// product. Keep the hex values in step with the `--color-*` variables there.
class Brand {
  Brand._();

  static const ink = Color(0xFF0B1F33);
  static const inkMuted = Color(0xFF52627A);
  static const inkFaint = Color(0xFF68778C);
  static const bg = Color(0xFFFFFFFF);
  static const surface = Color(0xFFF7F9FC);
  static const surfaceSunk = Color(0xFFEDF2F8);
  static const line = Color(0xFFDFE6EF);
  static const accent = Color(0xFF1967D2);
  static const accentSoft = Color(0xFFE8F0FE);
  static const danger = Color(0xFFC5221F);
  static const dangerSoft = Color(0xFFFCE8E6);
  static const success = Color(0xFF137333);
  static const successSoft = Color(0xFFE6F4EA);
  static const warning = Color(0xFF7A4500);
  static const warningSoft = Color(0xFFFEF7E0);

  /// The four-colour bar that tops every page of the website.
  static const blue = Color(0xFF4285F4);
  static const red = Color(0xFFEA4335);
  static const yellow = Color(0xFFFBBC05);
  static const green = Color(0xFF34A853);

  static const radius = 10.0;
  static const fontFamily = 'DMSans';
}

ThemeData buildTheme() {
  final scheme =
      ColorScheme.fromSeed(
        seedColor: Brand.accent,
        primary: Brand.accent,
        onPrimary: Colors.white,
        surface: Brand.bg,
        onSurface: Brand.ink,
        error: Brand.danger,
      ).copyWith(
        primaryContainer: Brand.accentSoft,
        onPrimaryContainer: Brand.accent,
        surfaceContainerLowest: Brand.bg,
        surfaceContainerLow: Brand.surface,
        surfaceContainer: Brand.surface,
        surfaceContainerHigh: Brand.surfaceSunk,
        outline: Brand.line,
        outlineVariant: Brand.line,
        onSurfaceVariant: Brand.inkMuted,
      );

  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radius));
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: Brand.fontFamily);

  return base.copyWith(
    scaffoldBackgroundColor: Brand.surface,
    textTheme: base.textTheme.apply(bodyColor: Brand.ink, displayColor: Brand.ink),
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.bg,
      foregroundColor: Brand.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: Brand.fontFamily,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: Brand.ink,
      ),
    ),
    cardTheme: CardThemeData(
      color: Brand.bg,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Brand.radius + 4),
        side: const BorderSide(color: Brand.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 48),
        shape: shape,
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 48),
        shape: shape,
        side: const BorderSide(color: Brand.line),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(textStyle: const TextStyle(fontWeight: FontWeight.w600)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Brand.bg,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Brand.radius),
        borderSide: const BorderSide(color: Brand.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Brand.radius),
        borderSide: const BorderSide(color: Brand.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Brand.radius),
        borderSide: const BorderSide(color: Brand.accent, width: 2),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      side: const BorderSide(color: Brand.line),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Brand.bg,
      indicatorColor: Brand.accentSoft,
      elevation: 0,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontFamily: Brand.fontFamily,
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          color: states.contains(WidgetState.selected) ? Brand.accent : Brand.inkMuted,
        ),
      ),
    ),
    dividerTheme: const DividerThemeData(color: Brand.line, space: 1),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
