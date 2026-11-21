import Foundation
import Synchronization

/// Background `URLSession` that uploads multipart bodies from files. Survives suspension and
/// relaunch: each task's `taskDescription` carries its `UploadJob`, so completion can be handled
/// by a freshly launched app. Live photos chain here (video done -> photo with its id), so the
/// pair completes even when the app is not running.
final class BackgroundUploader: NSObject, URLSessionDataDelegate, Sendable {
    static let sessionID = "it.davideghiotto.memories.backup.session"

    enum Outcome: Sendable {
        case uploaded(UploadJob, AssetMediaResponseDto)
        case failed(UploadJob, String)
    }

    private let api: APIClient
    private let responses = Mutex<[Int: Data]>([:])
    private let handlers = Mutex<(onOutcome: (@Sendable (Outcome) -> Void)?, onProgress: (@Sendable (Int64, Int64) -> Void)?)>((nil, nil))
    private let completion = Mutex<(@Sendable () -> Void)?>(nil)
    private let wifiOnlyFlag = Mutex(true)
    private let sessionBox = Mutex<URLSession?>(nil)

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

    func inFlightCount() async -> Int {
        await session.allTasks.filter { $0.state == .running || $0.state == .suspended }.count
    }

    func cancelAll() {
        session.getAllTasks { $0.forEach { $0.cancel() } }
    }

    // MARK: Enqueue

    /// Writes the multipart body next to the staged file and starts the background task.
    func enqueue(_ part: UploadPart, livePhotoVideoId: String?, pairedPhoto: UploadPart?) throws -> UploadJob {
        let boundary = MultipartBody.makeBoundary()
        let bodyURL = part.stagedFile.deletingLastPathComponent().appending(path: "body-\(part.kind.rawValue).multipart")
        try MultipartBody.write(to: bodyURL, boundary: boundary, fields: part.formFields(livePhotoVideoId: livePhotoVideoId),
                                fileField: "assetData", filename: part.filename, fileURL: part.stagedFile)
        var req = try api.request("POST", "assets")
        req.setValue(MultipartBody.contentType(boundary: boundary), forHTTPHeaderField: "Content-Type")
        req.setValue(part.checksumHex, forHTTPHeaderField: "x-immich-checksum")
        req.allowsCellularAccess = !wifiOnly
        req.allowsExpensiveNetworkAccess = !wifiOnly
        let job = UploadJob(part: part, bodyFile: bodyURL, livePhotoVideoId: livePhotoVideoId, pairedPhoto: pairedPhoto)
        let task = session.uploadTask(with: req, fromFile: bodyURL)
        task.taskDescription = String(data: try JSONEncoder().encode(job), encoding: .utf8)
        task.resume()
        return job
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
        handlers.withLock { $0.onProgress }?(totalBytesSent, totalBytesExpectedToSend)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        let data = responses.withLock { $0.removeValue(forKey: task.taskIdentifier) } ?? Data()
        guard let desc = task.taskDescription?.data(using: .utf8),
              let job = try? JSONDecoder().decode(UploadJob.self, from: desc) else { return }
        try? FileManager.default.removeItem(at: job.bodyFile)
        let onOutcome = handlers.withLock { $0.onOutcome }

        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if let error {
            onOutcome?(.failed(job, error.localizedDescription))
            return
        }
        guard (200..<300).contains(status), let res = try? JSONDecoder().decode(AssetMediaResponseDto.self, from: data) else {
            onOutcome?(.failed(job, status == 413 ? "Too large for this connection (HTTP 413)." : "HTTP \(status): \(APIClient.message(from: data))"))
            return
        }
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

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let f = completion.withLock { c -> (@Sendable () -> Void)? in let f = c; c = nil; return f }
        DispatchQueue.main.async { f?() }
    }
}
