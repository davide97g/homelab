//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// One title from Discover. Watch when the library has it, Request when it does not (per season
// for a series), Withdraw while your own request still waits for an admin, and while it is on its
// way, where it is: downloading, copying to the NAS, and when it should be watchable.
//

#if os(iOS)
import SwiftUI

@MainActor
final class DiscoverItemViewModel: ObservableObject {

    let type: String
    let id: Int

    @Published
    private(set) var details: DiscoverDetails?
    @Published
    private(set) var related: [DiscoverResult] = []
    @Published
    private(set) var me: DiscoverMe?
    @Published
    private(set) var progress: TitleProgress?
    @Published
    var picked: Set<Int> = []
    @Published
    private(set) var isBusy = false
    @Published
    private(set) var message: String?
    @Published
    private(set) var error: String?

    init(type: String, id: Int) {
        self.type = type
        self.id = id
    }

    func load() async {
        guard details == nil, let client = DiscoverClient.current else { return }
        let (type, id) = (type, id)
        async let me = try? client.me()
        async let related = try? client.recommendations(type: type, id: id)
        do {
            let details = try await client.details(type: type, id: id)
            self.details = details
            picked = requestable(details)
        } catch {
            self.error = error.localizedDescription
        }
        self.me = await me
        self.related = await related ?? []
    }

    /// Seasons nobody has asked for yet: what a fresh season choice starts with.
    func requestable(_ details: DiscoverDetails) -> Set<Int> {
        let taken = discoverSeasonStandings(details.mediaInfo)
        return Set(details.realSeasons.map(\.seasonNumber).filter { taken[$0] == nil })
    }

    /// One look at the pipeline for this title. Once it has landed on the NAS, Seerr's details
    /// again, so Watch shows up by itself.
    func checkProgress() async {
        guard let client = DiscoverClient.current else { return }
        let key = DiscoverProgressKey.of(type, id)
        guard let titles = try? await client.progress(keys: [key]) else { return }
        progress = titles[key]
        if progress?.stage == "arrived", let fresh = try? await client.details(type: type, id: id) {
            details = fresh
        }
    }

    func request() async {
        guard let details, let client = DiscoverClient.current else { return }
        let seasons = type == "tv" ? picked.sorted() : nil
        if let seasons, seasons.isEmpty { return }
        isBusy = true
        message = nil
        do {
            try await client.request(type: type, id: id, seasons: seasons)
            message = "\(details.displayTitle) requested. "
                + (me?.autoApprove?.allows(type) == true
                    ? "It will show up in your library once it has downloaded."
                    : "It is waiting for an admin to approve it.")
        } catch {
            message = "Request failed: \(error.localizedDescription)"
        }
        await refresh(client)
    }

    func withdraw(_ requestID: Int) async {
        guard let client = DiscoverClient.current else { return }
        isBusy = true
        message = nil
        do {
            try await client.cancel(requestID: requestID)
            message = "Request withdrawn."
        } catch {
            message = "Could not withdraw it: \(error.localizedDescription)"
        }
        await refresh(client)
    }

    private func refresh(_ client: DiscoverClient) async {
        if let fresh = try? await client.details(type: type, id: id) {
            details = fresh
            picked = requestable(fresh)
        }
        isBusy = false
    }
}

struct DiscoverItemView: View {

    @Router
    private var router

    @StateObject
    private var viewModel: DiscoverItemViewModel

    init(type: String, id: Int) {
        _viewModel = StateObject(wrappedValue: DiscoverItemViewModel(type: type, id: id))
    }

    private var onItsWay: Bool {
        viewModel.details.map { discoverOnItsWay($0.mediaInfo) } ?? false
    }

    var body: some View {
        Group {
            if let details = viewModel.details {
                content(details)
            } else if let error = viewModel.error {
                Text(error)
                    .foregroundStyle(Color.cinemaMutedForeground)
                    .padding()
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.cinemaCanvas)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        // While it is on its way, ask the pipeline every 10 s; stops once Watch is there.
        .task(id: onItsWay) {
            while onItsWay, !Task.isCancelled {
                await viewModel.checkProgress()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func content(_ details: DiscoverDetails) -> some View {
        let type = viewModel.type
        let standing = DiscoverStanding(details.mediaInfo)
        let jellyfinID = details.mediaInfo?.jellyfinID
        let watchable = jellyfinID != nil && standing.here
        let seasons = discoverSeasonStandings(details.mediaInfo)
        let requestable = viewModel.requestable(details)
        let me = viewModel.me
        let canAsk = me?.canRequest?.allows(type) ?? false
        let askable = canAsk && (type == "tv" ? !requestable.isEmpty : standing == .none)
        let ownPending = details.mediaInfo?.requests?.first {
            $0.status == SeerrStatus.requestPending && $0.requestedBy?.id == me?.id
        }
        let showProgress = (discoverOnItsWay(details.mediaInfo) && standing != .partial) || viewModel.progress != nil

        return ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header(details, type: type, standing: standing)
                    .padding(.top, 160)

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        if watchable, let jellyfinID {
                            Button {
                                router.route(to: .item(id: jellyfinID))
                            } label: {
                                Label("Watch", systemImage: "play.fill")
                            }
                            .buttonStyle(CinemaActionStyle(primary: true))
                        }
                        if askable {
                            Button {
                                Task { await viewModel.request() }
                            } label: {
                                Label(requestTitle(type: type, requestable: requestable, taken: seasons), systemImage: "plus")
                            }
                            .buttonStyle(CinemaActionStyle(primary: !watchable))
                            .disabled(viewModel.isBusy || (type == "tv" && viewModel.picked.isEmpty))
                        }
                        if let ownPending {
                            Button {
                                Task { await viewModel.withdraw(ownPending.id) }
                            } label: {
                                Label("Withdraw request", systemImage: "xmark")
                            }
                            .buttonStyle(CinemaActionStyle(primary: false))
                            .disabled(viewModel.isBusy)
                        }
                    }
                    if me != nil, !canAsk, standing == .none {
                        Text("Your account cannot request \(type == "tv" ? "series" : "films").")
                            .font(.callout)
                            .foregroundStyle(Color.cinemaMutedForeground)
                    }
                    if let message = viewModel.message {
                        Text(message)
                            .font(.callout)
                    }
                    // A partly-there series shows it only while a season is actually moving.
                    if showProgress {
                        PipelineProgressView(standing: standing, progress: viewModel.progress)
                    }
                }

                if let overview = details.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.subheadline)
                        .foregroundStyle(Color.cinemaForeground.opacity(0.8))
                }

                if type == "tv", !details.realSeasons.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Seasons")
                            .font(.headline)
                            .padding(.bottom, 4)
                        ForEach(details.realSeasons, id: \.seasonNumber) { season in
                            SeasonRow(
                                season: season,
                                standing: seasons[season.seasonNumber],
                                selectable: askable,
                                picked: viewModel.picked.contains(season.seasonNumber)
                            ) {
                                if viewModel.picked.contains(season.seasonNumber) {
                                    viewModel.picked.remove(season.seasonNumber)
                                } else {
                                    viewModel.picked.insert(season.seasonNumber)
                                }
                            }
                        }
                    }
                }

                if let cast = details.credits?.cast?.compactMap(\.name), !cast.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Cast")
                            .font(.caption)
                            .foregroundStyle(Color.cinemaMutedForeground)
                        Text(cast.prefix(8).joined(separator: ", "))
                            .font(.subheadline)
                    }
                }
            }
            .padding(.horizontal)

            DiscoverRowView(title: "More like this", results: viewModel.related)
                .padding(.vertical, 24)
        }
        .background(alignment: .top) {
            backdrop(details)
        }
    }

    private func header(_ details: DiscoverDetails, type: String, standing: DiscoverStanding) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    Capsule()
                        .fill(Color.cinemaPrimary)
                        .frame(width: 3, height: 14)
                    Text(type == "tv" ? "SERIES" : "FILM")
                        .font(.caption.weight(.semibold))
                        .tracking(1.4)
                        .foregroundStyle(Color.cinemaForeground.opacity(0.7))
                }
                StandingBadge(standing: standing)
            }
            Text(details.displayTitle)
                .font(.largeTitle.weight(.bold))
                .lineLimit(3)
            if let tagline = details.tagline, !tagline.isEmpty {
                Text(tagline)
                    .font(.subheadline.italic())
                    .foregroundStyle(Color.cinemaForeground.opacity(0.6))
            }
            HStack(spacing: 10) {
                if let vote = details.voteAverage, vote > 0 {
                    Text(String(format: "%.1f TMDB", vote))
                        .foregroundStyle(Color.cinemaMatch)
                }
                Text(facts(details, type: type))
                    .foregroundStyle(Color.cinemaMutedForeground)
                    .lineLimit(1)
            }
            .font(.footnote.weight(.medium))
        }
    }

    private func backdrop(_ details: DiscoverDetails) -> some View {
        Color.clear
            .frame(height: 340)
            .overlay {
                if let url = tmdbImage(details.backdropPath, "w1280") {
                    AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear }
                }
            }
            .clipped()
            .overlay {
                LinearGradient(
                    stops: [
                        .init(color: Color.cinemaCanvas.opacity(0.2), location: 0),
                        .init(color: Color.cinemaCanvas.opacity(0.6), location: 0.5),
                        .init(color: Color.cinemaCanvas, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .ignoresSafeArea(edges: .top)
    }

    private func facts(_ details: DiscoverDetails, type: String) -> String {
        var out: [String] = []
        if let year = details.year { out.append(year) }
        if type == "tv" {
            if let n = details.numberOfSeasons { out.append(n == 1 ? "1 season" : "\(n) seasons") }
        } else if let m = details.runtime, m > 0 {
            out.append(m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m")
        }
        out += (details.genres ?? []).prefix(3).compactMap(\.name)
        return out.joined(separator: " · ")
    }

    private func requestTitle(type: String, requestable: Set<Int>, taken: [Int: DiscoverStanding]) -> String {
        if viewModel.isBusy { return "Requesting…" }
        if type != "tv" { return "Request" }
        let n = viewModel.picked.count
        if n == requestable.count, taken.isEmpty { return "Request series" }
        return n == 1 ? "Request 1 season" : "Request \(n) seasons"
    }
}

/// A season you can still ask for toggles; one already here or on its way just says so.
private struct SeasonRow: View {

    let season: DiscoverSeason
    let standing: DiscoverStanding?
    let selectable: Bool
    let picked: Bool
    let onToggle: () -> Void

    var body: some View {
        let free = standing == nil && selectable
        let checked = standing?.here == true || (free && picked)
        let fill: Color = standing?.here == true ? .cinemaMatch : (free && picked) ? .cinemaPrimary : .clear
        Button(action: onToggle) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: CinemaTokens.Radius.sm)
                    .fill(fill)
                    .overlay {
                        RoundedRectangle(cornerRadius: CinemaTokens.Radius.sm)
                            .strokeBorder(checked ? fill : Color.cinemaForeground.opacity(0.3))
                    }
                    .overlay {
                        if checked {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Color.cinemaForeground)
                        }
                    }
                    .frame(width: 18, height: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(season.name ?? "Season \(season.seasonNumber)")
                        .font(.subheadline.weight(.semibold))
                    Text(
                        [
                            season.episodeCount.map { $0 == 1 ? "1 episode" : "\($0) episodes" },
                            season.airDate.map { String($0.prefix(4)) },
                        ]
                        .compactMap(\.self)
                        .joined(separator: " · ")
                    )
                    .font(.caption)
                    .foregroundStyle(Color.cinemaMutedForeground)
                }
                Spacer()
                if let standing {
                    Text(standing == .processing ? "Downloading" : standing == .pending ? "Awaiting approval" : "In library")
                        .font(.caption)
                        .foregroundStyle(Color.cinemaMutedForeground)
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!free)
    }
}

private struct CinemaActionStyle: ButtonStyle {

    let primary: Bool

    @Environment(\.isEnabled)
    private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(primary ? Color.cinemaOnPrimary : Color.cinemaForeground)
            .background(
                primary ? Color.cinemaPrimary : Color.cinemaSurfaceRaised,
                in: RoundedRectangle(cornerRadius: CinemaTokens.Radius.lg)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
    }
}
#endif
