import SwiftUI

struct LibraryScreen: View {
    @Environment(AppModel.self) private var app
    @State private var grid = GridState()
    @State private var mode: LibraryMode = .all
    @State private var didApplyLaunch = false
    @State private var confirmDelete = false
    @Namespace private var segmentNS

    var body: some View {
        let library = app.library
        ZStack(alignment: .top) {
            Theme.gridBackground.ignoresSafeArea()
            switch mode {
            case .all:
                PhotoGrid(source: library, state: grid,
                          extraInsets: UIEdgeInsets(top: 56, left: 0, bottom: 56, right: 0))
                    .ignoresSafeArea()
            case .months:
                MonthsView(store: library) { bucket in
                    switchToAll(scrollTo: library.startIndex(ofBucket: bucket))
                }
            case .years:
                YearsView(store: library) { _ in
                    withAnimation(.snappy) { mode = .months }
                }
            }
            if mode == .all && library.hasLoaded && library.count == 0 {
                ContentUnavailableView("No Photos or Videos", systemImage: "photo.on.rectangle",
                                       description: Text("Photos you back up or upload to Immich appear here."))
                    .frame(maxHeight: .infinity)
            } else if let error = library.errorMessage, library.count == 0 {
                ContentUnavailableView {
                    Label("Can't Load Library", systemImage: "exclamationmark.icloud")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again") { Task { await library.reload() } }
                        .buttonStyle(.glass)
                }
                .frame(maxHeight: .infinity)
            }
            header
        }
        .overlay(alignment: .bottom) { bottomControls.padding(.bottom, 8) }
        .confirmationDialog("Delete \(grid.selection.count) Items", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                let ids = Array(grid.selection)
                grid.isSelecting = false
                Task { await app.trash(ids, in: library) }
            }
        } message: {
            Text("They move to Recently Deleted on the server.")
        }
        .task {
            guard !didApplyLaunch else { return }
            didApplyLaunch = true
            let l = app.launch
            if let c = l.columns { grid.columns = c }
            mode = l.libraryMode
            if l.selectMode { grid.isSelecting = true }
            await library.load()
            if l.openViewer, mode == .all { grid.openViewerRequest = max(0, library.count - 1) }
            if l.selectMode, library.count > 6 {
                // Pre-select a few recent items so the screenshot shows the state.
                library.ensureLoaded((library.count - 12)..<library.count)
                try? await Task.sleep(for: .milliseconds(600))
                grid.selection = Set(((library.count - 5)..<library.count).compactMap { library.asset(at: $0)?.id })
                grid.scrollToBottom(animated: false)
            }
        }
    }

    private func switchToAll(scrollTo index: Int) {
        withAnimation(.snappy) { mode = .all }
        Task {
            try? await Task.sleep(for: .milliseconds(50))
            grid.scroll(to: index)
        }
    }

    // MARK: Header

    private var header: some View {
        ZStack(alignment: .top) {
            // Scroll-edge style scrim: blur fading into the content.
            Rectangle()
                .fill(mode == .all ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(.regularMaterial))
                .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black.opacity(0.85), location: 0.55),
                                             .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
                .frame(height: 150)
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.system(size: 28, weight: .bold))
                        .tracking(0.3)
                        .contentTransition(.numericText())
                    if let subtitle {
                        Text(subtitle)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                .animation(.snappy, value: title)
                Spacer(minLength: 12)
                headerButtons
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
    }

    private var title: String {
        if grid.isSelecting {
            return grid.selection.isEmpty ? "Select Items" : "\(grid.selection.count) Selected"
        }
        switch mode {
        case .all:
            if let d = grid.topDate { return DateFormatting.monthYear(d) }
            return "Library"
        case .months, .years: return "Library"
        }
    }

    private var subtitle: String? {
        guard !grid.isSelecting else { return nil }
        if mode == .all {
            if grid.isAtBottom, app.library.count > 0 {
                return "\(app.library.count.formatted()) Items"
            }
            return grid.topPlace
        }
        return nil
    }

    private var headerButtons: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                if mode == .all {
                    Button(grid.isSelecting ? "Cancel" : "Select") {
                        withAnimation(.snappy) { grid.isSelecting.toggle() }
                    }
                    .font(.body.weight(.semibold))
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
                if !grid.isSelecting {
                    Menu {
                        if mode == .all {
                            Section {
                                Button("Zoom In", systemImage: "plus.magnifyingglass") { withAnimation { grid.zoom(in: true) } }
                                    .disabled(grid.columns == GridState.columnSteps.first)
                                Button("Zoom Out", systemImage: "minus.magnifyingglass") { withAnimation { grid.zoom(in: false) } }
                                    .disabled(grid.columns == GridState.columnSteps.last)
                                Button("Jump to Newest", systemImage: "arrow.down.to.line") { grid.scrollToBottom() }
                            }
                        }
                        Button("Refresh", systemImage: "arrow.clockwise") { Task { await app.library.reload() } }
                        Button("Settings & Backup", systemImage: "gearshape") { app.showSettings = true }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                }
            }
        }
    }

    // MARK: Bottom

    @ViewBuilder
    private var bottomControls: some View {
        if grid.isSelecting {
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    Button {
                        let ids = Array(grid.selection)
                        let allFav = ids.allSatisfy { id in app.library.index(of: id).flatMap { app.library.asset(at: $0)?.isFavorite } ?? false }
                        Task { await app.setFavorite(ids, !allFav, in: app.library) }
                        grid.isSelecting = false
                    } label: {
                        Image(systemName: "heart").frame(width: 48, height: 48)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Favorite")
                    Button {
                        let assets = grid.selection.compactMap { id in app.library.index(of: id).flatMap { app.library.asset(at: $0) } }
                        grid.isSelecting = false
                        app.saveToDevice(assets)
                    } label: {
                        Image(systemName: "arrow.down.to.line").frame(width: 48, height: 48)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Save to iPhone")
                    Text(grid.selection.isEmpty ? "Select Items" : "\(grid.selection.count) Selected")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 18)
                        .frame(height: 48)
                        .glassEffect(.regular, in: .capsule)
                    Button { confirmDelete = true } label: {
                        Image(systemName: "trash").frame(width: 48, height: 48)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Delete")
                }
                .buttonStyle(.plain)
                .font(.system(size: 18, weight: .medium))
                .disabled(grid.selection.isEmpty)
            }
        } else {
            segmented
        }
    }

    private var segmented: some View {
        HStack(spacing: 0) {
            ForEach(LibraryMode.allCases, id: \.self) { m in
                Button {
                    withAnimation(.snappy) { mode = m }
                } label: {
                    Text(m.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mode == m ? Color.primary : Color.secondary)
                        .padding(.horizontal, 18)
                        .frame(height: 36)
                        .background {
                            if mode == m {
                                Capsule()
                                    .fill(Color.primary.opacity(0.12))
                                    .matchedGeometryEffect(id: "segment", in: segmentNS)
                            }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Library view")
    }
}
