import MapKit
import SwiftUI

enum CollectionRoute: Hashable {
    case timeline(title: String, query: TimelineQuery)
    case metadata(MetadataQuery)
    case albums
    case people
    case places
    case memories
}

@MainActor
@Observable
final class CollectionsModel {
    var albums: [Album] = []
    var people: [Person] = []
    var memories: [Memory] = []
    var places: [Place] = []
    var favoritesCover: Asset?
    var recentCover: Asset?
    var videoCover: Asset?
    var loaded = false
    var error: String?

    func load(_ service: any MediaService) async {
        async let albums = try? service.albums()
        async let people = try? service.people()
        async let memories = try? service.memories(on: .now)
        async let places = try? service.places()
        async let favBuckets = try? service.timelineBuckets(.favorites)
        async let recent = try? service.metadataSearch(.recentlyAdded, page: 1)
        async let videos = try? service.metadataSearch(.videos, page: 1)
        self.albums = await albums ?? []
        self.people = await people ?? []
        self.memories = await memories ?? []
        self.places = await places ?? []
        self.recentCover = await recent?.assets.first
        self.videoCover = await videos?.assets.first
        if let last = await favBuckets?.last {
            favoritesCover = try? await service.timelineBucket(.favorites, bucket: last.timeBucket).last
        }
        loaded = true
    }
}

struct CollectionsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var model = CollectionsModel()
    @State private var path = NavigationPath()
    @State private var naming: Person?
    @State private var playingMemory: Memory?

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    pinned
                    albumsSection
                    peopleSection
                    memoriesSection
                    placesSection
                    mediaTypesSection
                    utilitiesSection
                }
                .padding(.vertical, 8)
                .padding(.bottom, 24)
            }
            .background(Theme.groupedBackground)
            .navigationTitle("Collections")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { app.showSettings = true } label: { AvatarView(name: app.user?.name) }
                        .accessibilityLabel("Settings & Backup")
                }
            }
            .navigationDestination(for: CollectionRoute.self) { route in
                destination(route)
            }
            .navigationDestination(for: Album.self) { album in
                TimelineGridScreen(title: album.name, query: .album(id: album.id))
            }
            .navigationDestination(for: Person.self) { person in
                PersonScreen(person: person)
            }
            .refreshable { await model.load(app.service) }
        }
        .task {
            guard !model.loaded else { return }
            await model.load(app.service)
            if app.launch.openMemory, let m = model.memories.first { playingMemory = m }
        }
        .onChange(of: app.peopleVersion) {
            Task { if let p = try? await app.service.people() { model.people = p } }
        }
        .sheet(item: $naming) { p in
            NamePersonSheet(person: p) { _ in }
                .environment(app)
        }
        .fullScreenCover(item: $playingMemory) { memory in
            MemoryPlayerView(memory: memory)
                .environment(app)
        }
    }

    @ViewBuilder
    private func destination(_ route: CollectionRoute) -> some View {
        switch route {
        case .timeline(let title, let query): TimelineGridScreen(title: title, query: query)
        case .metadata(let q): MetadataGridScreen(query: q)
        case .albums: AlbumsListView(albums: model.albums)
        case .people: PeopleListView(people: model.people, naming: $naming)
        case .places: PlacesMapView()
        case .memories: MemoriesListView(memories: model.memories) { playingMemory = $0 }
        }
    }

    // MARK: Sections

    private var pinned: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Pinned", route: nil)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    NavigationLink(value: CollectionRoute.timeline(title: "Favorites", query: .favorites)) {
                        PinnedTile(title: "Favorites", systemImage: "heart.fill", asset: model.favoritesCover)
                    }
                    NavigationLink(value: CollectionRoute.metadata(.recentlyAdded)) {
                        PinnedTile(title: "Recently Saved", systemImage: "clock.fill", asset: model.recentCover)
                    }
                    NavigationLink(value: CollectionRoute.places) {
                        PinnedMapTile(places: model.places)
                    }
                    NavigationLink(value: CollectionRoute.metadata(.videos)) {
                        PinnedTile(title: "Videos", systemImage: "video.fill", asset: model.videoCover)
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
            }
        }
    }

    private var albumsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Albums", route: .albums)
            if model.albums.isEmpty {
                EmptyRow(text: model.loaded ? "No albums yet" : nil)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHGrid(rows: [GridItem(.fixed(200), spacing: 14), GridItem(.fixed(200))], spacing: 12) {
                        ForEach(model.albums) { album in
                            NavigationLink(value: album) { AlbumCover(album: album, side: 150) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .frame(height: 414)
            }
        }
    }

    private var peopleSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "People & Pets", route: .people)
            if model.people.isEmpty {
                EmptyRow(text: model.loaded ? "Name faces in Immich to see them here" : nil)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(model.people) { p in
                            NavigationLink(value: p) {
                                VStack(spacing: 6) {
                                    AssetImage(personID: p.id)
                                        .frame(width: 84, height: 84)
                                        .clipShape(.circle)
                                    Text(p.name.isEmpty ? "Add Name" : p.name)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(p.name.isEmpty ? Theme.accent : .primary)
                                        .lineLimit(1)
                                }
                                .frame(width: 88)
                            }
                            .buttonStyle(.plain)
                            .personContextMenu(p, naming: $naming)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    private var memoriesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Memories", route: .memories)
            if model.memories.isEmpty {
                EmptyRow(text: model.loaded ? "No memories for today" : nil)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
                        ForEach(model.memories) { m in
                            Button { playingMemory = m } label: { MemoryCard(memory: m, width: 210) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    private var placesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Places", route: .places)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(model.places.prefix(12)) { place in
                        NavigationLink(value: CollectionRoute.places) {
                            AssetImage(place.asset)
                                .frame(width: 150, height: 150)
                                .overlay(alignment: .bottomLeading) {
                                    Text(place.name)
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(.white)
                                        .shadow(radius: 4)
                                        .padding(10)
                                }
                                .clipShape(.rect(cornerRadius: Theme.Radius.albumCover))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private var mediaTypesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Media Types", route: nil)
            ListCard {
                NavigationLink(value: CollectionRoute.metadata(.videos)) { ListRow(title: "Videos", systemImage: "video") }
                Divider().padding(.leading, 52)
                NavigationLink(value: CollectionRoute.metadata(.livePhotos)) { ListRow(title: "Live Photos", systemImage: "livephoto") }
            }
        }
    }

    private var utilitiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Utilities", route: nil)
            ListCard {
                NavigationLink(value: CollectionRoute.metadata(.recentlyAdded)) { ListRow(title: "Imports", systemImage: "square.and.arrow.down") }
                Divider().padding(.leading, 52)
                NavigationLink(value: CollectionRoute.timeline(title: "Archive", query: .archive)) { ListRow(title: "Archive", systemImage: "archivebox") }
                Divider().padding(.leading, 52)
                NavigationLink(value: CollectionRoute.timeline(title: "Recently Deleted", query: .trash)) {
                    ListRow(title: "Recently Deleted", systemImage: "trash")
                }
            }
        }
    }
}

// MARK: - Building blocks

struct SectionHeader: View {
    let title: String
    let route: CollectionRoute?

    var body: some View {
        Group {
            if let route {
                NavigationLink(value: route) { label(chevron: true) }
                    .buttonStyle(.plain)
            } else {
                label(chevron: false)
            }
        }
        .padding(.horizontal, 16)
    }

    private func label(chevron: Bool) -> some View {
        HStack(spacing: 4) {
            Text(title).font(.title3.weight(.bold))
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .contentShape(.rect)
    }
}

private struct EmptyRow: View {
    let text: String?
    var body: some View {
        Group {
            if let text {
                Text(text).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, minHeight: 60)
    }
}

struct PinnedTile: View {
    let title: String
    let systemImage: String
    let asset: Asset?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AssetImage(asset)
                .frame(width: 150, height: 150)
                .clipShape(.rect(cornerRadius: Theme.Radius.albumCover))
                .overlay(alignment: .bottomLeading) {
                    Image(systemName: systemImage)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .shadow(radius: 3)
                        .padding(10)
                }
            Text(title).font(.subheadline.weight(.medium))
        }
    }
}

struct PinnedMapTile: View {
    let places: [Place]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Map(initialPosition: .region(region), interactionModes: []) {
                ForEach(places.prefix(20)) { p in
                    if let c = p.asset.coordinate {
                        Annotation("", coordinate: c) {
                            Circle().fill(.blue).stroke(.white, lineWidth: 2).frame(width: 10, height: 10)
                        }
                    }
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .frame(width: 150, height: 150)
            .clipShape(.rect(cornerRadius: Theme.Radius.albumCover))
            .allowsHitTesting(false)
            Text("Map").font(.subheadline.weight(.medium))
        }
    }

    private var region: MKCoordinateRegion {
        let coords = places.compactMap(\.asset.coordinate)
        guard let first = coords.first else {
            return MKCoordinateRegion(center: .init(latitude: 45.46, longitude: 9.19), span: .init(latitudeDelta: 20, longitudeDelta: 20))
        }
        // Centre on where most places are; a world-wide span would show only ocean.
        return MKCoordinateRegion(center: first, span: .init(latitudeDelta: 14, longitudeDelta: 14))
    }
}

struct AlbumCover: View {
    let album: Album
    let side: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AssetImage(assetID: album.thumbnailAssetId)
                .frame(width: side, height: side)
                .clipShape(.rect(cornerRadius: Theme.Radius.albumCover))
            Text(album.name)
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            Text(album.assetCount.formatted())
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(width: side, alignment: .leading)
    }
}

struct MemoryCard: View {
    let memory: Memory
    let width: CGFloat

    var body: some View {
        AssetImage(memory.assets.first(where: \.isImage) ?? memory.assets.first, kind: .preview)
            .frame(width: width, height: width * 4 / 3)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(memory.title)
                        .font(.headline.weight(.bold))
                    Text(String(memory.year))
                        .font(.subheadline.weight(.semibold))
                        .opacity(0.9)
                }
                .foregroundStyle(.white)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(alignment: .bottom) {
                    LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                        .frame(height: 120)
                }
            }
            .clipShape(.rect(cornerRadius: Theme.Radius.card))
    }
}

struct ListCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .buttonStyle(.plain)
            .background(Theme.card, in: .rect(cornerRadius: Theme.Radius.card))
            .padding(.horizontal, 16)
    }
}

struct ListRow: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 18))
                .foregroundStyle(Theme.accent)
                .frame(width: 24)
            Text(title)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .contentShape(.rect)
    }
}

struct AvatarView: View {
    let name: String?
    var body: some View {
        Text(String((name ?? "?").prefix(1)).uppercased())
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(LinearGradient(colors: [Color(hex: 0xF5A35C), Color(hex: 0xD9467A)], startPoint: .topLeading, endPoint: .bottomTrailing), in: .circle)
    }
}
