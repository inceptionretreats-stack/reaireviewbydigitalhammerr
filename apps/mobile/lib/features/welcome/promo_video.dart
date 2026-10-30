import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../core/config.dart';
import '../../core/theme.dart';

/// Lets a page pause its video when another screen is pushed on top of it.
final routeObserver = RouteObserver<ModalRoute<void>>();

/// The promotional video from the website's home page (PromoVideoSection), streamed from the
/// website itself so the two always show the same film. Like the website it does not autoplay:
/// the poster ships with the app and the video loads when the viewer taps play.
class PromoVideo extends StatefulWidget {
  const PromoVideo({super.key});

  static String get url => '${AppConfig.webBaseUrl}/marketing/ai-review-promo.mp4';

  @override
  State<PromoVideo> createState() => _PromoVideoState();
}

class _PromoVideoState extends State<PromoVideo> with RouteAware, WidgetsBindingObserver {
  VideoPlayerController? _controller;
  bool _loading = false;
  bool _failed = false;
  bool _showControls = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  // Sign-in or sign-up opened on top: stop the sound.
  @override
  void didPushNext() => _pause();

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _pause();
  }

  void _pause() {
    if (_controller?.value.isPlaying ?? false) {
      _controller!.pause();
      setState(() => _showControls = true);
    }
  }

  Future<void> _start() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final controller = VideoPlayerController.networkUrl(Uri.parse(PromoVideo.url));
    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(_onTick);
      // Loading takes a moment; if the viewer has since opened sign-in or left the app, have it
      // ready but do not start the sound behind their back.
      final visible =
          (ModalRoute.of(context)?.isCurrent ?? true) &&
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
      if (visible) await controller.play();
      setState(() {
        _controller = controller;
        _showControls = !visible;
      });
    } catch (_) {
      await controller.dispose();
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onTick() {
    final value = _controller!.value;
    // At the end, bring the controls back so "replay" is visible.
    if (!value.isPlaying && value.position >= value.duration && value.duration > Duration.zero) {
      if (!_showControls) setState(() => _showControls = true);
    }
  }

  void _togglePlay() {
    final controller = _controller;
    if (controller == null) {
      _start();
      return;
    }
    final value = controller.value;
    if (value.isPlaying) {
      controller.pause();
      setState(() => _showControls = true);
    } else {
      if (value.position >= value.duration) controller.seekTo(Duration.zero);
      controller.play();
      setState(() => _showControls = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final ready = controller != null && controller.value.isInitialized;

    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: AspectRatio(
        aspectRatio: ready ? controller.value.aspectRatio : 16 / 9,
        child: GestureDetector(
          onTap: ready ? () => setState(() => _showControls = !_showControls) : _togglePlay,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (ready)
                VideoPlayer(controller)
              else
                Image.asset(
                  'assets/images/promo-poster.jpg',
                  fit: BoxFit.cover,
                  semanticLabel: 'Ai Review promotional video',
                ),
              if (!ready || _showControls) const ColoredBox(color: Color(0x33000000)),
              if (_loading)
                const Center(child: CircularProgressIndicator(color: Colors.white))
              else if (_failed)
                _Failed(onRetry: _start)
              else if (!ready || _showControls)
                Center(
                  child: _PlayButton(controller: controller, onPressed: _togglePlay),
                ),
              if (ready && _showControls)
                Positioned(left: 0, right: 0, bottom: 0, child: _ControlBar(controller: controller)),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlayButton extends StatelessWidget {
  const _PlayButton({required this.controller, required this.onPressed});

  final VideoPlayerController? controller;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final value = controller?.value;
    final ended = value != null && value.duration > Duration.zero && value.position >= value.duration;
    final (icon, label) = value?.isPlaying ?? false
        ? (Icons.pause_rounded, 'Pause video')
        : ended
        ? (Icons.replay_rounded, 'Replay video')
        : (Icons.play_arrow_rounded, 'Play video');
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.white,
        shape: const CircleBorder(),
        elevation: 4,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Icon(icon, size: 40, color: Brand.accent),
          ),
        ),
      ),
    );
  }
}

class _ControlBar extends StatelessWidget {
  const _ControlBar({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 12, 4, 4),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0x99000000), Color(0x00000000)],
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: VideoProgressIndicator(
              controller,
              allowScrubbing: true,
              padding: const EdgeInsets.symmetric(vertical: 10),
              colors: const VideoProgressColors(
                playedColor: Colors.white,
                bufferedColor: Color(0x80FFFFFF),
                backgroundColor: Color(0x40FFFFFF),
              ),
            ),
          ),
          ValueListenableBuilder(
            valueListenable: controller,
            builder: (context, value, _) => IconButton(
              tooltip: value.volume == 0 ? 'Unmute' : 'Mute',
              color: Colors.white,
              icon: Icon(value.volume == 0 ? Icons.volume_off_rounded : Icons.volume_up_rounded),
              onPressed: () => controller.setVolume(value.volume == 0 ? 1 : 0),
            ),
          ),
        ],
      ),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            "Couldn't load the video.",
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          FilledButton.tonal(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    );
  }
}
