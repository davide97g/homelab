import Foundation
import Network
import Observation
import Photos

/// Orchestrates backup: PhotoKit scan -> export + SHA-1 -> `/assets/bulk-upload-check` ->
/// background multipart uploads. What's on the server is remembered per PhotoKit local
/// identifier in Application Support/backup-state.json.
@MainActor
@Observable
final class BackupManager {
    enum Phase: Equatable {
        case idle
        case scanning
        case preparing(String)
        case uploading
        case waitingForWiFi
        case done
        case failed(String)
    }

    private(set) var authorization: PHAuthorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    private(set) var phase: Phase = .idle
    private(set) var totalCount = 0
    private(set) var backedUpCount = 0
    private(set) var pendingCount = 0
    private(set) var inFlight = 0
    private(set) var bytesSent: Int64 = 0
    private(set) var bytesExpected: Int64 = 0
    private(set) var skipped: [SkippedItem] = []
    private(set) var lastRun: Date?
    private(set) var lastError: String?
    var isMock = false

    var isEnabled: Bool {
        didSet {
            defaults.set(isEnabled, forKey: "backup.enabled")
            if isEnabled { start() } else { stop() }
        }
    }
    var wifiOnly: Bool {
        didSet { defaults.set(wifiOnly, forKey: "backup.wifiOnly"); uploader.wifiOnly = wifiOnly }
    }
    var includeVideos: Bool {
        didSet { defaults.set(includeVideos, forKey: "backup.includeVideos") }
    }

    var progress: Double {
        totalCount == 0 ? 0 : Double(backedUpCount) / Double(totalCount)
    }

    @ObservationIgnored let uploader: BackgroundUploader
    /// Which server assets still have their original on this iPhone.
    @ObservationIgnored let index = DeviceIndex()
    /// Called after every pass (SpaceSaver's automatic clean-up hooks in here).
    @ObservationIgnored var onPassFinished: (() -> Void)?
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let endpoints: ServerEndpoints
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var state = BackupState()
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var changeObserver: LibraryObserver?
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    @ObservationIgnored private var path: NWPath?
    @ObservationIgnored private let maxQueued = 6

    nonisolated private static var stateURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "backup-state.json")
    }

    init(api: APIClient, endpoints: ServerEndpoints) {
        self.api = api
        self.endpoints = endpoints
        uploader = BackgroundUploader(api: api)
        isEnabled = defaults.bool(forKey: "backup.enabled")
        wifiOnly = defaults.object(forKey: "backup.wifiOnly") as? Bool ?? true
        includeVideos = defaults.object(forKey: "backup.includeVideos") as? Bool ?? true
        uploader.wifiOnly = wifiOnly
        loadState()
        uploader.setHandlers(
            onOutcome: { [weak self] outcome in Task { @MainActor in self?.handle(outcome) } },
            onProgress: { [weak self] sent, total in Task { @MainActor in self?.bytesSent = sent; self?.bytesExpected = total } })
        pathMonitor.pathUpdateHandler = { [weak self] p in Task { @MainActor in self?.path = p } }
        pathMonitor.start(queue: DispatchQueue(label: "memories.backup.path"))
        if isEnabled, authorization == .authorized || authorization == .limited {
            observeLibrary()
            _ = uploader.session // re-attach to tasks from a previous launch
        }
    }

    // MARK: Persistence

    private func loadState() {
        if let data = try? Data(contentsOf: Self.stateURL), let s = try? JSONDecoder().decode(BackupState.self, from: data) {
            state = s
        }
        backedUpCount = state.records.keys.filter { !$0.hasSuffix("|video") }.count
        skipped = Array(state.skipped.values).sorted { $0.filename < $1.filename }
        lastRun = state.lastRun
        index.rebuild(from: state.records)
    }

    private func saveState() {
        let s = state
        Task.detached(priority: .utility) {
            if let data = try? JSONEncoder().encode(s) { try? data.write(to: BackupManager.stateURL, options: .atomic) }
        }
        backedUpCount = state.records.keys.filter { !$0.hasSuffix("|video") }.count
        skipped = Array(state.skipped.values).sorted { $0.filename < $1.filename }
        index.rebuild(from: state.records)
    }

    // MARK: Records for SpaceSaver

    /// Backed-up items keyed by PhotoKit local identifier (live-video bookkeeping rows excluded).
    var records: [String: BackupRecord] { state.records.filter { !$0.key.hasSuffix("|video") } }

    /// An item saved from the server into Photos: it is already backed up.
    func adopt(localId: String, record: BackupRecord) {
        state.records[localId] = record
        state.skipped[localId] = nil
        saveState()
    }

    /// Items removed from Photos (freed up), or whose server copy vanished (so they upload again).
    func forget(_ localIds: [String]) {
        for id in localIds { state.records[id] = nil; state.records[id + "|video"] = nil }
        saveState()
    }

    func resetState() {
        state = BackupState()
        saveState()
        pendingCount = 0
        totalCount = 0
    }

    // MARK: Control

    func requestAuthorization() async {
        authorization = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    func start() {
        Task {
            if authorization == .notDetermined { await requestAuthorization() }
            guard authorization == .authorized || authorization == .limited else { return }
            observeLibrary()
            BackupScheduler.schedule()
            runNow()
        }
    }

    func stop() {
        runTask?.cancel()
        runTask = nil
        uploader.cancelAll()
        phase = .idle
    }

    func runNow() {
        guard runTask == nil else { return }
        runTask = Task {
            await runPass()
            runTask = nil
        }
    }

    /// One pass; used by the UI, the library observer and BGProcessingTask.
    func runPass(deadline: Date? = nil) async {
        guard isEnabled || isMock else { return }
        guard authorization == .authorized || authorization == .limited else {
            phase = .failed("Allow access to Photos in Settings to back up.")
            return
        }
        if wifiOnly, !isMock, let path, path.status == .satisfied, path.usesInterfaceType(.cellular) && !path.usesInterfaceType(.wifi) {
            phase = .waitingForWiFi
            return
        }

        phase = .scanning
        lastError = nil
        let includeVideos = self.includeVideos
        let all = await Task.detached(priority: .utility) { PhotoLibrarySource.candidates(includeVideos: includeVideos) }.value
        totalCount = all.count
        let onLAN = !endpoints.isPublic
        let pending = all.filter { c in
            if state.records[c.localId] != nil { return false }
            if let s = state.skipped[c.localId] {
                // Too-large items get another chance when the LAN URL is active.
                return s.reason == .tooLargeForPublicURL && onLAN
            }
            return true
        }
        pendingCount = pending.count
        if inFlight == 0 { inFlight = await uploader.inFlightCount() }
        if inFlight == 0 { PhotoLibrarySource.cleanStaging() }

        var batch: [(PhotoLibrarySource.Candidate, [UploadPart])] = []
        for c in pending {
            if Task.isCancelled { break }
            if let deadline, Date() > deadline { break }
            phase = .preparing(c.isVideo ? "Video" : "Photo")
            do {
                let parts = try await PhotoLibrarySource.prepareParts(for: c)
                batch.append((c, parts))
            } catch {
                state.skipped[c.localId] = SkippedItem(localId: c.localId, filename: c.localId, reason: .failed,
                                                       detail: "Couldn't read the original: \(error.localizedDescription)")
                continue
            }
            if batch.count >= 8 {
                await process(batch)
                batch = []
                await waitForQueueRoom()
            }
        }
        if !batch.isEmpty, !Task.isCancelled { await process(batch) }
        state.lastRun = Date()
        lastRun = state.lastRun
        saveState()
        if case .failed = phase {} else {
            phase = inFlight > 0 ? .uploading : .done
        }
        onPassFinished?()
    }

    private func waitForQueueRoom() async {
        while !Task.isCancelled {
            inFlight = await uploader.inFlightCount()
            if inFlight < maxQueued { return }
            phase = .uploading
            try? await Task.sleep(for: .seconds(1))
        }
    }

    /// bulk-upload-check, then enqueue what the server doesn't have.
    private func process(_ batch: [(PhotoLibrarySource.Candidate, [UploadPart])]) async {
        let items = batch.flatMap { $0.1 }.map { AssetBulkUploadCheckItem(id: $0.checkID, checksum: $0.checksumBase64) }
        if isMock {
            // No server in mock mode: report what would be sent.
            pendingCount = max(0, pendingCount - batch.count)
            lastError = "Mock mode: \(items.count) files hashed, nothing uploaded."
            for (_, parts) in batch { parts.forEach { try? FileManager.default.removeItem(at: $0.stagedFile.deletingLastPathComponent()) } }
            return
        }
        let results: [String: AssetBulkUploadCheckResult]
        do {
            let res: AssetBulkUploadCheckResponseDto = try await api.send("POST", "assets/bulk-upload-check", body: AssetBulkUploadCheckDto(assets: items))
            results = Dictionary(res.results.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        } catch {
            phase = .failed(error.localizedDescription)
            lastError = error.localizedDescription
            return
        }

        for (c, parts) in batch {
            let decisions = parts.map { (part: $0, result: results[$0.checkID]) }
            func existing(_ d: (part: UploadPart, result: AssetBulkUploadCheckResult?)) -> String? {
                guard let r = d.result, r.action == "reject", r.reason == "duplicate" else { return nil }
                return r.assetId
            }
            if let unsupported = decisions.first(where: { $0.result?.reason == "unsupported-format" }) {
                state.skipped[c.localId] = SkippedItem(localId: c.localId, filename: unsupported.part.filename, reason: .unsupported,
                                                       detail: "The server doesn't accept this format.")
                cleanup(parts)
                continue
            }
            let main = decisions.last!
            if let remote = existing(main) {
                // Already on the server (uploaded by another device or a previous install).
                state.records[c.localId] = BackupRecord(remoteId: remote, videoRemoteId: decisions.count > 1 ? existing(decisions[0]) : nil,
                                                        uploadedAt: Date(), checksum: main.part.checksumBase64)
                state.skipped[c.localId] = nil
                cleanup(parts)
                pendingCount = max(0, pendingCount - 1)
                continue
            }
            if endpoints.isPublic, let big = parts.first(where: { BackgroundUploader.bodySize(for: $0) > UploadLimits.publicBodyLimit }) {
                state.skipped[c.localId] = SkippedItem(
                    localId: c.localId, filename: big.filename, reason: .tooLargeForPublicURL,
                    detail: "Over 100 MB: Cloudflare rejects it on the public URL. It backs up when the LAN URL is reachable.",
                    size: big.size)
                cleanup(parts)
                continue
            }
            do {
                if parts.count == 2 {
                    let video = parts[0], photo = parts[1]
                    if let videoID = existing(decisions[0]) {
                        _ = try uploader.enqueue(photo, livePhotoVideoId: videoID, pairedPhoto: nil)
                        try? FileManager.default.removeItem(at: video.stagedFile)
                    } else {
                        _ = try uploader.enqueue(video, livePhotoVideoId: nil, pairedPhoto: photo)
                    }
                } else {
                    _ = try uploader.enqueue(parts[0], livePhotoVideoId: nil, pairedPhoto: nil)
                }
                inFlight += 1
                phase = .uploading
            } catch {
                state.skipped[c.localId] = SkippedItem(localId: c.localId, filename: main.part.filename, reason: .failed, detail: error.localizedDescription)
                cleanup(parts)
            }
        }
        saveState()
    }

    private func cleanup(_ parts: [UploadPart]) {
        if let dir = parts.first?.stagedFile.deletingLastPathComponent() { try? FileManager.default.removeItem(at: dir) }
    }

    private func handle(_ outcome: BackgroundUploader.Outcome) {
        switch outcome {
        case .uploaded(let job, let res):
            if job.part.kind == .liveVideo {
                // Wait for the photo half; remember the video id meanwhile.
                state.records[job.part.localId + "|video"] = BackupRecord(remoteId: res.id, uploadedAt: Date())
            } else {
                let video = state.records.removeValue(forKey: job.part.localId + "|video")?.remoteId ?? job.livePhotoVideoId
                state.records[job.part.localId] = BackupRecord(remoteId: res.id, videoRemoteId: video, uploadedAt: Date(),
                                                                checksum: job.part.checksumBase64)
                state.skipped[job.part.localId] = nil
                pendingCount = max(0, pendingCount - 1)
                inFlight = max(0, inFlight - 1)
            }
        case .failed(let job, let message):
            inFlight = max(0, inFlight - 1)
            lastError = "\(job.part.filename): \(message)"
            if message.contains("413") {
                state.skipped[job.part.localId] = SkippedItem(
                    localId: job.part.localId, filename: job.part.filename, reason: .tooLargeForPublicURL,
                    detail: "Rejected as too large (HTTP 413). It backs up when the LAN URL is reachable.", size: job.part.size)
            }
            try? FileManager.default.removeItem(at: job.part.stagedFile.deletingLastPathComponent())
        }
        // Live-video bookkeeping rows aren't assets.
        saveState()
        backedUpCount = state.records.keys.filter { !$0.hasSuffix("|video") }.count
        if inFlight == 0, runTask == nil, phase == .uploading { phase = .done }
    }

    // MARK: Library changes

    private func observeLibrary() {
        guard changeObserver == nil else { return }
        let observer = LibraryObserver { [weak self] in
            Task { @MainActor in
                guard let self, self.isEnabled else { return }
                try? await Task.sleep(for: .seconds(3))
                self.runNow()
            }
        }
        PHPhotoLibrary.shared().register(observer)
        changeObserver = observer
    }
}

final class LibraryObserver: NSObject, PHPhotoLibraryChangeObserver, Sendable {
    private let onChange: @Sendable () -> Void
    init(onChange: @escaping @Sendable () -> Void) { self.onChange = onChange }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }
}
