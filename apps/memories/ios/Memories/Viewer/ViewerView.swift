import SwiftUI

/// Full-screen viewer, presented from a grid cell with UIKit's zoom transition (which also gives
/// the interactive swipe-down dismiss back into the cell).
struct ViewerView: View {
    @Bindable var model: ViewerModel
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            pager
                .ignoresSafeArea()
            if model.chromeVisible {
                chrome
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.chromeVisible)
        .statusBarHidden(!model.chromeVisible)
        .persistentSystemOverlays(model.chromeVisible ? .automatic : .hidden)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $model.showInfo) {
            if let asset = model.current {
                InfoSheet(asset: asset, model: model)
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .environment(app)
            }
        }
        .confirmationDialog(
            model.current?.isVideo == true ? "Delete Video" : "Delete Photo",
            isPresented: $model.confirmDelete, titleVisibility: .hidden
        ) {
            Button(model.current?.isVideo == true ? "Delete Video" : "Delete Photo", role: .destructive) {
                model.deleteCurrent()
            }
        } message: {
            Text("It moves to Recently Deleted on the server.")
        }
        .onChange(of: model.scrollID) { _, id in model.didScroll(to: id) }
        .task {
            if app.launch.openInfo { model.showInfo = true }
        }
    }

    // MARK: Pager

    private var pager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(0..<model.count, id: \.self) { i in
                    page(i)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $model.scrollID)
        .scrollIndicators(.hidden)
        .scrollDisabled(model.isZoomed)
    }

    @ViewBuilder
    private func page(_ i: Int) -> some View {
        if let asset = model.asset(at: i) {
            if asset.isVideo {
                VideoPage(asset: asset, isCurrent: i == model.currentIndex, model: model)
            } else {
                ZStack {
                    ZoomableImageView(
                        asset: asset, pipeline: app.pipeline, isCurrent: i == model.currentIndex,
                        onTap: { model.toggleChrome() },
                        onZoomChange: { zoomed in if i == model.currentIndex { model.isZoomed = zoomed } },
                        onLongPress: { pressed in
                            if asset.isLivePhoto && i == model.currentIndex { model.livePlaying = pressed }
                        })
                    if model.livePlaying, i == model.currentIndex, let live = asset.livePhotoVideoId {
                        if let src = app.service.playback(for: live) {
                            LivePhotoPlayerView(source: src) { model.livePlaying = false }
                                .allowsHitTesting(false)
                        }
                    }
                }
                // Mock mode has no motion files: a gentle "breath" stands in for playback.
                .scaleEffect(model.livePlaying && i == model.currentIndex && app.service.isMock ? 1.04 : 1)
                .animation(.easeInOut(duration: 0.6), value: model.livePlaying)
            }
        } else {
            ProgressView()
                .tint(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onAppear { model.source.ensureLoaded(max(0, i - 2)..<min(model.count, i + 3)) }
        }
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer()
            if model.livePlaying {
                Text("LIVE")
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.bottom, 8)
            }
            Filmstrip(model: model)
                .padding(.bottom, 10)
            bottomBar
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private var topBar: some View {
        HStack(alignment: .center) {
            Button { model.close() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Back")

            Spacer()
            if let a = model.current {
                VStack(spacing: 1) {
                    Text(DateFormatting.dayMonthYear(a.localDate))
                        .font(.subheadline.weight(.semibold))
                    Text([DateFormatting.time(a.localDate), a.place].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .padding(.horizontal, 14).padding(.vertical, 6)
                .glassEffect(.regular, in: .capsule)
            }
            Spacer()

            Menu {
                if let a = model.current {
                    if a.isLivePhoto {
                        Button("Play Live Photo", systemImage: "livephoto.play") { model.livePlaying = true }
                    }
                    Button(a.isFavorite ? "Unfavorite" : "Favorite", systemImage: a.isFavorite ? "heart.slash" : "heart") {
                        model.toggleFavorite()
                    }
                    Button("Show Info", systemImage: "info.circle") { model.showInfo = true }
                    Section {
                        if app.spaceSaver.isOnDevice(a.id) {
                            Label("On This iPhone", systemImage: "iphone")
                        } else if app.spaceSaver.saving.contains(a.id) {
                            Label("Downloading…", systemImage: "arrow.down.circle.dotted")
                        } else {
                            Button("Save to iPhone", systemImage: "arrow.down.to.line") { app.saveToDevice([a]) }
                        }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
        }
        .foregroundStyle(.white)
    }

    private var bottomBar: some View {
        GlassEffectContainer(spacing: 12) {
            HStack {
                if let a = model.current {
                    ShareLink(item: SharedOriginal(asset: a, service: app.service),
                              preview: SharePreview(a.isVideo ? "Video" : "Photo", image: Image(systemName: a.isVideo ? "video" : "photo"))) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 18, weight: .medium))
                            .frame(width: 48, height: 48)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Share")
                }
                Spacer()
                HStack(spacing: 4) {
                    Button { model.toggleFavorite() } label: {
                        Image(systemName: model.current?.isFavorite == true ? "heart.fill" : "heart")
                            .font(.system(size: 18, weight: .medium))
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 52, height: 48)
                    }
                    .accessibilityLabel("Favorite")
                    Button { model.showInfo = true } label: {
                        Image(systemName: "info.circle")
                            .font(.system(size: 18, weight: .medium))
                            .frame(width: 52, height: 48)
                    }
                    .accessibilityLabel("Info")
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
                .glassEffect(.regular.interactive(), in: .capsule)
                Spacer()
                Button { model.confirmDelete = true } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Delete")
            }
        }
        .foregroundStyle(.white)
    }
}

/// Neighbouring thumbnails; the current one is wider, like the system viewer's scrubber.
private struct Filmstrip: View {
    let model: ViewerModel
    private let window = 30

    var body: some View {
        let lo = max(0, model.currentIndex - window)
        let hi = min(model.count, model.currentIndex + window + 1)
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 2) {
                    ForEach(lo..<hi, id: \.self) { i in
                        let current = i == model.currentIndex
                        AssetImage(model.asset(at: i))
                            .frame(width: current ? 44 : 26, height: 40)
                            .clipShape(.rect(cornerRadius: current ? 4 : 2))
                            .padding(.horizontal, current ? 4 : 0)
                            .id(i)
                            .onTapGesture { withAnimation(.snappy) { model.scrollID = i } }
                    }
                }
                .padding(.horizontal, 200)
            }
            .frame(height: 40)
            .onAppear { proxy.scrollTo(model.currentIndex, anchor: .center) }
            .onChange(of: model.currentIndex) { _, i in
                withAnimation(.snappy) { proxy.scrollTo(i, anchor: .center) }
            }
        }
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12),
                                     .init(color: .black, location: 0.88), .init(color: .clear, location: 1)],
                             startPoint: .leading, endPoint: .trailing))
    }
}
