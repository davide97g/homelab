import MapKit
import SwiftUI

/// Album / person / favorites / trash / archive: a timeline-backed grid under a nav bar.
struct TimelineGridScreen: View {
    let title: String
    let query: TimelineQuery
    @Environment(AppModel.self) private var app
    @State private var store: TimelineStore?

    var body: some View {
        Group {
            if let store {
                AssetGridScreen(title: title, source: store, isTrash: query == .trash, startsAtBottom: true,
                                isEmpty: store.hasLoaded && store.count == 0)
            } else {
                ProgressView()
            }
        }
        .task {
            if store == nil { store = TimelineStore(query: query, service: app.service) }
        }
    }
}

/// Media types and "Recently Saved": paged metadata search.
struct MetadataGridScreen: View {
    let query: MetadataQuery
    @Environment(AppModel.self) private var app
    @State private var store: AssetListStore?

    var body: some View {
        Group {
            if let store {
                AssetGridScreen(title: query.title, source: store, isTrash: false, startsAtBottom: false,
                                isEmpty: store.hasLoaded && store.count == 0)
            } else {
                ProgressView()
            }
        }
        .task {
            guard store == nil else { return }
            let service = app.service
            let q = query
            store = AssetListStore { page in try await service.metadataSearch(q, page: page) }
        }
    }
}

struct AssetGridScreen: View {
    let title: String
    let source: any AssetSource
    let isTrash: Bool
    let startsAtBottom: Bool
    let isEmpty: Bool
    @Environment(AppModel.self) private var app
    @State private var grid = GridState(columns: 3)

    var body: some View {
        PhotoGrid(source: source, state: grid, extraInsets: UIEdgeInsets(top: 0, left: 0, bottom: grid.isSelecting ? 70 : 0, right: 0),
                  startsAtBottom: startsAtBottom)
            .ignoresSafeArea()
            .background(Theme.gridBackground)
            .overlay {
                if isEmpty {
                    ContentUnavailableView(isTrash ? "No Recently Deleted Items" : "Nothing Here Yet",
                                           systemImage: isTrash ? "trash" : "photo.on.rectangle")
                }
            }
            .navigationTitle(grid.isSelecting ? (grid.selection.isEmpty ? "Select Items" : "\(grid.selection.count) Selected") : title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(grid.isSelecting ? "Cancel" : "Select") { grid.isSelecting.toggle() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if grid.isSelecting {
                    HStack(spacing: 12) {
                        if isTrash {
                            Button("Restore") {
                                let ids = Array(grid.selection)
                                grid.isSelecting = false
                                Task { await app.restore(ids, in: source) }
                            }
                            .buttonStyle(.glassProminent)
                        } else {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                let ids = Array(grid.selection)
                                grid.isSelecting = false
                                Task { await app.trash(ids, in: source) }
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .disabled(grid.selection.isEmpty)
                    .padding(.bottom, 8)
                }
            }
            .toolbarVisibility(.hidden, for: .tabBar)
    }
}

// MARK: - Lists

struct AlbumsListView: View {
    let albums: [Album]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible())], spacing: 18) {
                ForEach(albums) { album in
                    NavigationLink(value: album) {
                        GeometryReader { geo in
                            AlbumCover(album: album, side: geo.size.width)
                        }
                        .aspectRatio(0.8, contentMode: .fit)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Theme.groupedBackground)
        .navigationTitle("Albums")
    }
}

struct PeopleListView: View {
    let people: [Person]
    @Binding var naming: Person?

    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 18) {
                ForEach(people) { p in
                    NavigationLink(value: p) {
                        VStack(spacing: 6) {
                            AssetImage(personID: p.id)
                                .aspectRatio(1, contentMode: .fit)
                                .clipShape(.circle)
                            Text(p.name.isEmpty ? "Add Name" : p.name)
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(p.name.isEmpty ? Theme.accent : .primary)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .personContextMenu(p, naming: $naming)
                }
            }
            .padding(16)
        }
        .background(Theme.groupedBackground)
        .navigationTitle("People & Pets")
        .safeAreaInset(edge: .top, spacing: 0) {
            if people.contains(where: { $0.name.isEmpty }) {
                Text("Tap a face, or touch and hold it, to add a name. Named people can be searched: \"foto di Marci al mare\".")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.bar)
            }
        }
    }
}

struct MemoriesListView: View {
    let memories: [Memory]
    var onPlay: (Memory) -> Void

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())], spacing: 12) {
                ForEach(memories) { m in
                    Button { onPlay(m) } label: {
                        GeometryReader { geo in MemoryCard(memory: m, width: geo.size.width) }
                            .aspectRatio(3.0 / 4.0, contentMode: .fit)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Theme.groupedBackground)
        .navigationTitle("Memories")
    }
}

// MARK: - Places

/// Map of everything with GPS, clustered by rounding coordinates (the marker list can be 50k).
struct PlacesMapView: View {
    @Environment(AppModel.self) private var app
    @State private var clusters: [Cluster] = []
    @State private var position: MapCameraPosition = .automatic
    @State private var selected: Cluster?

    struct Cluster: Identifiable, Hashable {
        let id: String
        let coordinate: CLLocationCoordinate2D
        let assetIDs: [String]
        let title: String?
        static func == (a: Cluster, b: Cluster) -> Bool { a.id == b.id }
        func hash(into h: inout Hasher) { h.combine(id) }
    }

    var body: some View {
        Map(position: $position) {
            ForEach(clusters) { c in
                Annotation(c.title ?? "", coordinate: c.coordinate) {
                    Button { selected = c } label: {
                        AssetImage(assetID: c.assetIDs.last)
                            .frame(width: 48, height: 48)
                            .clipShape(.rect(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.white, lineWidth: 2.5))
                            .overlay(alignment: .topTrailing) {
                                Text(c.assetIDs.count.formatted())
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5).padding(.vertical, 1)
                                    .background(.blue, in: .capsule)
                                    .offset(x: 8, y: -8)
                            }
                            .shadow(radius: 3)
                    }
                    .buttonStyle(.plain)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
        .navigationTitle("Places")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        .task {
            guard clusters.isEmpty, let markers = try? await app.service.mapMarkers() else { return }
            clusters = Self.cluster(markers, cellDegrees: 0.5)
        }
        .sheet(item: $selected) { c in
            NavigationStack {
                ClusterGrid(cluster: c)
            }
            .environment(app)
            .presentationDetents([.medium, .large])
        }
    }

    static func cluster(_ markers: [MapMarker], cellDegrees: Double) -> [Cluster] {
        var cells: [String: (lat: Double, lon: Double, ids: [String], city: String?)] = [:]
        for m in markers {
            let key = "\(Int((m.latitude / cellDegrees).rounded(.down)))/\(Int((m.longitude / cellDegrees).rounded(.down)))"
            var c = cells[key] ?? (0, 0, [], m.city)
            c.lat += m.latitude
            c.lon += m.longitude
            c.ids.append(m.id)
            cells[key] = c
        }
        return cells.map { key, c in
            Cluster(id: key, coordinate: .init(latitude: c.lat / Double(c.ids.count), longitude: c.lon / Double(c.ids.count)),
                    assetIDs: c.ids, title: c.city)
        }
    }
}

private struct ClusterGrid: View {
    let cluster: PlacesMapView.Cluster
    @Environment(AppModel.self) private var app
    @State private var store: AssetListStore?

    var body: some View {
        Group {
            if let store {
                AssetGridScreen(title: cluster.title ?? "Photos", source: store, isTrash: false, startsAtBottom: true, isEmpty: false)
            }
        }
        .task {
            guard store == nil else { return }
            let service = app.service
            let ids = Array(cluster.assetIDs.suffix(120))
            // Markers carry only ids: fetch details in small parallel batches.
            store = AssetListStore(newestAtBottom: true) { _ in
                var assets: [Asset] = []
                for chunk in stride(from: 0, to: ids.count, by: 24).map({ Array(ids[$0..<min(ids.count, $0 + 24)]) }) {
                    let part = await withTaskGroup(of: Asset?.self) { group in
                        for id in chunk { group.addTask { try? await service.assetDetail(id: id).asset } }
                        var out: [Asset] = []
                        for await a in group { if let a { out.append(a) } }
                        return out
                    }
                    assets += part
                }
                return SearchPage(assets: assets.sorted { $0.fileCreatedAt < $1.fileCreatedAt }, nextPage: nil)
            }
        }
    }
}
