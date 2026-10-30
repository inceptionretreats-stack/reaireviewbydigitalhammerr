import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets/common.dart';
import 'customer_sheet.dart';
import 'requests_list.dart';

/// Customers (the website's CRM page) and the review requests sent to them.
class CustomersScreen extends StatelessWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Customers'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Contacts'),
              Tab(text: 'Review requests'),
            ],
          ),
        ),
        body: const TabBarView(children: [_ContactsTab(), RequestsList()]),
      ),
    );
  }
}

class _ContactsTab extends ConsumerStatefulWidget {
  const _ContactsTab();

  @override
  ConsumerState<_ContactsTab> createState() => _ContactsTabState();
}

class _ContactsTabState extends ConsumerState<_ContactsTab> with AutomaticKeepAliveClientMixin {
  final _search = TextEditingController();
  Timer? _debounce;
  final List<Customer> _customers = [];
  int _page = 0;
  int _totalPages = 1;
  int _total = 0;
  bool _loading = false;
  Object? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    _customers.clear();
    _page = 0;
    _totalPages = 1;
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _page >= _totalPages) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final query = _search.text.trim();
    try {
      final page = await ref.read(repositoryProvider).customers(query: query, page: _page + 1, perPage: 50);
      if (!mounted || query != _search.text.trim()) return;
      setState(() {
        _customers.addAll(page.customers);
        _page = page.page;
        _totalPages = page.totalPages;
        _total = page.total;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _reload);
  }

  Future<void> _edit([Customer? customer]) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => CustomerSheet(existing: customer),
    );
    if (changed == true) await _reload();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final canRequest = ref.watch(businessProvider).value?.isActive ?? false;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'add-customer',
        onPressed: () => _edit(),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Add customer'),
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            if (notification.metrics.extentAfter < 300) _loadMore();
            return false;
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
            children: [
              TextField(
                controller: _search,
                onChanged: _onSearch,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search by name, email or number',
                ),
              ),
              const SizedBox(height: 10),
              if (_customers.isNotEmpty)
                Text(
                  '${formatCount(_total)} ${_total == 1 ? 'customer' : 'customers'}',
                  style: const TextStyle(color: Brand.inkMuted),
                ),
              const SizedBox(height: 6),
              if (_error != null && _customers.isEmpty)
                ErrorState(message: messageFor(_error!), onRetry: _reload)
              else if (!_loading && _customers.isEmpty)
                EmptyState(
                  icon: Icons.people_outline,
                  title: _search.text.isEmpty ? 'No customers yet' : 'No matches',
                  message: _search.text.isEmpty
                      ? 'Add customers who visited, then send them a review request on WhatsApp.'
                      : null,
                )
              else
                for (final customer in _customers)
                  _CustomerTile(
                    customer: customer,
                    canRequest: canRequest,
                    onEdit: () => _edit(customer),
                    onRequest: () async {
                      await context.push('/request/${customer.id}');
                      _reload();
                    },
                  ),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(child: CircularProgressIndicator()),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CustomerTile extends StatelessWidget {
  const _CustomerTile({
    required this.customer,
    required this.canRequest,
    required this.onEdit,
    required this.onRequest,
  });

  final Customer customer;
  final bool canRequest;
  final VoidCallback onEdit;
  final VoidCallback onRequest;

  Tone get _tone => switch (customer.status) {
    'NOT_CONTACTED' => Tone.neutral,
    'MESSAGE_PREPARED' || 'MESSAGE_SENT_MANUAL' => Tone.accent,
    'PRIVATE_FEEDBACK' => Tone.warning,
    _ => Tone.success,
  };

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(Brand.radius + 4),
        onTap: onEdit,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: Brand.accentSoft,
                foregroundColor: Brand.accent,
                child: Text(customer.name.isEmpty ? '?' : customer.name[0].toUpperCase()),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(customer.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(
                      formatPhone(customer.mobile),
                      style: const TextStyle(color: Brand.inkMuted, fontSize: 13),
                    ),
                    const SizedBox(height: 6),
                    StatusChip(customer.statusLabel, tone: _tone),
                  ],
                ),
              ),
              IconButton(
                tooltip: canRequest ? 'Ask for a review' : 'Publish your page to send requests',
                onPressed: canRequest ? onRequest : null,
                icon: const Icon(Icons.send_outlined),
                color: Brand.accent,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
