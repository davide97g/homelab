//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The parts of Seerr's API that Discover reads, as accounts relays them (apps/accounts,
// /api/discover), and the mini PC's download and NAS-copy progress. Seerr answers in the
// server's locale, Italian, and leaves out what it does not know: every field is optional.
// apps/web has the same shapes in src/lib/discover/types.ts.
//

import Foundation

struct DiscoverPage<T: Decodable & Sendable>: Decodable, Sendable {
    var results: [T]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        results = try c.decodeIfPresent([T].self, forKey: .results) ?? []
    }

    enum CodingKeys: String, CodingKey { case results }
}

struct DiscoverSeasonStatus: Decodable, Sendable, Hashable {
    var seasonNumber: Int?
    var status: Int?
}

struct DiscoverRequestedBy: Decodable, Sendable, Hashable {
    var id: Int?
}

struct DiscoverRequest: Decodable, Sendable, Hashable {
    var id: Int
    var status: Int?
    var type: String?
    var seasons: [DiscoverSeasonStatus]?
    var media: DiscoverMediaInfo?
    var requestedBy: DiscoverRequestedBy?
}

struct DiscoverMediaInfo: Decodable, Sendable, Hashable {
    var tmdbId: Int?
    var status: Int?
    /// The NAS Jellyfin's item id once it is there, 32 hex digits, Swiftfin's own id format.
    var jellyfinMediaId: String?
    var seasons: [DiscoverSeasonStatus]?
    var requests: [DiscoverRequest]?

    var jellyfinID: String? {
        guard let id = jellyfinMediaId, id.count == 32 else { return nil }
        return id
    }
}

/// A card in a row.
struct DiscoverResult: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var mediaType: String?
    var title: String?
    var name: String?
    var releaseDate: String?
    var firstAirDate: String?
    var posterPath: String?
    var mediaInfo: DiscoverMediaInfo?

    var type: String { mediaType ?? "movie" }
    var displayTitle: String { title ?? name ?? "" }
    var year: String? { yearOf(releaseDate ?? firstAirDate) }
    var key: String { DiscoverProgressKey.of(type, id) }
}

struct DiscoverNamed: Decodable, Sendable, Hashable {
    var name: String?
}

struct DiscoverCredits: Decodable, Sendable, Hashable {
    var cast: [DiscoverNamed]?
}

struct DiscoverSeason: Decodable, Sendable, Hashable {
    var id: Int?
    var seasonNumber: Int
    var name: String?
    var episodeCount: Int?
    var airDate: String?
}

/// A film or a series: Seerr answers both with one shape, give or take a field.
struct DiscoverDetails: Decodable, Sendable, Hashable {
    var id: Int
    var title: String?
    var name: String?
    var releaseDate: String?
    var firstAirDate: String?
    var overview: String?
    var tagline: String?
    var posterPath: String?
    var backdropPath: String?
    var voteAverage: Double?
    var genres: [DiscoverNamed]?
    var runtime: Int?
    var numberOfSeasons: Int?
    var seasons: [DiscoverSeason]?
    var credits: DiscoverCredits?
    var mediaInfo: DiscoverMediaInfo?

    var displayTitle: String { title ?? name ?? "" }
    var year: String? { yearOf(releaseDate ?? firstAirDate) }

    /// Season 0 is TMDB's "Specials": Sonarr rarely finds them, so they are not offered.
    var realSeasons: [DiscoverSeason] { (seasons ?? []).filter { $0.seasonNumber > 0 } }

    func asResult(type: String) -> DiscoverResult {
        DiscoverResult(
            id: id,
            mediaType: type,
            title: title,
            name: name,
            releaseDate: releaseDate,
            firstAirDate: firstAirDate,
            posterPath: posterPath,
            mediaInfo: mediaInfo
        )
    }
}

struct DiscoverKinds: Decodable, Sendable, Hashable {
    var movie: Bool?
    var tv: Bool?

    func allows(_ type: String) -> Bool { (type == "tv" ? tv : movie) ?? false }
}

struct DiscoverMe: Decodable, Sendable, Hashable {
    var id: Int
    var displayName: String?
    var canRequest: DiscoverKinds?
    var autoApprove: DiscoverKinds?
}

/// Seerr's MediaStatus and MediaRequestStatus.
enum SeerrStatus {
    static let pending = 2
    static let processing = 3
    static let partiallyAvailable = 4
    static let available = 5
    static let blocklisted = 6

    static let requestPending = 1
    static let requestApproved = 2
}

enum DiscoverRow: String, CaseIterable, Identifiable {
    case trending
    case movies
    case tv
    case moviesUpcoming = "movies/upcoming"
    case tvUpcoming = "tv/upcoming"

    var id: String { rawValue }

    var mediaType: String? {
        switch self {
        case .trending: nil
        case .movies, .moviesUpcoming: "movie"
        case .tv, .tvUpcoming: "tv"
        }
    }

    var title: String {
        switch self {
        case .trending: "Trending this week"
        case .movies: "Popular films"
        case .tv: "Popular series"
        case .moviesUpcoming: "Coming to cinemas"
        case .tvUpcoming: "New series on the way"
        }
    }
}

/// Where a title stands for the person looking at it, in the words the UI uses.
enum DiscoverStanding: Hashable {
    case available, partial, processing, pending, blocked, none

    init(_ info: DiscoverMediaInfo?) {
        switch info?.status {
        case SeerrStatus.available: self = .available
        case SeerrStatus.partiallyAvailable: self = .partial
        case SeerrStatus.processing: self = .processing
        case SeerrStatus.pending: self = .pending
        case SeerrStatus.blocklisted: self = .blocked
        default: self = .none
        }
    }

    var label: String? {
        switch self {
        case .available: "In library"
        case .partial: "Partly in library"
        case .processing: "Downloading"
        case .pending: "Awaiting approval"
        case .blocked: "Unavailable"
        case .none: nil
        }
    }

    var here: Bool { self == .available || self == .partial }
}

/// Per season, what is already on its way or there. A season counts as taken if the media says
/// so or if a live request (pending or approved) names it; only the rest can still be asked for.
func discoverSeasonStandings(_ info: DiscoverMediaInfo?) -> [Int: DiscoverStanding] {
    var out: [Int: DiscoverStanding] = [:]
    for s in info?.seasons ?? [] {
        guard let n = s.seasonNumber else { continue }
        switch s.status {
        case SeerrStatus.available, SeerrStatus.partiallyAvailable: out[n] = .available
        case SeerrStatus.processing: out[n] = .processing
        case SeerrStatus.pending: out[n] = .pending
        default: break
        }
    }
    for r in info?.requests ?? [] {
        let live: DiscoverStanding
        switch r.status {
        case SeerrStatus.requestPending: live = .pending
        case SeerrStatus.requestApproved: live = .processing
        default: continue
        }
        for s in r.seasons ?? [] {
            if let n = s.seasonNumber, out[n] == nil { out[n] = live }
        }
    }
    return out
}

/// Requested and not watchable yet, or a series with seasons still coming: worth asking the
/// pipeline about.
func discoverOnItsWay(_ info: DiscoverMediaInfo?) -> Bool {
    switch DiscoverStanding(info) {
    case .pending, .processing, .partial: true
    case .available: info?.jellyfinID == nil
    default: false
    }
}

/// TMDB serves Seerr's artwork; sizes are TMDB's fixed widths.
func tmdbImage(_ path: String?, _ size: String) -> URL? {
    guard let path, !path.isEmpty else { return nil }
    return URL(string: "https://image.tmdb.org/t/p/\(size)\(path)")
}

private func yearOf(_ date: String?) -> String? {
    guard let date, date.count >= 4 else { return nil }
    return String(date.prefix(4))
}

// MARK: Progress

/// Where a requested title is between the download and the NAS, as the mini PC reports it
/// (hosts/debian/nas-sync/nas-pipeline.py, relayed by accounts at /api/discover/progress).
struct TitleProgress: Decodable, Sendable, Hashable {
    struct Download: Decodable, Sendable, Hashable {
        var size: Double?
        var left: Double?
        var eta: Date?
    }

    struct Transfer: Decodable, Sendable, Hashable {
        var bytes: Double?
        var total: Double?
        var startsAt: Date?
        var eta: Date?
        var paused: Bool?
    }

    var title: String?
    /// queued, downloading, stalled, importing, settling, waiting, sending, verifying, arrived
    var stage: String
    var message: String?
    var download: Download?
    var transfer: Transfer?
    /// When it should be watchable on the NAS.
    var eta: Date?
    var files: Int?
    var filesArrived: Int?
}

struct ProgressReply: Decodable, Sendable {
    var available: Bool?
    var stale: Bool?
    var titles: [String: TitleProgress]?
}

enum DiscoverProgressKey {
    static func of(_ type: String, _ id: Int) -> String { "\(type):\(id)" }
}
