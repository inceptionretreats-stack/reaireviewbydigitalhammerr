import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';

/// The website's analytics page: totals, the scan-to-Google funnel, the daily trend, and which QR
/// codes and buttons customers use. Same endpoints, same numbers.
class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  int _days = 30;

  @override
  Widget build(BuildContext context) {
    final overview = ref.watch(analyticsProvider(_days));
    return Scaffold(
      appBar: AppBar(title: const Text('Analytics')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(analyticsProvider(_days).future),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 7, label: Text('7 days')),
                ButtonSegment(value: 30, label: Text('30 days')),
                ButtonSegment(value: 90, label: Text('90 days')),
              ],
              selected: {_days},
              onSelectionChanged: (selection) => setState(() => _days = selection.first),
            ),
            const SizedBox(height: 16),
            overview.when(
              skipLoadingOnRefresh: true,
              loading: () => const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => ErrorState(
                message: messageFor(error),
                onRetry: () => ref.invalidate(analyticsProvider(_days)),
              ),
              data: (data) => _Overview(data: data, days: _days),
            ),
          ],
        ),
      ),
    );
  }
}

class _Overview extends ConsumerWidget {
  const _Overview({required this.data, required this.days});

  final AnalyticsOverview data;
  final int days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${formatDay(DateTime.tryParse(data.range.from))} – ${formatDay(DateTime.tryParse(data.range.to))}',
          style: const TextStyle(color: Brand.inkMuted),
        ),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.7,
          children: [
            StatTile(
              label: 'QR scans',
              value: formatCount(data.total('qr_scan')),
              icon: Icons.qr_code_scanner,
            ),
            StatTile(label: 'Visitors', value: formatCount(data.uniqueVisitors), icon: Icons.person_outline),
            StatTile(
              label: 'Ai drafts',
              value: formatCount(data.total('ai_generate_success')),
              icon: Icons.auto_awesome,
            ),
            StatTile(
              label: 'Opened Google',
              value: formatCount(data.total('google_open')),
              icon: Icons.star_outline,
            ),
          ],
        ),
        const SizedBox(height: 16),
        _TrendCard(days: data.trend),
        const SizedBox(height: 16),
        _FunnelCard(data: data),
        const SizedBox(height: 16),
        _QrTable(days: days),
        const SizedBox(height: 16),
        _LinksTable(days: days),
      ],
    );
  }
}

class _TrendCard extends StatelessWidget {
  const _TrendCard({required this.days});

  final List<TrendDay> days;

  @override
  Widget build(BuildContext context) {
    List<FlSpot> series(String event) => [
      for (final (index, day) in days.indexed)
        if (!day.pending) FlSpot(index.toDouble(), (day.counts[event] ?? 0).toDouble()),
    ];
    final scans = series('qr_scan');
    final views = series('review_page_view');
    final maxY = [...scans, ...views].fold<double>(0, (max, spot) => spot.y > max ? spot.y : max);

    return SectionCard(
      title: 'Daily activity',
      subtitle: 'QR scans and review page visits',
      child: SizedBox(
        height: 180,
        child: days.isEmpty
            ? const Center(
                child: Text('No data yet', style: TextStyle(color: Brand.inkMuted)),
              )
            : LineChart(
                LineChartData(
                  minY: 0,
                  maxY: maxY < 4 ? 4 : maxY * 1.2,
                  gridData: FlGridData(
                    drawVerticalLine: false,
                    getDrawingHorizontalLine: (_) => const FlLine(color: Brand.line, strokeWidth: 1),
                  ),
                  borderData: FlBorderData(show: false),
                  titlesData: FlTitlesData(
                    topTitles: const AxisTitles(),
                    rightTitles: const AxisTitles(),
                    leftTitles: const AxisTitles(
                      sideTitles: SideTitles(showTitles: true, reservedSize: 28, maxIncluded: false),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: 22,
                        interval: (days.length / 4).ceilToDouble().clamp(1, 1000),
                        getTitlesWidget: (value, meta) {
                          final index = value.toInt();
                          if (index < 0 || index >= days.length) return const SizedBox.shrink();
                          final date = DateTime.tryParse(days[index].date);
                          return Text(
                            date == null ? '' : '${date.day}/${date.month}',
                            style: const TextStyle(fontSize: 11, color: Brand.inkFaint),
                          );
                        },
                      ),
                    ),
                  ),
                  lineBarsData: [_line(views, Brand.green), _line(scans, Brand.accent)],
                ),
              ),
      ),
    );
  }

  LineChartBarData _line(List<FlSpot> spots, Color color) => LineChartBarData(
    spots: spots,
    color: color,
    barWidth: 2.5,
    isCurved: true,
    preventCurveOverShooting: true,
    dotData: const FlDotData(show: false),
    belowBarData: BarAreaData(show: true, color: color.withValues(alpha: 0.08)),
  );
}

class _FunnelCard extends StatelessWidget {
  const _FunnelCard({required this.data});

  final AnalyticsOverview data;

  @override
  Widget build(BuildContext context) {
    final top = data.funnel.isEmpty
        ? 0
        : data.funnel.map((step) => step.sessions).reduce((a, b) => a > b ? a : b);
    return SectionCard(
      title: 'From scan to Google',
      subtitle: data.funnelEmpty
          ? 'No visits in this period yet.'
          : '${data.reachedGooglePercent?.toStringAsFixed(1) ?? '0'}% of visitors reached Google.',
      child: Column(
        children: [
          for (final step in data.funnel)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(step.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                      Text(formatCount(step.sessions), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: top == 0 ? 0 : step.sessions / top,
                      minHeight: 8,
                      backgroundColor: Brand.surfaceSunk,
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

class _QrTable extends ConsumerWidget {
  const _QrTable({required this.days});

  final int days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final to = DateTime.now();
    final rows = ref.watch(_qrRows((isoDate(to.subtract(Duration(days: days - 1))), isoDate(to))));
    return SectionCard(
      title: 'By QR code',
      child: rows.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Text(messageFor(error)),
        data: (rows) => rows.isEmpty
            ? const Text('No QR codes yet.', style: TextStyle(color: Brand.inkMuted))
            : Column(
                children: [
                  for (final row in rows)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(row.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(
                        '${formatCount(row.drafts)} drafts · ${formatCount(row.googleOpens)} to Google',
                      ),
                      trailing: Text(
                        '${formatCount(row.scans)} scans',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _LinksTable extends ConsumerWidget {
  const _LinksTable({required this.days});

  final int days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final to = DateTime.now();
    final rows = ref.watch(_linkRows((isoDate(to.subtract(Duration(days: days - 1))), isoDate(to))));
    return SectionCard(
      title: 'Button clicks on your page',
      child: rows.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Text(messageFor(error)),
        data: (rows) => rows.isEmpty
            ? const Text('No buttons yet.', style: TextStyle(color: Brand.inkMuted))
            : Column(
                children: [
                  for (final row in rows)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(row.label),
                      trailing: Text(
                        formatCount(row.clicks),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

final _qrRows = FutureProvider.family<List<QrAnalyticsRow>, (String, String)>(
  (ref, range) => ref.watch(repositoryProvider).analyticsQr(from: range.$1, to: range.$2),
);

final _linkRows = FutureProvider.family<List<LinkAnalyticsRow>, (String, String)>(
  (ref, range) => ref.watch(repositoryProvider).analyticsLinks(from: range.$1, to: range.$2),
);
