import Foundation
import UIKit

struct ImageRequest: Hashable, Sendable {
    enum Kind: String, Hashable, Sendable {
        /// ~250 px webp, grid cells.
        case thumbnail
        /// ~1440 px jpeg, viewer and cards.
        case preview
        case fullsize
        /// Face crop for People.
        case person
    }

    let id: String
    let kind: Kind
    /// Immich suggests `&c=<thumbhash>` as a cache-buster; it also keys our caches.
    var thumbhash: String?

    var cacheKey: String { "\(kind.rawValue)/\(id)/\(thumbhash ?? "")" }
}

enum ImagePayload: Sendable {
    case data(Data)
    case image(UIImage)
}

struct PlaybackSource: Sendable {
    let url: URL
    let headers: [String: String]
}

/// Everything the UI needs from a server. `RemoteMediaService` talks to Immich;
/// `MockMediaService` serves generated fixtures for previews and `-mock`.
protocol MediaService: Sendable {
    var isMock: Bool { get }

    func currentUser() async throws -> UserSummary

    func timelineBuckets(_ query: TimelineQuery) async throws -> [TimeBucketsResponseDto]
    func timelineBucket(_ query: TimelineQuery, bucket: String) async throws -> [Asset]
    func assetDetail(id: String) async throws -> AssetDetail

    func albums() async throws -> [Album]
    func people() async throws -> [Person]
    func memories(on day: Date) async throws -> [Memory]
    func mapMarkers() async throws -> [MapMarker]
    func places() async throws -> [Place]

    func smartSearch(_ text: String, page: Int) async throws -> SearchPage
    func metadataSearch(_ query: MetadataQuery, page: Int) async throws -> SearchPage

    /// Name, hide or favourite a face cluster (`PUT /people/{id}`). nil leaves a field alone.
    func updatePerson(_ id: String, name: String?, isHidden: Bool?, isFavorite: Bool?) async throws
    /// Folds `sources` into `target` (`POST /people/{target}/merge`): same person, split by Immich.
    func mergePeople(into target: String, from sources: [String]) async throws

    func setFavorite(_ ids: [String], _ value: Bool) async throws
    func trash(_ ids: [String]) async throws
    func restore(_ ids: [String]) async throws

    /// Sets of similar photos found by Immich's duplicate detection, newest first.
    func similarGroups() async throws -> [SimilarGroup]
    /// Ends a set: `discard` is deleted for good (no trash), after Immich copies albums and
    /// favourites onto `keep`. An empty `discard` just tells Immich they are not duplicates.
    func resolveSimilar(_ groupId: String, keep: [String], discard: [String]) async throws
    /// Runs Immich's duplicate detection now and returns when the queue is idle (admin only).
    /// `wholeLibrary` re-checks every asset, needed after changing the threshold.
    func scanSimilar(wholeLibrary: Bool) async throws

    func image(_ request: ImageRequest) async throws -> ImagePayload
    func playback(for assetId: String) -> PlaybackSource?
    /// Downloads the original into a temporary file named like the original.
    func downloadOriginal(_ asset: Asset) async throws -> URL
}
