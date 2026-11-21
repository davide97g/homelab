import SwiftUI

/// Full-screen, auto-advancing Ken Burns slideshow for a memory.
struct MemoryPlayerView: View {
    let memory: Memory
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var index = 0
    @State private var progress: Double = 0
    @State private var zoomed = false
    @State private var paused = false
    @State private var runID = UUID()

    private let slideDuration: Double = 4.5

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if memory.assets.indices.contains(index) {
                let asset = memory.assets[index]
                GeometryReader { geo in
                    AssetImage(asset, kind: .preview)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .scaleEffect(zoomed ? 1.18 : 1.02, anchor: index.isMultiple(of: 2) ? .topLeading : .bottomTrailing)
                        .clipped()
                }
                .ignoresSafeArea()
                .id(asset.id)
                .transition(.opacity)
            }
            LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            HStack(spacing: 0) {
                Color.clear.contentShape(.rect).onTapGesture { step(-1) }
                Color.clear.contentShape(.rect).onTapGesture { step(1) }
            }
            .onLongPressGesture(minimumDuration: 0.2, perform: {}, onPressingChanged: { pressing in paused = pressing })
            overlay
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .task(id: runID) { await play() }
    }

    private var overlay: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 3) {
                ForEach(memory.assets.indices, id: \.self) { i in
                    GeometryReader { geo in
                        Capsule().fill(.white.opacity(0.35))
                            .overlay(alignment: .leading) {
                                Capsule().fill(.white)
                                    .frame(width: geo.size.width * (i < index ? 1 : i == index ? progress : 0))
                            }
                    }
                    .frame(height: 3)
                }
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(memory.title)
                        .font(.title2.weight(.bold))
                    Text(subtitle)
                        .font(.subheadline.weight(.semibold))
                        .opacity(0.85)
                }
                .foregroundStyle(.white)
                .shadow(radius: 4)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Close")
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var subtitle: String {
        let place = memory.assets.lazy.compactMap(\.city).first
        return [String(memory.year), place].compactMap { $0 }.joined(separator: " · ")
    }

    private func step(_ delta: Int) {
        let next = index + delta
        if next >= memory.assets.count { dismiss(); return }
        withAnimation(.easeInOut(duration: 0.6)) { index = max(0, next) }
        runID = UUID()
    }

    private func play() async {
        // Warm the next preview so the cross-fade lands on a loaded image.
        progress = 0
        zoomed = false
        if index + 1 < memory.assets.count {
            let next = memory.assets[index + 1]
            app.pipeline.prefetch([ImageRequest(id: next.id, kind: .preview, thumbhash: next.thumbhash)])
        }
        try? await Task.sleep(for: .milliseconds(50))
        withAnimation(.linear(duration: slideDuration)) { zoomed = true }
        let tick = 0.05
        var elapsed = 0.0
        while elapsed < slideDuration {
            try? await Task.sleep(for: .seconds(tick))
            if Task.isCancelled { return }
            if paused { continue }
            elapsed += tick
            progress = min(1, elapsed / slideDuration)
        }
        step(1)
    }
}
