import Foundation
import Synchronization
import UIKit

/// Fixture library for SwiftUI previews and the `-mock` launch argument. Everything is generated
/// deterministically from a seed; images are drawn by `MockArt`. Small artificial latencies make
/// the thumbhash placeholders and lazy bucket loading visible.
final class MockMediaService: MediaService {
    var isMock: Bool { true }

    struct City: Sendable { let name: String, country: String, lat: Double, lon: Double }
    static let cities: [City] = [
        .init(name: "Milan", country: "Italy", lat: 45.4642, lon: 9.19),
        .init(name: "Turin", country: "Italy", lat: 45.0703, lon: 7.6869),
        .init(name: "Venice", country: "Italy", lat: 45.4408, lon: 12.3155),
        .init(name: "Rome", country: "Italy", lat: 41.9028, lon: 12.4964),
        .init(name: "Florence", country: "Italy", lat: 43.7696, lon: 11.2558),
        .init(name: "Courmayeur", country: "Italy", lat: 45.7969, lon: 6.969),
        .init(name: "Camogli", country: "Italy", lat: 44.3496, lon: 9.1554),
        .init(name: "Paris", country: "France", lat: 48.8566, lon: 2.3522),
        .init(name: "Lisbon", country: "Portugal", lat: 38.7223, lon: -9.1393),
        .init(name: "Barcelona", country: "Spain", lat: 41.3874, lon: 2.1686),
        .init(name: "Amsterdam", country: "Netherlands", lat: 52.3676, lon: 4.9041),
        .init(name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503),
    ]

    static let albumNames = ["Summer in Liguria", "Tokyo", "Ski Weekend", "Giulia & Marco", "Family",
                             "Food", "Concerts", "Pippo", "Road Trip", "Garden"]
    static let personNames = ["Giulia", "Marco", "Nonna Rosa", "Luca", "Sara", "Elena", "Pippo", "Tommaso"]

    private let all: [Asset]
    private let seeds: [String: UInt64]
    private let mutable = Mutex(MutableState())
    private let latency: Bool

    private struct MutableState {
        var favorites: [String: Bool] = [:]
        var trashed: Set<String> = []
        var thumbhashes: [String: String] = [:]
        var resolvedGroups: Set<String> = []
    }

    /// - Parameters:
    ///   - count: number of assets (use 50_000 to stress-test the grid).
    ///   - latency: add fake network delays.
    init(count: Int = 2_400, latency: Bool = true, now: Date = .now) {
        self.latency = latency
        var rng = MockArt.SplitMix(42)
        let span: TimeInterval = 4.2 * 365 * 86_400
        let start = now.addingTimeInterval(-span)
        var assets: [Asset] = []
        var seeds: [String: UInt64] = [:]
        assets.reserveCapacity(count)
        // Clustered capture times: bursts around "events" like a real camera roll.
        var t = start
        let mean = span / Double(max(count, 1))
        for i in 0..<count {
            let burst = Double.random(in: 0...1, using: &rng) < 0.7
            t = t.addingTimeInterval(burst ? Double.random(in: 20...mean * 0.6, using: &rng) : Double.random(in: mean...mean * 3.4, using: &rng))
            if t > now { t = now.addingTimeInterval(-Double(count - i) * 30) }
            let seed = rng.next()
            let id = String(format: "00000000-0000-4000-8000-%012x", i)
            // Same place for a few days at a time; home (Milan/Turin) most of the time.
            let event = Int(t.timeIntervalSince1970 / (86_400 * 4))
            let city = event % 5 < 3 ? Self.cities[event % 2] : Self.cities[(event * 7) % Self.cities.count]
            let isVideo = Double.random(in: 0...1, using: &rng) < 0.08
            let ratios: [Double] = [3.0 / 4, 3.0 / 4, 3.0 / 4, 4.0 / 3, 9.0 / 16, 16.0 / 9, 1]
            let ratio = isVideo ? (Bool.random(using: &rng) ? 9.0 / 16 : 16.0 / 9) : ratios.randomElement(using: &rng)!
            let hasGPS = Double.random(in: 0...1, using: &rng) < 0.85
            assets.append(Asset(
                id: id,
                ratio: ratio,
                thumbhash: nil,
                isImage: !isVideo,
                durationMs: isVideo ? Int.random(in: 3_000...180_000, using: &rng) : nil,
                isFavorite: Double.random(in: 0...1, using: &rng) < 0.06,
                livePhotoVideoId: !isVideo && Double.random(in: 0...1, using: &rng) < 0.25 ? "live-\(id)" : nil,
                fileCreatedAt: t,
                localOffsetHours: city.lon > 100 ? 9 : 1,
                city: hasGPS ? city.name : nil,
                country: hasGPS ? city.country : nil,
                latitude: hasGPS ? city.lat + Double.random(in: -0.03...0.03, using: &rng) : nil,
                longitude: hasGPS ? city.lon + Double.random(in: -0.03...0.03, using: &rng) : nil))
            seeds[id] = seed
        }
        // Stretch the random walk so the newest item lands about an hour ago.
        if let first = assets.first?.fileCreatedAt, let last = assets.last?.fileCreatedAt, last > first {
            let target = now.addingTimeInterval(-3600)
            let factor = target.timeIntervalSince(start) / last.timeIntervalSince(start)
            for i in assets.indices {
                assets[i].fileCreatedAt = start.addingTimeInterval(assets[i].fileCreatedAt.timeIntervalSince(start) * factor)
            }
        }
        self.all = assets
        self.seeds = seeds
    }

    // MARK: Helpers

    private func pause(_ ms: ClosedRange<Int>) async throws {
        guard latency else { return }
        try await Task.sleep(for: .milliseconds(Int.random(in: ms)))
    }

    private func seed(_ id: String) -> UInt64 {
        if let s = seeds[id] { return s }
        var h: UInt64 = 1469598103934665603
        for b in id.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return h
    }

    private func current(_ a: Asset, _ state: MutableState) -> Asset {
        var a = a
        if let f = state.favorites[a.id] { a.isFavorite = f }
        a.isTrashed = state.trashed.contains(a.id)
        a.thumbhash = state.thumbhashes[a.id]
        return a
    }

    private func assets(for query: TimelineQuery) -> [Asset] {
        let state = mutable.withLock { $0 }
        let live = all.lazy.map { self.current($0, state) }
        switch query {
        case .library: return live.filter { !$0.isTrashed }
        case .favorites: return live.filter { !$0.isTrashed && $0.isFavorite }
        case .album(let id):
            let k = Int(id.dropFirst(6)) ?? 0
            return live.filter { !$0.isTrashed && (self.seed($0.id) >> 20) % 23 == UInt64(k) }
        case .person(let id):
            let k = Int(id.dropFirst(7)) ?? 0
            return live.filter { !$0.isTrashed && (self.seed($0.id) >> 28) % 17 == UInt64(k) }
        case .trash: return live.filter(\.isTrashed)
        case .archive: return []
        }
    }

    private static func bucketKey(_ a: Asset) -> String {
        let c = DateFormatting.gmtCalendar.dateComponents([.year, .month], from: a.localDate)
        return String(format: "%04d-%02d-01", c.year ?? 2000, c.month ?? 1)
    }

    private func withThumbhashes(_ list: [Asset]) -> [Asset] {
        let missing = mutable.withLock { s in list.filter { s.thumbhashes[$0.id] == nil } }
        var computed: [String: String] = [:]
        for a in missing {
            let img = MockArt.render(seed: seed(a.id), ratio: a.ratio, longSide: 24)
            if let hash = ThumbHash.encode(image: img) {
                computed[a.id] = Data(hash).base64EncodedString()
            }
        }
        return mutable.withLock { s in
            s.thumbhashes.merge(computed) { a, _ in a }
            return list.map { var a = $0; a.thumbhash = s.thumbhashes[a.id]; return a }
        }
    }

    // MARK: MediaService

    func currentUser() async throws -> UserSummary {
        UserSummary(id: "mock-user", name: "Davide", email: "demo@example.com")
    }

    func timelineBuckets(_ query: TimelineQuery) async throws -> [TimeBucketsResponseDto] {
        try await pause(80...200)
        var order: [String] = []
        var counts: [String: Int] = [:]
        for a in assets(for: query) {
            let k = Self.bucketKey(a)
            if counts[k] == nil { order.append(k) }
            counts[k, default: 0] += 1
        }
        return order.map { TimeBucketsResponseDto(count: counts[$0]!, timeBucket: $0) }
    }

    func timelineBucket(_ query: TimelineQuery, bucket: String) async throws -> [Asset] {
        try await pause(60...250)
        return withThumbhashes(assets(for: query).filter { Self.bucketKey($0) == bucket })
    }

    func assetDetail(id: String) async throws -> AssetDetail {
        try await pause(40...120)
        let state = mutable.withLock { $0 }
        guard let a = all.first(where: { $0.id == id }).map({ current($0, state) }) else {
            throw APIError.http(404, "Not found")
        }
        let s = seed(id)
        let people = Self.personNames.enumerated().filter { (s >> 28) % 17 == UInt64($0.offset) }
            .map { Person(id: "person\($0.offset)", name: $0.element) }
        let cameras = [("Apple", "iPhone 16 Pro", "iPhone 16 Pro back triple camera 6.86mm f/1.78"),
                       ("FUJIFILM", "X100VI", "23mm f/2"), ("Sony", "ILCE-7M4", "FE 35mm F1.8")]
        let cam = cameras[Int(s % 3)]
        let n = Int(s % 9000) + 1000
        var exif = ExifResponseDto()
        exif.city = a.city
        exif.country = a.country
        exif.make = cam.0
        exif.model = cam.1
        exif.lensModel = cam.2
        exif.fNumber = [1.78, 2.0, 2.8, 4.0][Int(s % 4)]
        exif.exposureTime = ["1/120", "1/250", "1/60", "1/1000"][Int((s >> 3) % 4)]
        exif.iso = [50, 100, 200, 640][Int((s >> 5) % 4)]
        exif.focalLength = [6.86, 23, 35, 24][Int(s % 4)]
        exif.latitude = a.latitude
        exif.longitude = a.longitude
        exif.exifImageWidth = a.ratio >= 1 ? 4032 : Int(4032 * a.ratio)
        exif.exifImageHeight = a.ratio >= 1 ? Int(4032 / a.ratio) : 4032
        exif.fileSizeInByte = a.isVideo ? Int64(a.durationMs ?? 0) * 1_200 : Int64(2_000_000 + s % 3_000_000)
        return AssetDetail(asset: a, fileName: a.isVideo ? "IMG_\(n).MOV" : "IMG_\(n).HEIC",
                           mimeType: a.isVideo ? "video/quicktime" : "image/heic",
                           exif: exif, people: people)
    }

    func albums() async throws -> [Album] {
        try await pause(80...200)
        return Self.albumNames.enumerated().map { i, name in
            let list = assets(for: .album(id: "album-\(i)"))
            return Album(id: "album-\(i)", name: name, thumbnailAssetId: list.last?.id,
                         assetCount: list.count, shared: i % 4 == 3, startDate: list.first?.fileCreatedAt)
        }
    }

    func people() async throws -> [Person] {
        try await pause(80...200)
        return Self.personNames.enumerated().map { Person(id: "person\($0.offset)", name: $0.element, isFavorite: $0.offset < 2) }
    }

    func memories(on day: Date) async throws -> [Memory] {
        try await pause(80...200)
        let cal = Calendar(identifier: .gregorian)
        let year = cal.component(.year, from: day)
        let lib = assets(for: .library)
        var out: [Memory] = []
        for ago in 1...4 {
            guard let target = cal.date(byAdding: .year, value: -ago, to: day) else { continue }
            let window = lib.filter { abs($0.fileCreatedAt.timeIntervalSince(target)) < 6 * 86_400 }
            let picked = window.isEmpty ? Array(lib.filter { abs($0.fileCreatedAt.timeIntervalSince(target)) < 40 * 86_400 }.prefix(14)) : Array(window.prefix(20))
            guard picked.count >= 3 else { continue }
            out.append(Memory(id: "memory-\(ago)", year: year - ago, title: "On This Day", assets: withThumbhashes(picked)))
        }
        if let pippo = Self.personNames.firstIndex(of: "Pippo") {
            let list = Array(assets(for: .person(id: "person\(pippo)")).suffix(16))
            if list.count >= 3 {
                out.append(Memory(id: "memory-pippo", year: year - 1, title: "Pippo Through the Years", assets: withThumbhashes(list)))
            }
        }
        return out
    }

    func mapMarkers() async throws -> [MapMarker] {
        try await pause(80...200)
        return assets(for: .library).compactMap { a in
            guard let lat = a.latitude, let lon = a.longitude else { return nil }
            return MapMarker(id: a.id, latitude: lat, longitude: lon, city: a.city)
        }
    }

    func places() async throws -> [Place] {
        try await pause(80...200)
        var seen: [String: Asset] = [:]
        for a in assets(for: .library).reversed() { if let c = a.city, seen[c] == nil { seen[c] = a } }
        return withThumbhashes(Array(seen.values)).compactMap { a in a.city.map { Place(name: $0, asset: a) } }
            .sorted { $0.name < $1.name }
    }

    func smartSearch(_ text: String, page: Int) async throws -> SearchPage {
        try await pause(300...600)
        let q = text.lowercased()
        let lib = assets(for: .library)
        let byPlace = lib.filter { ($0.city?.lowercased().contains(q) ?? false) || ($0.country?.lowercased().contains(q) ?? false) }
        let byTheme = lib.filter { a in MockArt.theme(for: seed(a.id)).keywords.contains { q.contains($0) || $0.contains(q) } }
        let hits = byPlace.isEmpty ? byTheme : byPlace
        let pageSize = 100
        let slice = Array(hits.reversed().dropFirst((page - 1) * pageSize).prefix(pageSize))
        return SearchPage(assets: withThumbhashes(slice), nextPage: hits.count > page * pageSize ? page + 1 : nil)
    }

    func metadataSearch(_ query: MetadataQuery, page: Int) async throws -> SearchPage {
        try await pause(150...300)
        let lib = assets(for: .library)
        let hits: [Asset] = switch query {
        case .videos: lib.filter(\.isVideo).reversed()
        case .livePhotos: lib.filter(\.isLivePhoto).reversed()
        case .recentlyAdded: Array(lib.suffix(300).reversed())
        }
        let size = 250
        let slice = Array(hits.dropFirst((page - 1) * size).prefix(size))
        return SearchPage(assets: withThumbhashes(slice), nextPage: hits.count > page * size ? page + 1 : nil)
    }

    func updatePerson(_ id: String, name: String?, isHidden: Bool?, isFavorite: Bool?) async throws {
        try await pause(80...150)
    }

    func mergePeople(into target: String, from sources: [String]) async throws {
        try await pause(80...150)
    }

    func setFavorite(_ ids: [String], _ value: Bool) async throws {
        try await pause(80...150)
        mutable.withLock { s in for id in ids { s.favorites[id] = value } }
    }

    func trash(_ ids: [String]) async throws {
        try await pause(80...150)
        mutable.withLock { $0.trashed.formUnion(ids) }
    }

    func restore(_ ids: [String]) async throws {
        try await pause(80...150)
        mutable.withLock { $0.trashed.subtract(ids) }
    }

    // MARK: Similar photos

    /// Fake sets from the fixture roll: a few consecutive stills every so often. They don't look
    /// alike (each fixture image has its own seed); enough to exercise the game.
    func similarGroups() async throws -> [SimilarGroup] {
        try await pause(200...500)
        let state = mutable.withLock { $0 }
        let stills = all.filter(\.isImage)
        var groups: [SimilarGroup] = []
        var i = stills.count - 1
        var n = 0
        while i > 4, groups.count < 24 {
            let size = 2 + n % 4
            let members = stills[(i - size + 1)...i].map { current($0, state) }.filter { !$0.isTrashed }
            let gid = String(format: "00000000-0000-4000-9000-%012x", n)
            if members.count >= 2, !state.resolvedGroups.contains(gid) {
                let items = members.enumerated().map { k, a in
                    SimilarItem(asset: a, bytes: Int64(2_400_000) + Int64(seed(a.id) % 1_800_000),
                                width: 4032, height: 3024, isSuggested: k == 0)
                }
                groups.append(SimilarGroup(id: gid, items: items))
            }
            i -= 37
            n += 1
        }
        return groups
    }

    func resolveSimilar(_ groupId: String, keep: [String], discard: [String]) async throws {
        try await pause(150...300)
        mutable.withLock {
            $0.resolvedGroups.insert(groupId)
            $0.trashed.formUnion(discard)
        }
    }

    func scanSimilar(wholeLibrary: Bool) async throws {
        try await pause(1_200...2_000)
    }

    func image(_ request: ImageRequest) async throws -> ImagePayload {
        switch request.kind {
        case .thumbnail: try await pause(20...120)
        case .preview, .fullsize: try await pause(120...300)
        case .person: try await pause(20...80)
        }
        try Task.checkCancellation()
        let s = seed(request.id)
        if request.kind == .person {
            return .image(MockArt.avatar(seed: s, side: 240))
        }
        let ratio = all.first(where: { $0.id == request.id })?.ratio ?? 0.75
        let side: CGFloat = switch request.kind {
        case .thumbnail: 320
        case .preview: 1440
        default: 2400
        }
        return .image(MockArt.render(seed: s, ratio: ratio, longSide: side))
    }

    func playback(for assetId: String) -> PlaybackSource? { nil }

    func downloadOriginal(_ asset: Asset) async throws -> URL {
        let img = MockArt.render(seed: seed(asset.id), ratio: asset.ratio, longSide: 2400)
        let dir = FileManager.default.temporaryDirectory.appending(path: "share/\(asset.id)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: "Memories-\(asset.id.suffix(6)).jpg")
        try img.jpegData(compressionQuality: 0.9)?.write(to: url)
        return url
    }
}
