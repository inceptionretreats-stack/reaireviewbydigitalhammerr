import 'package:intl/intl.dart';

final _day = DateFormat('d MMM yyyy');
final _dayTime = DateFormat('d MMM, h:mm a');
final _number = NumberFormat.decimalPattern('en_IN');

String formatDay(DateTime? value) => value == null ? '—' : _day.format(value);

String formatDayTime(DateTime? value) => value == null ? '—' : _dayTime.format(value);

String formatCount(int value) => _number.format(value);

/// Paise to rupees, without decimals when there are none (₹999, ₹1,499.50).
String formatRupees(int paise) {
  final rupees = paise / 100;
  final pattern = paise % 100 == 0 ? '#,##,##0' : '#,##,##0.00';
  return '₹${NumberFormat(pattern, 'en_IN').format(rupees)}';
}

String timeAgo(DateTime? value, {DateTime? now}) {
  if (value == null) return '';
  final diff = (now ?? DateTime.now()).difference(value);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return formatDay(value);
}

/// `YYYY-MM-DD` for the analytics range query.
String isoDate(DateTime value) => DateFormat('yyyy-MM-dd').format(value);

/// +919876543210 → +91 98765 43210, for display only.
String formatPhone(String value) {
  final match = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(value);
  return match == null ? value : '+91 ${match.group(1)} ${match.group(2)}';
}
