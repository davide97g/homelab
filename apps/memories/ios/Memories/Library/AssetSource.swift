import Foundation
import Observation

enum GridChange {
    /// Counts changed: reload everything.
    case reloadAll
    /// Data for these global indexes arrived or changed.
    case reconfigure(Range<Int>)
}

/// What a photo grid and the viewer page through: a flat, index-addressed list of assets
/// whose contents may arrive lazily (timeline buckets) or in pages (search).
@MainActor
protocol AssetSource: AnyObject {
    var count: Int { get }
    var isLoading: Bool { get }
    var errorMessage: String? { get }
    func asset(at index: Int) -> Asset?
    func index(of id: String) -> Int?
    /// Ask for the data behind these indexes (no-op when already loaded).
    func ensureLoaded(_ range: Range<Int>)
    func load() async
    func reload() async
    func update(_ id: String, _ change: (inout Asset) -> Void)
    func remove(_ ids: Set<String>)
    @discardableResult
    func addListener(_ f: @escaping @MainActor (GridChange) -> Void) -> ListenerToken
}

/// Keep it alive to keep receiving changes.
final class ListenerToken {
    private let cancel: @MainActor () -> Void
    init(_ cancel: @escaping @MainActor () -> Void) { self.cancel = cancel }
    deinit {
        let c = cancel
        Task { @MainActor in c() }
    }
}

@MainActor
class ListenerHub {
    private var listeners: [UUID: @MainActor (GridChange) -> Void] = [:]

    func add(_ f: @escaping @MainActor (GridChange) -> Void) -> ListenerToken {
        let id = UUID()
        listeners[id] = f
        return ListenerToken { [weak self] in self?.listeners[id] = nil }
    }

    func send(_ change: GridChange) {
        for l in listeners.values { l(change) }
    }
}

// MARK: - Timeline (month buckets)

/// Immich timeline: `GET /timeline/buckets` gives month counts up front so the grid can size
/// itself for the whole library; each month's assets come from `GET /timeline/bucket` when
/// cells near it scroll into view. Order is oldest -> newest (newest at the bottom).
@MainActor
@Observable
final class TimelineStore: AssetSource {
    struct Bucket: Identifiable {
        let key: String
        /// First day of the month, GMT.
        let date: Date
        var count: Int
        var assets: [Asset]?
        var id: String { key }
    }

    let query: TimelineQuery
    @ObservationIgnored let service: any MediaService
    private(set) var buckets: [Bucket] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    private(set) var errorMessage: String?
    /// Bumped whenever bucket contents change, for SwiftUI views that summarise buckets.
    private(set) var revision = 0

    @ObservationIgnored private var offsets: [Int] = []
    @ObservationIgnored private var total = 0
    @ObservationIgnored private var inflight: Set<Int> = []
    @ObservationIgnored private var failed: [Int: Date] = [:]
    @ObservationIgnored private var idIndex: [String: Int] = [:]
    @ObservationIgnored private let hub = ListenerHub()

    init(query: TimelineQuery, service: any MediaService) {
        self.query = query
        self.service = service
    }

    var count: Int { total }

    func addListener(_ f: @escaping @MainActor (GridChange) -> Void) -> ListenerToken { hub.add(f) }

    func load() async {
        guard !hasLoaded, !isLoading else { return }
        await reload()
    }

    func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let dtos = try await service.timelineBuckets(query)
            var newBuckets = dtos.map { dto in
                Bucket(key: dto.timeBucket, date: DateParsing.date(dto.timeBucket) ?? .distantPast, count: dto.count, assets: nil)
            }
            // Keep already loaded months whose count is unchanged, so a refresh doesn't flash.
            let old = Dictionary(uniqueKeysWithValues: buckets.map { ($0.key, $0) })
            for i in newBuckets.indices {
                if let o = old[newBuckets[i].key], o.count == newBuckets[i].count { newBuckets[i].assets = o.assets }
            }
            newBuckets.sort { $0.date < $1.date }
            buckets = newBuckets
            errorMessage = nil
            hasLoaded = true
            rebuildIndex()
            hub.send(.reloadAll)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func rebuildIndex() {
        offsets = []
        offsets.reserveCapacity(buckets.count)
        var running = 0
        idIndex = [:]
        for b in buckets {
            offsets.append(running)
            if let assets = b.assets {
                for (i, a) in assets.enumerated() { idIndex[a.id] = running + i }
            }
            running += b.count
        }
        total = running
        revision += 1
    }

    /// Global index -> (bucket, index inside bucket). Binary search over month offsets.
    func location(of index: Int) -> (bucket: Int, local: Int)? {
        guard index >= 0, index < total, !offsets.isEmpty else { return nil }
        var lo = 0, hi = offsets.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if offsets[mid] <= index { lo = mid } else { hi = mid - 1 }
        }
        return (lo, index - offsets[lo])
    }

    func startIndex(ofBucket b: Int) -> Int { b < offsets.count ? offsets[b] : total }

    func asset(at index: Int) -> Asset? {
        guard let (b, l) = location(of: index), let assets = buckets[b].assets, l < assets.count else { return nil }
        return assets[l]
    }

    func index(of id: String) -> Int? { idIndex[id] }

    /// The month (GMT) an index falls into, even if its assets aren't loaded yet.
    func bucketDate(at index: Int) -> Date? {
        guard let (b, _) = location(of: index) else { return nil }
        return buckets[b].date
    }

    func ensureLoaded(_ range: Range<Int>) {
        guard !range.isEmpty, total > 0 else { return }
        let lo = max(0, range.lowerBound), hi = min(total - 1, range.upperBound - 1)
        guard lo <= hi, let first = location(of: lo)?.bucket, let last = location(of: hi)?.bucket else { return }
        for b in first...last { loadBucket(b) }
    }

    func loadBucket(_ b: Int) {
        guard b >= 0, b < buckets.count, buckets[b].assets == nil, !inflight.contains(b) else { return }
        if let f = failed[b], Date().timeIntervalSince(f) < 5 { return }
        inflight.insert(b)
        let key = buckets[b].key
        Task {
            defer { inflight.remove(b) }
            do {
                let assets = try await service.timelineBucket(query, bucket: key)
                // Buckets may have been replaced by a reload meanwhile.
                guard let idx = buckets.firstIndex(where: { $0.key == key }) else { return }
                apply(assets, toBucket: idx)
            } catch {
                failed[b] = Date()
            }
        }
    }

    private func apply(_ assets: [Asset], toBucket b: Int) {
        let countChanged = buckets[b].count != assets.count
        buckets[b].assets = assets
        buckets[b].count = assets.count
        if countChanged {
            rebuildIndex()
            hub.send(.reloadAll)
        } else {
            let start = offsets[b]
            for (i, a) in assets.enumerated() { idIndex[a.id] = start + i }
            revision += 1
            hub.send(.reconfigure(start..<(start + assets.count)))
        }
    }

    func update(_ id: String, _ change: (inout Asset) -> Void) {
        guard let i = idIndex[id], let (b, l) = location(of: i), buckets[b].assets != nil else { return }
        change(&buckets[b].assets![l])
        revision += 1
        hub.send(.reconfigure(i..<(i + 1)))
    }

    func remove(_ ids: Set<String>) {
        var touched = false
        for b in buckets.indices {
            guard let assets = buckets[b].assets else { continue }
            let kept = assets.filter { !ids.contains($0.id) }
            if kept.count != assets.count {
                buckets[b].assets = kept
                buckets[b].count = kept.count
                touched = true
            }
        }
        guard touched else { return }
        buckets.removeAll { $0.count == 0 }
        rebuildIndex()
        hub.send(.reloadAll)
    }

    // MARK: Summaries for Months / Years

    /// A representative asset for a month: a favorite if there is one, else the middle shot.
    func keyAsset(ofBucket b: Int) -> Asset? {
        guard b < buckets.count, let assets = buckets[b].assets, !assets.isEmpty else { return nil }
        return assets.last(where: { $0.isFavorite && $0.isImage }) ?? assets[assets.count / 2]
    }

    func topPlace(ofBucket b: Int) -> String? {
        guard b < buckets.count, let assets = buckets[b].assets else { return nil }
        var counts: [String: Int] = [:]
        for a in assets { if let c = a.city { counts[c, default: 0] += 1 } }
        let sorted = counts.sorted { $0.value > $1.value }.map(\.key)
        switch sorted.count {
        case 0: return nil
        case 1: return sorted[0]
        case 2: return "\(sorted[0]) & \(sorted[1])"
        default: return "\(sorted[0]), \(sorted[1]) & more"
        }
    }
}

// MARK: - Flat lists (search, media types)

/// Paged list from a search endpoint.
@MainActor
@Observable
final class AssetListStore: AssetSource {
    typealias Fetch = @Sendable (_ page: Int) async throws -> SearchPage

    private(set) var assets: [Asset] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var hasLoaded = false
    @ObservationIgnored private var nextPage: Int? = 1
    @ObservationIgnored private let fetch: Fetch
    @ObservationIgnored private let hub = ListenerHub()
    @ObservationIgnored private var idIndex: [String: Int] = [:]
    /// Search results are newest first; grids want newest at the bottom.
    @ObservationIgnored let newestAtBottom: Bool

    init(newestAtBottom: Bool = false, fetch: @escaping Fetch) {
        self.fetch = fetch
        self.newestAtBottom = newestAtBottom
    }

    convenience init(assets: [Asset]) {
        self.init { _ in SearchPage(assets: assets, nextPage: nil) }
    }

    var count: Int { assets.count }
    func asset(at index: Int) -> Asset? { assets.indices.contains(index) ? assets[index] : nil }
    func index(of id: String) -> Int? { idIndex[id] }
    func addListener(_ f: @escaping @MainActor (GridChange) -> Void) -> ListenerToken { hub.add(f) }

    func load() async {
        guard !hasLoaded else { return }
        await reload()
    }

    func reload() async {
        nextPage = 1
        assets = []
        await loadMore()
        hasLoaded = true
    }

    func loadMore() async {
        guard let page = nextPage, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await fetch(page)
            assets.append(contentsOf: result.assets)
            nextPage = result.nextPage
            errorMessage = nil
            reindex()
            hub.send(.reloadAll)
        } catch {
            errorMessage = error.localizedDescription
            nextPage = nil
        }
    }

    private func reindex() {
        idIndex = Dictionary(assets.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    func ensureLoaded(_ range: Range<Int>) {
        if range.upperBound >= assets.count - 20, nextPage != nil, !isLoading {
            Task { await loadMore() }
        }
    }

    func update(_ id: String, _ change: (inout Asset) -> Void) {
        guard let i = idIndex[id] else { return }
        change(&assets[i])
        hub.send(.reconfigure(i..<(i + 1)))
    }

    func remove(_ ids: Set<String>) {
        assets.removeAll { ids.contains($0.id) }
        reindex()
        hub.send(.reloadAll)
    }
}
