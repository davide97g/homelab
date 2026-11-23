import Foundation
import Synchronization

/// Background `URLSession` that uploads multipart bodies from files. Survives suspension and
/// relaunch: each task's `taskDescription` carries its `UploadJob`, so completion can be handled
/// by a freshly launched app. Two kinds of follow-up are chained here, in the delegate, so they
/// carry on while the app is not running:
/// - live photos: video done -> photo with its id;
/// - pieces for the relay (bodies over Cloudflare's 100 MB cap): piece n done -> piece n+1.
final class BackgroundUploader: NSObject, URLSessionDataDelegate, Sendable {
    static let sessionID = "it.davideghiotto.memories.backup.session"
    /// Tries per relay piece before the whole item is given up (and retried by a later pass).
    static let pieceAttempts = 4

    enum Outcome: Sendable {
        case uploaded(UploadJob, AssetMediaResponseDto)
        case failed(UploadJob, String)
        /// Cancelled on purpose (backup turned off, LAN URL gone): not an error.
        case cancelled(UploadJob)
    }

    private let api: APIClient
    private let responses = Mutex<[Int: Data]>([:])
    private let handlers = Mutex<(onOutcome: (@Sendable (Outcome) -> Void)?, onProgress: (@Sendable (Int64, Int64) -> Void)?)>((nil, nil))
    /// Called when iOS has delivered every pending event; gets the completion iOS handed us.
    private let onWake = Mutex<(@Sendable (@escaping @Sendable () -> Void) -> Void)?>(nil)
    private let completion = Mutex<(@Sendable () -> Void)?>(nil)
    private let wifiOnlyFlag = Mutex(true)
    private let sessionBox = Mutex<URLSession?>(nil)
    /// Progress offset of relay pieces, by task id (bytes already sent, body size).
    private let pieceProgress = Mutex<[Int: (offset: Int64, total: Int64)]>([:])

    init(api: APIClient) {
        self.api = api
        super.init()
    }

    var session: URLSession {
        sessionBox.withLock { box in
            if let s = box { return s }
            let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
            config.sessionSendsLaunchEvents = true
            config.isDiscretionary = false
            config.httpMaximumConnectionsPerHost = 3
            config.timeoutIntervalForResource = 24 * 3600
            let s = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            box = s
            return s
        }
    }

    /// Set by the app delegate when iOS relaunches us for session events.
    func setBackgroundCompletion(_ handler: @escaping @Sendable () -> Void) {
        completion.withLock { $0 = handler }
        _ = session // reconnect so pending events are delivered
    }

    var wifiOnly: Bool {
        get { wifiOnlyFlag.withLock { $0 } }
        set { wifiOnlyFlag.withLock { $0 = newValue } }
    }

    func setHandlers(onOutcome: @escaping @Sendable (Outcome) -> Void, onProgress: @escaping @Sendable (Int64, Int64) -> Void) {
        handlers.withLock { $0 = (onOutcome, onProgress) }
    }

    /// The manager queues more work here before iOS is told we're done (and suspends us).
    func setOnWake(_ f: @escaping @Sendable (@escaping @Sendable () -> Void) -> Void) {
        onWake.withLock { $0 = f }
    }

    func inFlightCount() async -> Int {
        await session.allTasks.filter { $0.state == .running || $0.state == .suspended }.count
    }

    func cancelAll() {
        session.getAllTasks { $0.forEach { $0.cancel() } }
    }

    /// Cancels the tasks whose URL matches, e.g. those aimed at a LAN address that's gone: in a
    /// background session they would wait for it for up to a day, holding queue slots.
    func cancel(where match: @escaping @Sendable (URL) -> Bool) async -> Int {
        let tasks = await session.allTasks.filter { t in t.originalRequest?.url.map(match) ?? false }
        tasks.forEach { $0.cancel() }
        return tasks.count
    }

    // MARK: Enqueue

    /// Writes the multipart body next to the staged file and starts the background task. With
    /// `relay` (the public API URL, when the body is over Cloudflare's cap) the body is written
    /// in pieces and sent through the upload relay instead of `POST /assets`.
    func enqueue(_ part: UploadPart, livePhotoVideoId: String?, pairedPhoto: UploadPart?,
                 relay: (base: URL, pieceSize: Int64)? = nil) throws -> UploadJob {
        let boundary = MultipartBody.makeBoundary()
        let dir = part.stagedFile.deletingLastPathComponent()
        let fields = part.formFields(livePhotoVideoId: livePhotoVideoId)
        let bodyURL = dir.appending(path: "body-\(part.kind.rawValue).multipart")

        if let relay {
            let (files, total) = try MultipartBody.writePieces(
                maxPieceSize: relay.pieceSize, piece: { dir.appending(path: "piece-\(part.kind.rawValue)-\(String(format: "%05d", $0))") },
                boundary: boundary, fields: fields, fileField: "assetData", filename: part.filename, fileURL: part.stagedFile)
            // The pieces hold everything now; don't keep a second copy of a multi-GB video.
            if part.kind == .single { try? FileManager.default.removeItem(at: part.stagedFile) }
            let plan = ChunkPlan(uploadID: UUID().uuidString.lowercased(), base: relay.base, files: files, index: 0,
                                 offset: 0, total: total, contentType: MultipartBody.contentType(boundary: boundary), attempt: 1)
            let job = UploadJob(part: part, bodyFile: bodyURL, livePhotoVideoId: livePhotoVideoId, pairedPhoto: pairedPhoto, chunks: plan)
            try startPiece(job)
            return job
        }

        try MultipartBody.write(to: bodyURL, boundary: boundary, fields: fields,
                                fileField: "assetData", filename: part.filename, fileURL: part.stagedFile)
        if part.kind == .single { try? FileManager.default.removeItem(at: part.stagedFile) }
        var req = try api.request("POST", "assets")
        req.setValue(MultipartBody.contentType(boundary: boundary), forHTTPHeaderField: "Content-Type")
        req.setValue(part.checksumHex, forHTTPHeaderField: "x-immich-checksum")
        req.allowsCellularAccess = !wifiOnly
        req.allowsExpensiveNetworkAccess = !wifiOnly
        let job = UploadJob(part: part, bodyFile: bodyURL, livePhotoVideoId: livePhotoVideoId, pairedPhoto: pairedPhoto)
        guard FileManager.default.fileExists(atPath: bodyURL.path) else { throw CocoaError(.fileNoSuchFile) }
        let task = session.uploadTask(with: req, fromFile: bodyURL)
        task.taskDescription = String(data: try JSONEncoder().encode(job), encoding: .utf8)
        task.resume()
        return job
    }

    /// PUT `<base>/memories/upload/<id>/<index>` with the current piece.
    private func startPiece(_ job: UploadJob) throws {
        guard let plan = job.chunks else { return }
        // uploadTask(fromFile:) raises an Objective-C exception for a missing file, which Swift
        // can't catch: the app just dies (2026-11-23). A thrown error fails the item instead.
        guard plan.index < plan.files.count, FileManager.default.fileExists(atPath: plan.files[plan.index].path) else {
            throw CocoaError(.fileNoSuchFile)
        }
        var req = URLRequest(url: plan.base.appending(path: "memories/upload/\(plan.uploadID)/\(plan.index)"))
        req.httpMethod = "PUT"
        for (k, v) in api.authHeaders { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.setValue(String(plan.files.count), forHTTPHeaderField: "X-Upload-Chunks")
        req.setValue(plan.contentType, forHTTPHeaderField: "X-Upload-Content-Type")
        req.setValue(job.part.checksumHex, forHTTPHeaderField: "X-Immich-Checksum")
        req.allowsCellularAccess = !wifiOnly
        req.allowsExpensiveNetworkAccess = !wifiOnly
        let task = session.uploadTask(with: req, fromFile: plan.files[plan.index])
        task.taskDescription = String(data: try JSONEncoder().encode(job), encoding: .utf8)
        pieceProgress.withLock { $0[task.taskIdentifier] = (plan.offset, plan.total) }
        task.resume()
    }

    static func bodySize(for part: UploadPart) -> Int64 {
        // Fields + headers are < 2 KB.
        part.size + 2048
    }

    // MARK: Delegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responses.withLock { $0[dataTask.taskIdentifier, default: Data()].append(data) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        let piece = pieceProgress.withLock { $0[task.taskIdentifier] }
        let report = handlers.withLock { $0.onProgress }
        if let piece {
            report?(piece.offset + totalBytesSent, piece.total)
        } else {
            report?(totalBytesSent, totalBytesExpectedToSend)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        let data = responses.withLock { $0.removeValue(forKey: task.taskIdentifier) } ?? Data()
        pieceProgress.withLock { _ = $0.removeValue(forKey: task.taskIdentifier) }
        guard let desc = task.taskDescription?.data(using: .utf8),
              let job = try? JSONDecoder().decode(UploadJob.self, from: desc) else { return }
        let onOutcome = handlers.withLock { $0.onOutcome }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0

        if let error {
            if (error as? URLError)?.code == .cancelled {
                onOutcome?(.cancelled(job))
            } else if job.chunks != nil {
                retryPiece(job, onOutcome: onOutcome, reason: error.localizedDescription)
            } else {
                try? FileManager.default.removeItem(at: job.bodyFile)
                onOutcome?(.failed(job, error.localizedDescription))
            }
            return
        }

        if var plan = job.chunks, status == 202 {
            // Piece accepted, more to go.
            let sent = (try? plan.files[plan.index].resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
            try? FileManager.default.removeItem(at: plan.files[plan.index])
            plan.offset = min(plan.offset + sent, plan.total)
            plan.index += 1
            plan.attempt = 1
            var next = job
            next.chunks = plan
            guard plan.index < plan.files.count else {
                onOutcome?(.failed(job, "The upload relay wanted more pieces than there are."))
                return
            }
            do { try startPiece(next) } catch { onOutcome?(.failed(job, error.localizedDescription)) }
            return
        }

        guard (200..<300).contains(status), let res = try? JSONDecoder().decode(AssetMediaResponseDto.self, from: data) else {
            // Relay hiccups (Cloudflare 524 while Immich takes a big file, a 502 from the relay)
            // are worth another try of the same piece; the relay remembers finished uploads.
            if job.chunks != nil, status >= 500 || status == 408 || status == 429 {
                retryPiece(job, onOutcome: onOutcome, reason: "HTTP \(status)")
                return
            }
            try? FileManager.default.removeItem(at: job.bodyFile)
            onOutcome?(.failed(job, status == 413 ? "Too large for this connection (HTTP 413)." : "HTTP \(status): \(APIClient.message(from: data))"))
            return
        }
        try? FileManager.default.removeItem(at: job.bodyFile)
        if job.part.kind != .liveVideo {
            try? FileManager.default.removeItem(at: job.part.stagedFile.deletingLastPathComponent())
        } else {
            try? FileManager.default.removeItem(at: job.part.stagedFile)
        }
        onOutcome?(.uploaded(job, res))
        if let photo = job.pairedPhoto {
            do {
                _ = try enqueue(photo, livePhotoVideoId: res.id, pairedPhoto: nil)
            } catch {
                onOutcome?(.failed(UploadJob(part: photo, bodyFile: job.bodyFile), error.localizedDescription))
            }
        }
    }

    private func retryPiece(_ job: UploadJob, onOutcome: (@Sendable (Outcome) -> Void)?, reason: String) {
        guard var plan = job.chunks, plan.attempt < Self.pieceAttempts else {
            onOutcome?(.failed(job, "Piece \((job.chunks?.index ?? 0) + 1) of \(job.chunks?.files.count ?? 0): \(reason)"))
            return
        }
        plan.attempt += 1
        var again = job
        again.chunks = plan
        do { try startPiece(again) } catch { onOutcome?(.failed(job, error.localizedDescription)) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let f = completion.withLock { c -> (@Sendable () -> Void)? in let f = c; c = nil; return f }
        let done: @Sendable () -> Void = { DispatchQueue.main.async { f?() } }
        if let wake = onWake.withLock({ $0 }) {
            wake(done)
        } else {
            done()
        }
    }
}
