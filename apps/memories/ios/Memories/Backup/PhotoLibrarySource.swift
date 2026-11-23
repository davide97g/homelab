import Foundation
import Photos

/// PhotoKit side of backup: enumerate, export original resources to files, hash them.
enum PhotoLibrarySource {
    struct Candidate: Sendable {
        let localId: String
        let isVideo: Bool
        let isLive: Bool
        let created: Date
        let modified: Date
        let durationMs: Int?
        let isFavorite: Bool
    }

    static var stagingRoot: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "backup-staging", directoryHint: .isDirectory)
    }

    /// Newest first, like Immich's own app: recent shots are safe soonest.
    static func candidates(includeVideos: Bool) -> [Candidate] {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        opts.includeAssetSourceTypes = [.typeUserLibrary, .typeiTunesSynced, .typeCloudShared]
        opts.predicate = includeVideos
            ? NSPredicate(format: "mediaType == %d || mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
            : NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        let result = PHAsset.fetchAssets(with: opts)
        var out: [Candidate] = []
        out.reserveCapacity(result.count)
        result.enumerateObjects { a, _, _ in
            out.append(Candidate(
                localId: a.localIdentifier,
                isVideo: a.mediaType == .video,
                isLive: a.mediaSubtypes.contains(.photoLive),
                created: a.creationDate ?? a.modificationDate ?? Date(),
                modified: a.modificationDate ?? a.creationDate ?? Date(),
                durationMs: a.mediaType == .video ? Int(a.duration * 1000) : nil,
                isFavorite: a.isFavorite))
        }
        return out
    }

    /// Exports the original resource(s) of an asset and hashes them. Live photos give two parts
    /// (video first).
    static func prepareParts(for c: Candidate) async throws -> [UploadPart] {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [c.localId], options: nil).firstObject else {
            throw CocoaError(.fileNoSuchFile)
        }
        let resources = PHAssetResource.assetResources(for: asset)
        let dir = stagingRoot.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        func pick(_ types: [PHAssetResourceType]) -> PHAssetResource? {
            for t in types { if let r = resources.first(where: { $0.type == t }) { return r } }
            return nil
        }
        var plan: [(PHAssetResource, UploadPart.Kind)] = []
        if c.isVideo {
            if let r = pick([.video, .fullSizeVideo]) { plan.append((r, .single)) }
        } else if c.isLive, let photo = pick([.photo, .fullSizePhoto]), let video = pick([.pairedVideo, .fullSizePairedVideo]) {
            plan.append((video, .liveVideo))
            plan.append((photo, .livePhoto))
        } else if let r = pick([.photo, .fullSizePhoto, .alternatePhoto]) {
            plan.append((r, .single))
        }
        guard !plan.isEmpty else { throw CocoaError(.fileReadUnknown) }

        var parts: [UploadPart] = []
        for (resource, kind) in plan {
            let name = resource.originalFilename
            let file = dir.appending(path: "\(kind.rawValue)-\(name)")
            try await export(resource, to: file)
            let digest = try Checksum.sha1(of: file)
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
            parts.append(UploadPart(
                localId: c.localId, kind: kind, stagedFile: file, filename: name,
                checksumHex: Checksum.hex(digest), checksumBase64: Checksum.base64(digest),
                created: c.created, modified: c.modified,
                durationMs: kind == .single ? c.durationMs : nil,
                isFavorite: c.isFavorite, size: size))
        }
        return parts
    }

    private static func export(_ resource: PHAssetResource, to url: URL) async throws {
        let opts = PHAssetResourceRequestOptions()
        opts.isNetworkAccessAllowed = true // originals may live in iCloud only
        nonisolated(unsafe) let r = resource
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, any Error>) in
            PHAssetResourceManager.default().writeData(for: r, toFile: url, options: opts) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    /// Removes leftover staging folders: not used by a queued upload and older than `minAge`.
    /// Never the whole root: between one relay piece finishing and the next starting no task is
    /// in flight, and wiping it then deleted the next piece under the uploader (crash, 2026-11-23).
    static func cleanStaging(keeping: Set<String>, minAge: TimeInterval = 6 * 3600) {
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(at: stagingRoot, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-minAge)
        for d in dirs where !keeping.contains(d.lastPathComponent) {
            let modified = (try? d.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if modified < cutoff { try? fm.removeItem(at: d) }
        }
    }
}
