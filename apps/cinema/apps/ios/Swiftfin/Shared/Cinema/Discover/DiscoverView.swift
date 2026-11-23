//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The Discover tab: everything that is not in the library yet, TMDB through Seerr, with a
// Request button where the library has a Play button. "Your requests" first, so "did my request
// go through?" has an answer on the screen, with each one's download and NAS-copy progress.
//

#if os(iOS)
import SwiftUI

struct LoadedRow: Identifiable {
    let row: DiscoverRow
    let results: [DiscoverResult]

    var id: String { row.rawValue }
}

@MainActor
final class DiscoverViewModel: ObservableObject {

    @Published
    private(set) var requests: [DiscoverResult] = []
    @Published
    private(set) var rows: [LoadedRow] = []
    /// By progress key, for the requests still on their way.
    @Published
    private(set) var progress: [String: TitleProgress] = [:]
    @Published
    private(set) var results: [DiscoverResult]?
    @Published
    private(set) var isLoading = false
    @Published
    private(set) var error: String?

    /// Called on every visit, so a request made a minute ago shows up; old rows stay meanwhile.
    func load() async {
        guard let client = DiscoverClient.current else { return }
        isLoading = true
        defer { isLoading = false }
        // The first call answers for all of them: no Seerr, no Discover.
        let trending: [DiscoverResult]
        do {
            trending = try await client.row(.trending)
        } catch {
            self.error = error.localizedDescription
            return
        }
        error = nil
        async let mine = Self.myRequests(client)
        var others: [(DiscoverRow, [DiscoverResult])] = []
        await withTaskGroup(of: (DiscoverRow, [DiscoverResult]).self) { group in
            for row in DiscoverRow.allCases.dropFirst() {
                group.addTask { (row, (try? await client.row(row)) ?? []) }
            }
            for await pair in group { others.append(pair) }
        }
        let order = DiscoverRow.allCases
        others.sort { order.firstIndex(of: $0.0)! < order.firstIndex(of: $1.0)! }
        requests = await mine
        rows = ([(.trending, trending)] + others).map { LoadedRow(row: $0.0, results: $0.1) }
    }

    /// Seerr's request list has no titles or art: each one asks for its own details.
    private nonisolated static func myRequests(_ client: DiscoverClient) async -> [DiscoverResult] {
        let list = (try? await client.myRequests()) ?? []
        var seen = Set<String>()
        let wanted: [(String, Int)] = list.compactMap { r in
            guard let id = r.media?.tmdbId else { return nil }
            let type = r.type ?? "movie"
            return seen.insert("\(type):\(id)").inserted ? (type, id) : nil
        }
        return await withTaskGroup(of: (Int, DiscoverResult?).self) { group in
            for (i, (type, id)) in wanted.enumerated() {
                group.addTask { (i, try? await client.details(type: type, id: id).asResult(type: type)) }
            }
            var out: [(Int, DiscoverResult)] = []
            for await (i, r) in group { if let r { out.append((i, r)) } }
            return out.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    /// One look at the pipeline for your requests still on their way. Returns whether anything
    /// is moving, so the caller can poll faster.
    func checkProgress() async -> Bool {
        guard let client = DiscoverClient.current else { return false }
        let keys = requests.filter { discoverOnItsWay($0.mediaInfo) }.map(\.key)
        guard !keys.isEmpty, let titles = try? await client.progress(keys: keys) else { return false }
        progress = titles
        return titles.values.contains { $0.stage != "arrived" }
    }

    func search(_ term: String) async {
        let term = term.trimmingCharacters(in: .whitespaces)
        guard term.count >= 2, let client = DiscoverClient.current else {
            results = nil
            return
        }
        // Debounce: typing cancels the task before this runs.
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        let found = (try? await client.search(term)) ?? []
        guard !Task.isCancelled else { return }
        results = found
    }
}

struct DiscoverView: View {

    @StateObject
    private var viewModel = DiscoverViewModel()
    @State
    private var term = ""

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if let results = viewModel.results {
                    if results.isEmpty {
                        Text("Nothing on TMDB by that name.")
                            .foregroundStyle(Color.cinemaMutedForeground)
                            .padding(.horizontal)
                    } else {
                        DiscoverGrid(results: results)
                    }
                } else if let error = viewModel.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Discover is not available right now")
                            .font(.title3.weight(.semibold))
                        Text(error)
                            .foregroundStyle(Color.cinemaMutedForeground)
                    }
                    .padding(.horizontal)
                } else {
                    if !viewModel.requests.isEmpty {
                        DiscoverRowView(title: "Your requests", results: viewModel.requests, progress: viewModel.progress)
                    }
                    ForEach(viewModel.rows) { loaded in
                        DiscoverRowView(title: loaded.row.title, results: loaded.results)
                    }
                }
            }
            .padding(.vertical)
        }
        .overlay {
            if viewModel.isLoading && viewModel.rows.isEmpty && viewModel.error == nil {
                ProgressView()
            }
        }
        .background(Color.cinemaCanvas)
        .navigationTitle("Discover")
        .searchable(text: $term, prompt: "Films and series on TMDB")
        .task(id: term) { await viewModel.search(term) }
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
        // Your requests' progress: every 10 s while something moves, else every minute.
        .task(id: viewModel.requests.map(\.key)) {
            while !Task.isCancelled {
                let moving = await viewModel.checkProgress()
                try? await Task.sleep(for: .seconds(moving ? 10 : 60))
            }
        }
    }
}

struct DiscoverRowView: View {

    let title: String
    let results: [DiscoverResult]
    var progress: [String: TitleProgress] = [:]

    var body: some View {
        if !results.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .padding(.horizontal)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(results, id: \.key) { result in
                            DiscoverCard(result: result, progress: progress[result.key])
                                .frame(width: 120)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}

private struct DiscoverGrid: View {

    let results: [DiscoverResult]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 12, alignment: .top)], spacing: 18) {
            ForEach(results, id: \.key) { DiscoverCard(result: $0, progress: nil) }
        }
        .padding(.horizontal)
    }
}

/// Looks like a library card on purpose, and adds the one thing a library card never needs:
/// whether it is here, on its way, or not asked for.
struct DiscoverCard: View {

    @Router
    private var router

    let result: DiscoverResult
    let progress: TitleProgress?

    var body: some View {
        Button {
            router.route(to: .discoverItem(type: result.type, id: result.id))
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Color.cinemaSurface
                    .aspectRatio(2 / 3, contentMode: .fit)
                    .overlay {
                        if let poster = tmdbImage(result.posterPath, "w342") {
                            AsyncImage(url: poster) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                Color.cinemaSurface
                            }
                        } else {
                            Text(result.displayTitle)
                                .font(.caption)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(Color.cinemaMutedForeground)
                                .padding(8)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        StandingBadge(standing: DiscoverStanding(result.mediaInfo))
                            .padding(6)
                    }
                    .overlay(alignment: .bottom) {
                        ProgressSliver(progress: progress)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: CinemaTokens.Radius.xl))
                Text(result.displayTitle)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(2)
                    .foregroundStyle(Color.cinemaForeground)
                Text([result.type == "tv" ? "Series" : "Film", result.year].compactMap(\.self).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Color.cinemaMutedForeground)
            }
        }
        .buttonStyle(.plain)
    }
}

/// Nothing for a title nobody asked for: the badge is news, not a default.
struct StandingBadge: View {

    let standing: DiscoverStanding

    var body: some View {
        if let label = standing.label {
            HStack(spacing: 5) {
                Circle()
                    .fill(standing.here ? Color.cinemaMatch : standing == .blocked ? Color.cinemaMutedForeground : Color.cinemaAmber)
                    .frame(width: 6, height: 6)
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.cinemaForeground)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.cinemaCanvas.opacity(0.75), in: Capsule())
        }
    }
}

extension NavigationRoute {

    @MainActor
    static func discoverItem(type: String, id: Int) -> NavigationRoute {
        NavigationRoute(id: "discover-\(type)-\(id)") {
            DiscoverItemView(type: type, id: id)
        }
    }
}
#endif
