import CoreLocation
import Foundation
import Observation
import Photos
import UIKit

/// The two halves of "the server is the library":
///
/// - **Free up space**: originals that are safely on the server (checked again, one by one, just
///   before deleting) are removed from this iPhone's Photos. Their grid thumbnails are pinned
///   first so the library still browses offline; the viewer fetches the preview from the server on
///   demand and keeps it in the image cache.
/// - **Save to iPhone**: the reverse. A server original (with its live-photo video) goes back into
///   Photos and is recorded as already backed up.
///
/// iOS always asks before an app deletes photos, and deleted items sit in Recently Deleted for
/// 30 days, so "automatic" means: when the app is open and there is something to free, Memories
/// asks (at most once a day).
@MainActor
@Observable
final class SpaceSaver {
    enum Phase: Equatable {
        case idle
        case scanning
        case verifying(Int, Int)
        case pinning
        case waitingForConfirmation
        case done(String)
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    /// Estimate from the last scan (not yet verified against the server).
    private(set) var candidateCount = 0
    private(set) var candidateBytes: Int64 = 0
    private(set) var freedCount = 0
    private(set) var freedBytes: Int64 = 0
    /// Server ids currently downloading into Photos.
    private(set) var saving: Set<String> = []
    /// Bumped whenever which items are on the iPhone changes, so views re-read `isOnDevice`.
    private(set) var deviceRevision = 0

    var isAutomatic: Bool {
        didSet { defaults.set(isAutomatic, forKey: "space.auto") }
    }
    /// Recent items stay on the iPhone; 0 means nothing is kept.
    var keepDays: Int {
        didSet { defaults.set(keepDays, forKey: "space.keepDays"); Task { await refreshEstimate() } }
    }
    var keepFavorites: Bool {
        didSet { defaults.set(keepFavorites, forKey: "space.keepFavorites"); Task { await refreshEstimate() } }
    }

    static let keepChoices = [0, 7, 30, 90, 365]
    /// One deletion prompt covers at most this many items; the next run takes the rest.
    static let batchLimit = 1_000

    var isBusy: Bool {
        switch phase {
        case .scanning, .verifying, .pinning, .waitingForConfirmation: true
        default: false
        }
    }

    @ObservationIgnored var pipeline: ImagePipeline?
    @ObservationIgnored var service: (any MediaService)?
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let backup: BackupManager
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var lastAutoAttempt: Date? {
        get { defaults.object(forKey: "space.lastAuto") as? Date }
        set { defaults.set(newValue, forKey: "space.lastAuto") }
    }

    init(api: APIClient, backup: BackupManager) {
        self.api = api
        self.backup = backup
        isAutomatic = defaults.bool(forKey: "space.auto")
        keepDays = defaults.object(forKey: "space.keepDays") as? Int ?? 30
        keepFavorites = defaults.object(forKey: "space.keepFavorites") as? Bool ?? true
        freedCount = defaults.integer(forKey: "space.freedCount")
        freedBytes = (defaults.object(forKey: "space.freedBytes") as? NSNumber)?.int64Value ?? 0
    }

    private var isMock: Bool { service?.isMock ?? true }
    private var authorized: Bool {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return s == .authorized || s == .limited
    }

    // MARK: Where an item lives

    /// True when the original of this server asset is in this iPhone's Photos.
    func isOnDevice(_ remoteId: String) -> Bool {
        _ = deviceRevision
        guard authorized, let localId = backup.index.localId(for: remoteId) else { return false }
        return LocalPhotos.asset(localId) != nil
    }

    // MARK: Free up space

    struct Candidate: Sendable {
        let localId: String
        let record: BackupRecord
        let isLive: Bool
        let bytes: Int64
    }

    /// Backed-up items still in Photos that the current rules allow removing.
    private func scan() async -> [Candidate] {
        let records = backup.records
        let cutoff = keepDays > 0 ? Calendar.current.date(byAdding: .day, value: -keepDays, to: Date()) ?? Date() : Date()
        let keepFavorites = self.keepFavorites
        return await Task.detached(priority: .utility) {
            Self.candidates(records: records, cutoff: cutoff, keepFavorites: keepFavorites)
        }.value
    }

    nonisolated private static func candidates(records: [String: BackupRecord], cutoff: Date, keepFavorites: Bool) -> [Candidate] {
        var out: [Candidate] = []
        let ids = Array(records.keys)
        for start in stride(from: 0, to: ids.count, by: 500) {
            let chunk = Array(ids[start..<min(ids.count, start + 500)])
            PHAsset.fetchAssets(withLocalIdentifiers: chunk, options: nil).enumerateObjects { a, _, _ in
                guard let record = records[a.localIdentifier] else { return }
                if (a.creationDate ?? .distantFuture) > cutoff { return }
                if keepFavorites && a.isFavorite { return }
                // Shared-album items can't be deleted; hidden ones stay where the user put them.
                if a.sourceType == .typeCloudShared || a.isHidden { return }
                guard a.canPerform(.delete) else { return }
                let resources = PHAssetResource.assetResources(for: a)
                // Edits live only on the iPhone: backup sends the unedited original.
                if resources.contains(where: { $0.type == .adjustmentData || $0.type == .fullSizePhoto || $0.type == .fullSizeVideo }) { return }
                let bytes = resources.reduce(Int64(0)) { $0 + ((($1.value(forKey: "fileSize") as? NSNumber)?.int64Value) ?? 0) }
                out.append(Candidate(localId: a.localIdentifier, record: record,
                                     isLive: a.mediaSubtypes.contains(.photoLive), bytes: bytes))
            }
        }
        return out.sorted { $0.record.uploadedAt < $1.record.uploadedAt }
    }

    func refreshEstimate() async {
        guard authorized, !isBusy else { return }
        let c = await scan()
        candidateCount = c.count
        candidateBytes = c.reduce(0) { $0 + $1.bytes }
    }

    /// Checks each candidate against the server right before deleting. A 404 means the backup
    /// record is stale: it is dropped so the item uploads again.
    private func verify(_ candidates: [Candidate]) async -> (ok: [Candidate], missing: [String]) {
        let api = self.api
        var ok: [Candidate] = [], missing: [String] = [], checked = 0
        await withTaskGroup(of: (Candidate, Bool?).self) { group in
            var it = candidates.makeIterator()
            func next() -> Bool {
                guard let c = it.next() else { return false }
                group.addTask {
                    do {
                        let dto: AssetResponseDto = try await api.get("assets/\(c.record.remoteId)")
                        let good = !dto.isTrashed && dto.isOffline != true
                            && (c.record.checksum == nil || c.record.checksum == dto.checksum)
                            && (!c.isLive || dto.livePhotoVideoId != nil)
                        return (c, good)
                    } catch APIError.http(404, _) {
                        return (c, nil)
                    } catch {
                        return (c, false)
                    }
                }
                return true
            }
            for _ in 0..<6 where next() {}
            for await (c, good) in group {
                checked += 1
                phase = .verifying(checked, candidates.count)
                switch good {
                case true?: ok.append(c)
                case nil: missing.append(c.localId)
                default: break
                }
                _ = next()
            }
        }
        return (ok, missing)
    }

    /// Verify, pin thumbnails, then one system prompt to delete. `automatic` keeps quiet when
    /// there is nothing to do.
    func freeUpSpace(automatic: Bool = false) async {
        guard !isBusy, !isMock else {
            if isMock, !automatic { phase = .failed("Not available with the sample library.") }
            return
        }
        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined { await backup.requestAuthorization() }
        guard authorized else { phase = .failed("Allow Memories full access to Photos first."); return }

        phase = .scanning
        let all = await scan()
        candidateCount = all.count
        candidateBytes = all.reduce(0) { $0 + $1.bytes }
        guard !all.isEmpty else {
            phase = automatic ? .idle : .done("Nothing to free up right now.")
            return
        }
        let batch = Array(all.prefix(Self.batchLimit))
        phase = .verifying(0, batch.count)
        let (verified, missing) = await verify(batch)
        if !missing.isEmpty { backup.forget(missing) }
        guard !verified.isEmpty else {
            phase = .failed(missing.isEmpty ? "Couldn't confirm the server copies. Try again later."
                                            : "\(missing.count) items are missing on the server: backing them up again.")
            if !missing.isEmpty { backup.runNow() }
            return
        }

        phase = .pinning
        let pinned = await pipeline?.pin(verified.map(\.record.remoteId)) ?? []
        // No offline thumbnail, no deletion: the library would show grey cells offline.
        let toDelete = verified.filter { pinned.contains($0.record.remoteId) }
        guard !toDelete.isEmpty else { phase = .failed("Couldn't download the thumbnails. Try again on a better connection."); return }

        phase = .waitingForConfirmation
        let ids = toDelete.map(\.localId)
        do {
            try await PHPhotoLibrary.shared().performChanges(PhotoChanges.delete(ids))
        } catch {
            let ns = error as NSError
            if ns.domain == PHPhotosErrorDomain, ns.code == PHPhotosError.userCancelled.rawValue {
                phase = .idle
            } else {
                phase = .failed(error.localizedDescription)
            }
            return
        }
        // Something may have been kept by the user in the prompt flow: count what is really gone.
        let gone = Set(ids).subtracting(Self.existing(ids))
        let freed = toDelete.filter { gone.contains($0.localId) }
        backup.forget(Array(gone))
        freedCount += freed.count
        freedBytes += freed.reduce(0) { $0 + $1.bytes }
        defaults.set(freedCount, forKey: "space.freedCount")
        defaults.set(NSNumber(value: freedBytes), forKey: "space.freedBytes")
        deviceRevision += 1
        let size = ByteCountFormatter.string(fromByteCount: freed.reduce(0) { $0 + $1.bytes }, countStyle: .file)
        phase = .done("Removed \(freed.count.formatted()) items (\(size)) from this iPhone.")
        await refreshEstimate()
    }

    nonisolated private static func existing(_ ids: [String]) -> Set<String> {
        var s = Set<String>()
        PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { a, _, _ in s.insert(a.localIdentifier) }
        return s
    }

    /// Automatic mode: at most one prompt a day, only in the foreground, only with backup on.
    func maybeAutoClean() {
        guard isAutomatic, backup.isEnabled, !isMock, !isBusy, authorized,
              UIApplication.shared.applicationState == .active else { return }
        if let last = lastAutoAttempt, Date().timeIntervalSince(last) < 20 * 3600 { return }
        Task {
            await refreshEstimate()
            guard candidateCount > 0 else { return }
            lastAutoAttempt = Date()
            await freeUpSpace(automatic: true)
        }
    }

    func resetStats() {
        freedCount = 0
        freedBytes = 0
        defaults.removeObject(forKey: "space.freedCount")
        defaults.removeObject(forKey: "space.freedBytes")
    }

    // MARK: Save to iPhone

    /// Downloads originals into Photos. Returns a message for the toast.
    @discardableResult
    func save(_ assets: [Asset]) async -> String {
        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined { await backup.requestAuthorization() }
        guard authorized else { return "Allow Memories to access Photos in Settings." }
        let todo = assets.filter { !isOnDevice($0.id) && !saving.contains($0.id) }
        guard !todo.isEmpty else { return assets.count == 1 ? "Already on this iPhone." : "All already on this iPhone." }
        saving.formUnion(todo.map(\.id))
        var saved = 0
        var lastError: String?
        for asset in todo {
            do {
                try await saveOne(asset)
                saved += 1
            } catch {
                lastError = error.localizedDescription
            }
            saving.remove(asset.id)
        }
        deviceRevision += 1
        if saved == todo.count {
            return saved == 1 ? (todo[0].isVideo ? "Video saved to this iPhone." : "Photo saved to this iPhone.")
                              : "\(saved.formatted()) items saved to this iPhone."
        }
        return "Saved \(saved) of \(todo.count): \(lastError ?? "unknown error")"
    }

    private func saveOne(_ asset: Asset) async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "save/\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        var main: URL
        var paired: URL?
        var record: BackupRecord?
        if isMock, let service {
            // Sample library: the generated JPEG goes into the simulator's Photos.
            main = try await service.downloadOriginal(asset)
        } else {
            let dto: AssetResponseDto = try await api.get("assets/\(asset.id)")
            main = try await download(asset.id, name: dto.originalFileName, into: dir)
            if let video = dto.livePhotoVideoId {
                let stem = (dto.originalFileName as NSString).deletingPathExtension
                paired = try await download(video, name: stem + ".MOV", into: dir)
            }
            record = BackupRecord(remoteId: asset.id, videoRemoteId: dto.livePhotoVideoId, uploadedAt: Date(), checksum: dto.checksum)
        }

        let isVideo = asset.isVideo
        let created = asset.fileCreatedAt
        let favorite = asset.isFavorite
        let location = asset.coordinate.map { CLLocation(latitude: $0.latitude, longitude: $0.longitude) }
        let mainURL = main, pairedURL = paired
        let box = PlaceholderBox()
        try await PHPhotoLibrary.shared().performChanges(PhotoChanges.create(
            main: mainURL, paired: pairedURL, isVideo: isVideo, created: created, favorite: favorite,
            location: location, box: box))
        if let localId = box.localId, let record {
            backup.adopt(localId: localId, record: record)
        }
    }

    private func download(_ id: String, name: String, into dir: URL) async throws -> URL {
        let req = try api.request("GET", "assets/\(id)/original")
        let (tmp, resp) = try await api.session.download(for: req)
        try api.check(resp, Data())
        let dest = dir.appending(path: name.isEmpty ? id : name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }
}

private final class PlaceholderBox: @unchecked Sendable {
    var localId: String?
}

/// Change blocks for `PHPhotoLibrary.performChanges`, built outside the main actor. Photos runs
/// them on its own queue; a closure written inline in a @MainActor class inherits main-actor
/// isolation, and Swift 6 traps when it runs elsewhere (the free-up-space crash, 2026-11-23).
private enum PhotoChanges {
    static func delete(_ ids: [String]) -> @Sendable () -> Void {
        {
            PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil))
        }
    }

    static func create(main: URL, paired: URL?, isVideo: Bool, created: Date, favorite: Bool,
                       location: CLLocation?, box: PlaceholderBox) -> @Sendable () -> Void {
        {
            let req = PHAssetCreationRequest.forAsset()
            let opts = PHAssetResourceCreationOptions()
            opts.originalFilename = main.lastPathComponent
            req.addResource(with: isVideo ? .video : .photo, fileURL: main, options: opts)
            if let paired {
                let v = PHAssetResourceCreationOptions()
                v.originalFilename = paired.lastPathComponent
                req.addResource(with: .pairedVideo, fileURL: paired, options: v)
            }
            if created > .distantPast { req.creationDate = created }
            req.isFavorite = favorite
            if let location { req.location = location }
            box.localId = req.placeholderForCreatedAsset?.localIdentifier
        }
    }
}
