import CryptoKit
import Foundation
import ImageIO
import AVFoundation
import Photos
import Synchronization
import UIKit

/// Thumbnail/preview loader: memory cache (NSCache) -> disk cache (Caches/images) -> network.
/// Previews of items still on this iPhone come from PhotoKit (offline, full quality); grid
/// thumbnails of items freed up from the iPhone are pinned in Application Support so the library
/// still browses offline.
/// Concurrent requests for the same key share one task; callers cancel by cancelling their Task.
/// Decoding happens off the main thread (`byPreparingForDisplay`), so cells only assign
/// ready-to-draw bitmaps.
final class ImagePipeline: Sendable {
    private let service: any MediaService
    // NSCache is internally synchronised.
    nonisolated(unsafe) private let memory: NSCache<NSString, UIImage>
    nonisolated(unsafe) private let hashes: NSCache<NSString, UIImage>
    private let diskURL: URL?
    private let device: DeviceIndex?
    private let inflight = Mutex<[String: Entry]>([:])
    private let ioQueue = DispatchQueue(label: "memories.imagecache.io", qos: .utility)

    private final class Entry: Sendable {
        let task: Task<UIImage?, Never>
        let waiters: Mutex<Int>
        init(task: Task<UIImage?, Never>) { self.task = task; waiters = Mutex(0) }
    }

    /// Thumbnails kept for items removed from the iPhone; never trimmed, only cleared on sign-out.
    static var pinnedURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "offline-thumbnails", directoryHint: .isDirectory)
    }

    init(service: any MediaService, device: DeviceIndex? = nil, diskCache: Bool = true) {
        self.service = service
        self.device = device
        memory = NSCache()
        memory.totalCostLimit = 160 * 1024 * 1024
        hashes = NSCache()
        hashes.countLimit = 4_000
        if diskCache, !service.isMock,
           let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            let dir = caches.appending(path: "images", directoryHint: .isDirectory)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            diskURL = dir
        } else {
            diskURL = nil
        }
    }

    // MARK: Sync lookups (cell configuration)

    func cached(_ request: ImageRequest) -> UIImage? {
        memory.object(forKey: request.cacheKey as NSString)
    }

    /// Best cached image at or above `kind` quality is not tracked; callers ask for what they want
    /// and fall back to the grid thumbnail themselves.
    func placeholder(thumbhash: String?) -> UIImage? {
        guard let thumbhash else { return nil }
        let key = thumbhash as NSString
        if let img = hashes.object(forKey: key) { return img }
        guard let img = ThumbHash.image(base64: thumbhash) else { return nil }
        hashes.setObject(img, forKey: key)
        return img
    }

    // MARK: Async loading

    func image(_ request: ImageRequest) async -> UIImage? {
        if let hit = cached(request) { return hit }
        let key = request.cacheKey
        let entry = inflight.withLock { map -> Entry in
            if let e = map[key], !e.task.isCancelled { e.waiters.withLock { $0 += 1 }; return e }
            let e = Entry(task: Task(priority: request.kind == .thumbnail ? .userInitiated : .high) { [weak self] in
                await self?.load(request)
            })
            e.waiters.withLock { $0 = 1 }
            map[key] = e
            return e
        }
        let result = await withTaskCancellationHandler {
            await entry.task.value
        } onCancel: {
            // Cancel the shared load only when nobody else is waiting for it.
            let remaining = entry.waiters.withLock { $0 -= 1; return $0 }
            if remaining <= 0 { entry.task.cancel() }
        }
        inflight.withLock { map in
            if map[key] === entry, entry.task.isCancelled || result != nil { map[key] = nil }
        }
        return Task.isCancelled ? nil : result
    }

    /// Warm the caches without waiting (grid prefetching).
    func prefetch(_ requests: [ImageRequest]) {
        for r in requests where cached(r) == nil {
            Task(priority: .utility) { _ = await self.image(r) }
        }
    }

    private func load(_ request: ImageRequest) async -> UIImage? {
        let key = request.cacheKey
        if request.kind == .preview || request.kind == .fullsize, !service.isMock,
           let localId = device?.localId(for: request.id),
           let img = await LocalPhotos.image(localId, longSide: request.kind == .preview ? 2048 : 4096) {
            store(img, key)
            inflight.withLock { $0[key] = nil }
            return img
        }
        if let data = await readDisk(key), let img = await decode(data) {
            store(img, key)
            return img
        }
        if request.kind == .thumbnail, let data = await readPinned(request.id), let img = await decode(data) {
            store(img, key)
            return img
        }
        do {
            let payload = try await service.image(request)
            try Task.checkCancellation()
            let img: UIImage?
            switch payload {
            case .data(let data):
                img = await decode(data)
                if img != nil { writeDisk(data, key) }
            case .image(let ui):
                img = await ui.byPreparingForDisplay() ?? ui
            }
            if let img { store(img, key) }
            inflight.withLock { $0[key] = nil }
            return img
        } catch {
            inflight.withLock { $0[key] = nil }
            return nil
        }
    }

    private func store(_ img: UIImage, _ key: String) {
        let cost = Int(img.size.width * img.size.height * img.scale * img.scale * 4)
        memory.setObject(img, forKey: key as NSString, cost: cost)
    }

    private func decode(_ data: Data) async -> UIImage? {
        guard let img = UIImage(data: data) else { return nil }
        return await img.byPreparingForDisplay() ?? img
    }

    // MARK: Disk

    private func fileURL(_ key: String) -> URL? {
        guard let diskURL else { return nil }
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return diskURL.appending(path: digest)
    }

    private func readDisk(_ key: String) async -> Data? {
        guard let url = fileURL(key) else { return nil }
        return await withCheckedContinuation { cont in
            ioQueue.async { cont.resume(returning: try? Data(contentsOf: url)) }
        }
    }

    private func writeDisk(_ data: Data, _ key: String) {
        guard let url = fileURL(key) else { return }
        ioQueue.async { try? data.write(to: url, options: .atomic) }
    }

    /// Trims the disk cache to `limit` bytes, oldest files first. Call at launch.
    func trimDiskCache(limit: Int = 800 * 1024 * 1024) {
        guard let diskURL else { return }
        ioQueue.async {
            let keys: [URLResourceKey] = [.contentModificationDateKey, .totalFileAllocatedSizeKey]
            guard let files = try? FileManager.default.contentsOfDirectory(at: diskURL, includingPropertiesForKeys: keys) else { return }
            var entries = files.compactMap { url -> (URL, Date, Int)? in
                guard let v = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
                return (url, v.contentModificationDate ?? .distantPast, v.totalFileAllocatedSize ?? 0)
            }
            var total = entries.reduce(0) { $0 + $1.2 }
            guard total > limit else { return }
            entries.sort { $0.1 < $1.1 }
            for e in entries where total > limit * 3 / 4 {
                try? FileManager.default.removeItem(at: e.0)
                total -= e.2
            }
        }
    }

    // MARK: Pinned thumbnails (freed-up items)

    private func pinnedFile(_ id: String) -> URL {
        Self.pinnedURL.appending(path: id.replacingOccurrences(of: "/", with: "_"))
    }

    private func readPinned(_ id: String) async -> Data? {
        let url = pinnedFile(id)
        return await withCheckedContinuation { cont in
            ioQueue.async { cont.resume(returning: try? Data(contentsOf: url)) }
        }
    }

    func isPinned(_ id: String) -> Bool { FileManager.default.fileExists(atPath: pinnedFile(id).path) }

    /// Downloads and keeps the grid thumbnail of each id. Returns the ids that are pinned.
    func pin(_ ids: [String]) async -> Set<String> {
        try? FileManager.default.createDirectory(at: Self.pinnedURL, withIntermediateDirectories: true)
        var done = Set<String>()
        await withTaskGroup(of: String?.self) { group in
            var it = ids.makeIterator()
            func next() -> Bool {
                guard let id = it.next() else { return false }
                group.addTask { [self] in
                    if isPinned(id) { return id }
                    guard case .data(let data)? = try? await service.image(ImageRequest(id: id, kind: .thumbnail)),
                          (try? data.write(to: pinnedFile(id), options: .atomic)) != nil else { return nil }
                    return id
                }
                return true
            }
            for _ in 0..<6 where next() {}
            for await id in group {
                if let id { done.insert(id) }
                _ = next()
            }
        }
        return done
    }

    static func clearPinned() {
        try? FileManager.default.removeItem(at: pinnedURL)
    }

    func clearAll() {
        memory.removeAllObjects()
        guard let diskURL else { return }
        ioQueue.async {
            try? FileManager.default.removeItem(at: diskURL)
            try? FileManager.default.createDirectory(at: diskURL, withIntermediateDirectories: true)
        }
    }
}

/// Images straight from the iPhone's photo library.
enum LocalPhotos {
    static func asset(_ localId: String) -> PHAsset? {
        PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil).firstObject
    }

    /// The local rendition, or nil when the asset is gone or only in iCloud (the caller falls back
    /// to the server).
    static func image(_ localId: String, longSide: CGFloat) async -> UIImage? {
        guard let asset = asset(localId) else { return nil }
        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .fast
        opts.isNetworkAccessAllowed = false
        let scale = longSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1))
        let size = scale < 1
            ? CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
            : CGSize(width: asset.pixelWidth, height: asset.pixelHeight)
        let img: UIImage? = await withCheckedContinuation { cont in
            PHImageManager.default().requestImage(for: asset, targetSize: size, contentMode: .aspectFit, options: opts) { img, _ in
                cont.resume(returning: img)
            }
        }
        guard let img else { return nil }
        return await img.byPreparingForDisplay() ?? img
    }

    /// Local playback for a video still on the iPhone.
    static func playerItem(_ localId: String) async -> AVPlayerItem? {
        guard let asset = asset(localId), asset.mediaType == .video else { return nil }
        let opts = PHVideoRequestOptions()
        opts.isNetworkAccessAllowed = false
        opts.deliveryMode = .highQualityFormat
        return await withCheckedContinuation { cont in
            PHImageManager.default().requestPlayerItem(forVideo: asset, options: opts) { item, _ in
                cont.resume(returning: item)
            }
        }
    }
}
