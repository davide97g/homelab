import SwiftUI

/// Smart (CLIP) search. Empty field: suggestion chips for people, places and categories.
struct SearchScreen: View {
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var submitted: String?
    @State private var results: AssetListStore?
    @State private var people: [Person] = []
    @State private var places: [Place] = []
    @State private var path = NavigationPath()

    private let categories: [(String, String)] = [
        ("Sunset", "sun.horizon"), ("Beach", "beach.umbrella"), ("Mountains", "mountain.2"),
        ("Food", "fork.knife"), ("Dog", "dog"), ("Snow", "snowflake"), ("City", "building.2"),
        ("Night", "moon.stars"), ("Documents", "doc.text"), ("Screenshots", "camera.viewfinder"),
    ]

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let results, submitted != nil {
                    resultsView(results)
                } else {
                    suggestions
                }
            }
            .navigationTitle("Search")
            .navigationDestination(for: Person.self) { p in
                TimelineGridScreen(title: p.name, query: .person(id: p.id))
            }
        }
        .searchable(text: $text, prompt: "Photos, People, Places…")
        .onSubmit(of: .search) { run(text) }
        .onChange(of: text) { _, new in
            if new.isEmpty { submitted = nil; results = nil }
        }
        .task {
            if people.isEmpty { people = (try? await app.service.people()) ?? [] }
            if places.isEmpty { places = (try? await app.service.places()) ?? [] }
            if let q = app.launch.searchQuery, submitted == nil {
                text = q
                run(q)
            }
        }
    }

    private func run(_ query: String) {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        submitted = q
        let service = app.service
        let store = AssetListStore { page in try await service.smartSearch(q, page: page) }
        results = store
        Task { await store.load() }
    }

    private func search(_ q: String) {
        text = q
        run(q)
    }

    // MARK: Suggestions

    private var suggestions: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !people.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("People").font(.title3.weight(.bold)).padding(.horizontal, 16)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 14) {
                                ForEach(people.prefix(12)) { p in
                                    NavigationLink(value: p) {
                                        VStack(spacing: 6) {
                                            AssetImage(personID: p.id)
                                                .frame(width: 64, height: 64)
                                                .clipShape(.circle)
                                            Text(p.name).font(.caption.weight(.medium)).lineLimit(1)
                                        }
                                        .frame(width: 70)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                if !places.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Places").font(.title3.weight(.bold)).padding(.horizontal, 16)
                        ChipFlow(items: places.prefix(14).map { ($0.name, "mappin.and.ellipse") }, onTap: search)
                            .padding(.horizontal, 16)
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("Categories").font(.title3.weight(.bold)).padding(.horizontal, 16)
                    ChipFlow(items: categories, onTap: search)
                        .padding(.horizontal, 16)
                }
                Text("Search understands what's in a photo (\"red car at night\", \"birthday cake\"), powered by Immich's smart search.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            }
            .padding(.vertical, 12)
        }
        .background(Theme.groupedBackground)
    }

    @ViewBuilder
    private func resultsView(_ store: AssetListStore) -> some View {
        if !store.hasLoaded || (store.isLoading && store.count == 0) {
            ProgressView("Searching…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.count == 0 {
            if let error = store.errorMessage {
                ContentUnavailableView("Search Failed", systemImage: "exclamationmark.magnifyingglass", description: Text(error))
            } else {
                ContentUnavailableView.search(text: submitted ?? "")
            }
        } else {
            ResultsGrid(store: store)
                .id(ObjectIdentifier(store))
        }
    }
}

private struct ResultsGrid: View {
    let store: AssetListStore
    @State private var grid = GridState(columns: 3)

    var body: some View {
        PhotoGrid(source: store, state: grid, startsAtBottom: false)
            .ignoresSafeArea(edges: .bottom)
            .background(Theme.gridBackground)
    }
}

/// Wrapping row of glass chips.
struct ChipFlow: View {
    let items: [(String, String)]
    var onTap: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.0) { item in
                Button { onTap(item.0) } label: {
                    Label(item.0, systemImage: item.1)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 360
        let rows = arrange(width: width, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for row in rows {
            for (i, x) in zip(row.indexes, row.xs) {
                subviews[i].place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + row.y), proposal: .unspecified)
            }
        }
    }

    private struct Row { var indexes: [Int] = []; var xs: [CGFloat] = []; var y: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        var x: CGFloat = 0
        for (i, s) in subviews.enumerated() {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width, !rows[rows.count - 1].indexes.isEmpty {
                let prev = rows[rows.count - 1]
                rows.append(Row(y: prev.y + prev.height + spacing))
                x = 0
            }
            rows[rows.count - 1].indexes.append(i)
            rows[rows.count - 1].xs.append(x)
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
            x += size.width + spacing
        }
        return rows
    }
}
