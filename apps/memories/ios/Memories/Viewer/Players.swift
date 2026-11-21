import AVFoundation
import AVKit
import SwiftUI

extension PlaybackSource {
    func makePlayer() -> AVPlayer {
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        return AVPlayer(playerItem: item)
    }
}

/// Video page: poster until it becomes the current page, then native AVKit controls.
struct VideoPage: View {
    let asset: Asset
    let isCurrent: Bool
    let model: ViewerModel
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            AssetImage(asset, kind: .preview, contentMode: .fit)
                .aspectRatio(asset.ratio, contentMode: .fit)
            if let player {
                VideoPlayer(player: player)
                    .aspectRatio(asset.ratio, contentMode: .fit)
            } else if model.app.service.playback(for: asset.id) == nil {
                VStack(spacing: 8) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 28, weight: .semibold))
                        .frame(width: 72, height: 72)
                        .glassEffect(.regular, in: .circle)
                    Text("Playback needs a server")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.8))
                        .shadow(radius: 3)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(.rect)
        .onTapGesture { model.toggleChrome() }
        .onChange(of: isCurrent, initial: true) { _, current in
            if current {
                if player == nil {
                    Task {
                        // The copy on this iPhone plays offline and at full quality.
                        if let localId = model.app.backup.index.localId(for: asset.id),
                           let item = await LocalPhotos.playerItem(localId) {
                            player = AVPlayer(playerItem: item)
                        } else if let src = model.app.service.playback(for: asset.id) {
                            player = src.makePlayer()
                        }
                        if isCurrent { player?.play() }
                    }
                } else {
                    player?.play()
                }
            } else {
                player?.pause()
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}

/// Plays a live photo's motion part while the user presses and holds.
struct LivePhotoPlayerView: UIViewRepresentable {
    let source: PlaybackSource
    var onEnd: () -> Void

    func makeUIView(context: Context) -> PlayerLayerView {
        let v = PlayerLayerView()
        let player = source.makePlayer()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspect
        v.endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: player.currentItem, queue: .main) { _ in
            MainActor.assumeIsolated { onEnd() }
        }
        player.play()
        return v
    }

    func updateUIView(_ uiView: PlayerLayerView, context: Context) {}

    static func dismantleUIView(_ v: PlayerLayerView, coordinator: ()) {
        v.playerLayer.player?.pause()
        if let o = v.endObserver { NotificationCenter.default.removeObserver(o) }
    }
}

final class PlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    var endObserver: (any NSObjectProtocol)?
}
