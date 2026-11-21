import Foundation
import UniformTypeIdentifiers

/// Writes a `multipart/form-data` body to disk, streaming the media file in chunks, so a
/// background `URLSession.uploadTask(with:fromFile:)` can send it without holding it in memory.
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
        FileManager.default.createFile(atPath: bodyURL.path, contents: nil)
        let out = try FileHandle(forWritingTo: bodyURL)
        defer { try? out.close() }
        func put(_ s: String) throws { try out.write(contentsOf: Data(s.utf8)) }

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
            try out.write(contentsOf: chunk)
        }
        try put("\r\n--\(boundary)--\r\n")
        return Int64(try out.offset())
    }
}
