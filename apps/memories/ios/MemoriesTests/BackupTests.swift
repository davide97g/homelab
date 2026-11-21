import CryptoKit
import Foundation
import Testing
@testable import Memories

struct BackupTests {
    func tempDir() throws -> URL {
        let d = FileManager.default.temporaryDirectory.appending(path: "memories-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test func sha1Streaming() throws {
        let dir = try tempDir()
        let f = dir.appending(path: "abc.txt")
        try Data("abc".utf8).write(to: f)
        let d = try Checksum.sha1(of: f, chunkSize: 1)
        #expect(Checksum.hex(d) == "a9993e364706816aba3e25717850c26c9cd0d89d")
        #expect(Checksum.base64(d) == "qZk+NkcGgWq6PiVxeFDCbJzQ2J0=")
    }

    @Test func multipartBody() throws {
        let dir = try tempDir()
        let media = dir.appending(path: "IMG_0001.HEIC")
        let payload = Data((0..<5000).map { UInt8($0 % 251) })
        try payload.write(to: media)
        let part = UploadPart(localId: "L", kind: .livePhoto, stagedFile: media, filename: "IMG_0001.HEIC",
                              checksumHex: "h", checksumBase64: "b", created: Date(timeIntervalSince1970: 0),
                              modified: Date(timeIntervalSince1970: 60), durationMs: nil, isFavorite: true, size: 5000)
        let body = dir.appending(path: "body")
        let size = try MultipartBody.write(to: body, boundary: "BOUND", fields: part.formFields(livePhotoVideoId: "vid"),
                                           fileField: "assetData", filename: part.filename, fileURL: media, chunkSize: 777)
        let data = try Data(contentsOf: body)
        #expect(Int64(data.count) == size)
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.hasPrefix("--BOUND\r\nContent-Disposition: form-data; name=\"fileCreatedAt\"\r\n\r\n1970-01-01T00:00:00.000Z\r\n"))
        #expect(text.contains("name=\"livePhotoVideoId\"\r\n\r\nvid\r\n"))
        #expect(text.contains("name=\"isFavorite\"\r\n\r\ntrue\r\n"))
        #expect(!text.contains("deviceAssetId"))
        #expect(text.contains("name=\"assetData\"; filename=\"IMG_0001.HEIC\"\r\nContent-Type: image/heic\r\n\r\n"))
        #expect(text.hasSuffix("\r\n--BOUND--\r\n"))
        // The file bytes are embedded intact.
        #expect(data.range(of: payload) != nil)
    }

    @Test func liveVideoIsHidden() {
        let p = UploadPart(localId: "L", kind: .liveVideo, stagedFile: URL(fileURLWithPath: "/x.mov"), filename: "x.MOV",
                           checksumHex: "", checksumBase64: "", created: .now, modified: .now, durationMs: nil, isFavorite: false, size: 1)
        let fields = Dictionary(uniqueKeysWithValues: p.formFields(livePhotoVideoId: nil))
        #expect(fields["visibility"] == "hidden")
        #expect(fields["livePhotoVideoId"] == nil)
    }

    @Test func publicLimit() {
        #expect(UploadLimits.publicBodyLimit < 100_000_000)
        #expect(UploadLimits.publicBodyLimit > 99_000_000)
    }

    @Test func stateRoundTrip() throws {
        var s = BackupState()
        s.records["a"] = BackupRecord(remoteId: "r", videoRemoteId: nil, uploadedAt: Date(timeIntervalSince1970: 5))
        s.skipped["b"] = SkippedItem(localId: "b", filename: "big.mov", reason: .tooLargeForPublicURL, detail: "d", size: 200_000_000)
        let back = try JSONDecoder().decode(BackupState.self, from: JSONEncoder().encode(s))
        #expect(back.records == s.records)
        #expect(back.skipped == s.skipped)
    }

    /// Records written before free-up-space have no checksum; they must still load.
    @Test func legacyRecordWithoutChecksum() throws {
        let json = #"{"records":{"L1":{"remoteId":"r1","uploadedAt":5}},"skipped":{}}"#
        let s = try JSONDecoder().decode(BackupState.self, from: Data(json.utf8))
        #expect(s.records["L1"]?.remoteId == "r1")
        #expect(s.records["L1"]?.checksum == nil)
    }

    @Test func deviceIndexSkipsLiveVideoRows() {
        let index = DeviceIndex()
        index.rebuild(from: [
            "L1": BackupRecord(remoteId: "r1", uploadedAt: Date(), checksum: "x"),
            "L2|video": BackupRecord(remoteId: "v2", uploadedAt: Date()),
        ])
        #expect(index.localId(for: "r1") == "L1")
        #expect(index.localId(for: "v2") == nil)
    }
}
