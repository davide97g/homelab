import CryptoKit
import Foundation
import Synchronization

/// One file to send: a still, a video, or one half of a live photo.
struct UploadPart: Codable, Sendable, Equatable {
    enum Kind: String, Codable, Sendable { case single, liveVideo, livePhoto }

    var localId: String
    var kind: Kind
    var stagedFile: URL
    var filename: String
    var checksumHex: String
    var checksumBase64: String
    var created: Date
    var modified: Date
    var durationMs: Int?
    var isFavorite: Bool
    var size: Int64

    /// Id echoed by `/assets/bulk-upload-check`.
    var checkID: String { "\(localId)|\(kind.rawValue)" }

    /// `AssetMediaCreateDto` fields (v3: no deviceAssetId/deviceId).
    func formFields(livePhotoVideoId: String?) -> [(String, String)] {
        var f: [(String, String)] = [
            ("fileCreatedAt", DateParsing.string(created)),
            ("fileModifiedAt", DateParsing.string(modified)),
            ("filename", filename),
            ("isFavorite", isFavorite ? "true" : "false"),
        ]
        if let durationMs { f.append(("duration", String(durationMs))) }
        if let livePhotoVideoId { f.append(("livePhotoVideoId", livePhotoVideoId)) }
        // The motion half of a live photo stays out of the timeline, like Immich's own app.
        if kind == .liveVideo { f.append(("visibility", "hidden")) }
        return f
    }
}

/// Stored in `URLSessionTask.taskDescription` so a relaunched app can finish the job.
struct UploadJob: Codable, Sendable {
    var part: UploadPart
    var bodyFile: URL
    var livePhotoVideoId: String?
    /// For a live video: the photo to send once the video has an id.
    var pairedPhoto: UploadPart?
    /// Set when the body is over Cloudflare's cap and goes in pieces through the relay.
    var chunks: ChunkPlan? = nil
}

/// A body too big for one request through Cloudflare, cut into pieces that are PUT one after
/// another to the relay next to the proxy (`<public api>/memories/upload/<id>/<index>`, see
/// apps/memories/upload-relay). The relay answers 202 per piece and, on the last one, posts
/// the reassembled body to Immich and returns Immich's answer.
struct ChunkPlan: Codable, Sendable {
    var uploadID: String
    /// The public API URL the relay lives under (fixed for the whole upload).
    var base: URL
    var files: [URL]
    var index: Int
    /// Bytes in the pieces before `index`, and in all of them (progress).
    var offset: Int64
    var total: Int64
    var contentType: String
    /// Tries of the current piece.
    var attempt: Int
}

struct BackupRecord: Codable, Sendable, Equatable {
    var remoteId: String
    var videoRemoteId: String?
    var uploadedAt: Date
    /// Base64 SHA-1 of the file the server has (absent in records written before 0.2).
    var checksum: String? = nil
}

/// Thread-safe "server asset id -> PhotoKit local identifier" map, rebuilt from the backup
/// records. The image pipeline and the players read it to prefer the copy on this iPhone.
final class DeviceIndex: Sendable {
    private let map = Mutex<[String: String]>([:])

    func localId(for remoteId: String) -> String? { map.withLock { $0[remoteId] } }

    func rebuild(from records: [String: BackupRecord]) {
        var m: [String: String] = [:]
        for (localId, r) in records where !localId.hasSuffix("|video") { m[r.remoteId] = localId }
        map.withLock { $0 = m }
    }
}

struct SkippedItem: Codable, Sendable, Identifiable, Equatable {
    enum Reason: String, Codable, Sendable { case tooLargeForPublicURL, unsupported, failed }
    var localId: String
    var filename: String
    var reason: Reason
    var detail: String
    var size: Int64?
    /// When it was skipped; `.failed` items get another go after a while (absent before 0.3).
    var at: Date? = nil
    var id: String { localId }
}

struct BackupState: Codable, Sendable {
    var records: [String: BackupRecord] = [:]
    var skipped: [String: SkippedItem] = [:]
    var lastRun: Date?
}

enum Checksum {
    /// Streaming SHA-1 of a file (never loads it whole).
    static func sha1(of url: URL, chunkSize: Int = 4 << 20) throws -> Insecure.SHA1.Digest {
        let fh = try FileHandle(forReadingFrom: url)
        defer { try? fh.close() }
        var hasher = Insecure.SHA1()
        while let chunk = try fh.read(upToCount: chunkSize), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize()
    }

    static func hex(_ d: Insecure.SHA1.Digest) -> String { d.map { String(format: "%02x", $0) }.joined() }
    static func base64(_ d: Insecure.SHA1.Digest) -> String { Data(d).base64EncodedString() }
}

/// Cloudflare's free plan rejects request bodies over 100 MB on the public hostname.
enum UploadLimits {
    static let publicBodyLimit: Int64 = 100 * 1_000_000 - 64 * 1024
    /// Piece size for the relay; it may ask for smaller (`maxChunkSize` in its config).
    static let chunkSize: Int64 = 90 * 1_000_000
}
