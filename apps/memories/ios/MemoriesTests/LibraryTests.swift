import Foundation
import Testing
import UIKit
@testable import Memories

@MainActor
struct LibraryTests {
    @Test func timelineIndexing() async throws {
        let service = MockMediaService(count: 600, latency: false)
        let store = TimelineStore(query: .library, service: service)
        await store.load()
        #expect(store.count == 600)
        #expect(store.buckets.count > 10)
        // Buckets are oldest -> newest.
        #expect(zip(store.buckets, store.buckets.dropFirst()).allSatisfy { $0.date < $1.date })
        // Every global index maps into a bucket and back.
        for i in [0, 1, 299, 599] {
            let loc = try #require(store.location(of: i))
            #expect(store.startIndex(ofBucket: loc.bucket) + loc.local == i)
        }
        #expect(store.location(of: 600) == nil)
        #expect(store.asset(at: 599) == nil) // not loaded yet
        store.ensureLoaded(590..<600)
        try await waitUntil { store.asset(at: 599) != nil }
        let last = try #require(store.asset(at: 599))
        #expect(store.index(of: last.id) == 599)
        #expect(last.thumbhash != nil)
    }

    @Test func removeAndFavorite() async throws {
        let service = MockMediaService(count: 120, latency: false)
        let store = TimelineStore(query: .library, service: service)
        await store.load()
        store.ensureLoaded(0..<120)
        try await waitUntil { (0..<120).allSatisfy { store.asset(at: $0) != nil } }
        let a = try #require(store.asset(at: 5))
        store.update(a.id) { $0.isFavorite = true }
        #expect(store.asset(at: 5)?.isFavorite == true)
        store.remove([a.id])
        #expect(store.count == 119)
        #expect(store.index(of: a.id) == nil)
    }

    @Test func mockTrashRoundTrip() async throws {
        let service = MockMediaService(count: 50, latency: false)
        let buckets = try await service.timelineBuckets(.library)
        let first = try await service.timelineBucket(.library, bucket: buckets[0].timeBucket)[0]
        try await service.trash([first.id])
        #expect(try await service.timelineBuckets(.trash).reduce(0) { $0 + $1.count } == 1)
        try await service.restore([first.id])
        #expect(try await service.timelineBuckets(.trash).isEmpty)
    }

    @Test func gridLayoutMath() {
        let layout = PhotoGridLayout(columns: 5, spacing: 2)
        let cv = UICollectionView(frame: CGRect(x: 0, y: 0, width: 402, height: 874), collectionViewLayout: layout)
        final class DS: NSObject, UICollectionViewDataSource {
            func collectionView(_ cv: UICollectionView, numberOfItemsInSection s: Int) -> Int { 50_000 }
            func collectionView(_ cv: UICollectionView, cellForItemAt ip: IndexPath) -> UICollectionViewCell { UICollectionViewCell() }
        }
        let ds = DS()
        cv.dataSource = ds
        cv.register(UICollectionViewCell.self, forCellWithReuseIdentifier: "c")
        layout.prepare()
        #expect(layout.collectionViewContentSize.height > 50_000 / 5 * 70)
        let attrs = layout.layoutAttributesForElements(in: CGRect(x: 0, y: 10_000, width: 402, height: 874)) ?? []
        #expect(attrs.count < 200) // only the visible rows
        let f = layout.frame(for: 12)
        #expect(layout.index(at: CGPoint(x: f.midX, y: f.midY)) == 12)
        withExtendedLifetime(ds) {}
    }

    @Test func endpointsNormalize() {
        #expect(ServerEndpoints.normalize("memories.davideghiotto.it/immich/")?.absoluteString == "https://memories.davideghiotto.it/immich")
        #expect(ServerEndpoints.normalize("http://192.168.1.20:2283")?.absoluteString == "http://192.168.1.20:2283")
        #expect(ServerEndpoints.normalize("  ") == nil)
        #expect(ServerEndpoints.resolve(endpoint: "https://other/api", against: URL(string: "https://x")!).absoluteString == "https://other/api")
    }

    @Test func launchOptions() {
        let o = LaunchOptions(arguments: ["app", "-mock", "-initialTab", "collections", "-libraryMode", "years", "-columns", "13", "-openInfo"])
        #expect(o.mock)
        #expect(o.initialTab == .collections)
        #expect(o.libraryMode == .years)
        #expect(o.columns == 13)
        #expect(o.openViewer && o.openInfo)
        #expect(LaunchOptions(arguments: ["app"]).mock == false)
    }

    @Test func timelineQueryItems() {
        let items = TimelineQuery.album(id: "A").queryItems
        #expect(items.contains(URLQueryItem(name: "albumId", value: "A")))
        #expect(items.contains(URLQueryItem(name: "order", value: "asc")))
        #expect(TimelineQuery.library.queryItems.contains(URLQueryItem(name: "visibility", value: "timeline")))
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("condition not met in time")
    }
}
