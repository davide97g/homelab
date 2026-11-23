import Foundation
import UniformTypeIdentifiers

/// Writes a `multipart/form-data` body to disk, streaming the media file in chunks, so a
/// background `URLSession.uploadTask(with:fromFile:)` can send it without holding it in memory.
/// The body can also be cut into pieces of at most `maxPieceSize` bytes for the upload relay.
enum MultipartBody {
    static func makeBoundary() -> String { "memories-\(UUID().uuidString)" }

    static func contentType(boundary: String) -> String { "multipart/form-data; boundary=\(boundary)" }

    static func mimeType(forFilename name: String) -> String {
        let ext = (name as NSString).pathExtension
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    /// - Returns: size of the written body in bytes.
    @discardableResult
    static func write(
        to bodyURL: URL, boundary: String, fields: [(String, String)],
        fileField: String, filename: String, fileURL: URL, chunkSize: Int = 1 << 20
    ) throws -> Int64 {
        let out = RollingWriter(limit: .max) { _ in bodyURL }
        try write(into: out, boundary: boundary, fields: fields, fileField: fileField, filename: filename,
                  fileURL: fileURL, chunkSize: chunkSize)
        return out.total
    }

    /// The same body cut into consecutive files of at most `maxPieceSize` bytes, named by `piece`.
    /// - Returns: the piece files in order, and the body size.
    static func writePieces(
        maxPieceSize: Int64, piece: @escaping (Int) -> URL, boundary: String, fields: [(String, String)],
        fileField: String, filename: String, fileURL: URL, chunkSize: Int = 1 << 20
    ) throws -> (files: [URL], total: Int64) {
        let out = RollingWriter(limit: maxPieceSize, makeURL: piece)
        try write(into: out, boundary: boundary, fields: fields, fileField: fileField, filename: filename,
                  fileURL: fileURL, chunkSize: chunkSize)
        return (out.urls, out.total)
    }

    private static func write(
        into out: RollingWriter, boundary: String, fields: [(String, String)],
        fileField: String, filename: String, fileURL: URL, chunkSize: Int
    ) throws {
        defer { try? out.close() }
        func put(_ s: String) throws { try out.write(Data(s.utf8)) }

        // Text fields first so the server has them before the file streams in.
        for (name, value) in fields {
            try put("--\(boundary)\r\n")
            try put("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            try put("\(value)\r\n")
        }
        let safeName = filename.replacingOccurrences(of: "\"", with: "_")
        try put("--\(boundary)\r\n")
        try put("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(safeName)\"\r\n")
        try put("Content-Type: \(mimeType(forFilename: filename))\r\n\r\n")

        let input = try FileHandle(forReadingFrom: fileURL)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: chunkSize), !chunk.isEmpty {
            try out.write(chunk)
        }
        try put("\r\n--\(boundary)--\r\n")
        try out.close()
    }
}

/// Appends to a file, moving on to a new one each time `limit` bytes have been written.
private final class RollingWriter {
    private let limit: Int64
    private let makeURL: (Int) -> URL
    private(set) var urls: [URL] = []
    private(set) var total: Int64 = 0
    private var handle: FileHandle?
    private var written: Int64 = 0

    init(limit: Int64, makeURL: @escaping (Int) -> URL) {
        self.limit = limit
        self.makeURL = makeURL
    }

    func write(_ data: Data) throws {
        var rest = data[...]
        while !rest.isEmpty {
            if handle == nil || written >= limit { try roll() }
            let n = Int(min(Int64(rest.count), limit - written))
            try handle!.write(contentsOf: rest.prefix(n))
            rest = rest.dropFirst(n)
            written += Int64(n)
            total += Int64(n)
        }
    }

    func close() throws {
        try handle?.close()
        handle = nil
    }

    private func roll() throws {
        try close()
        let url = makeURL(urls.count)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
        urls.append(url)
        written = 0
    }
}
