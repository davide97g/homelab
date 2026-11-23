import SwiftUI

/// Search with a sentence ("Marci eating at the beach last summer"): memories-search on the
/// server reads it (people, what's in the photo, place, dates) and runs Immich's smart search;
/// plain CLIP search when the server doesn't have it. Empty field: suggestion chips.
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
                PersonScreen(person: p)
            }
        }
        .searchable(text: $text, prompt: "Marci eating at the beach last summer…")
        .onSubmit(of: .search) { run(text) }
        .onChange(of: text) { _, new in
            if new.isEmpty { submitted = nil; results = nil }
        }
        .onChange(of: app.peopleVersion) {
            Task { if let p = try? await app.service.people() { people = p } }
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
                Text("Write it like you'd say it: \"Marci eating pizza in Naples\", \"videos at the beach in 2024\", \"Grandma's favorites last summer\". People need a name in Immich to be found.")
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
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let info = store.interpretation { InterpretationBar(info: info) }
                }
        }
    }
}

/// "Marci · eating · Rome · 06/2022": how the sentence was read, so a wrong guess is visible.
private struct InterpretationBar: View {
    let info: SearchInterpretation

    private var chips: [(String, String)] {
        var c: [(String, String)] = info.people.map { ($0.capitalized, "person.fill") }
        if !info.visual.isEmpty, !info.fallback { c.append((info.visual, "eye")) }
        if let place = info.place { c.append((place, "mappin.and.ellipse")) }
        if !info.when.isEmpty { c.append((info.when, "calendar")) }
        if info.media == "video" { c.append(("Videos", "video.fill")) }
        if info.media == "photo" { c.append(("Photos", "photo")) }
        if info.favorite { c.append(("Favorites", "heart.fill")) }
        return c
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chips, id: \.0) { chip in
                        Label(chip.0, systemImage: chip.1)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .frame(height: 28)
                            .glassEffect(.regular, in: .capsule)
                    }
                }
                .padding(.horizontal, 16)
            }
            if !info.missingPeople.isEmpty {
                Text("No one named \(info.missingPeople.map { "“\($0)”" }.joined(separator: ", ")) yet: name their face in People and search again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            } else if info.fallback {
                Text("Searched for the words as typed (the server's language model didn't answer).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 8)
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
