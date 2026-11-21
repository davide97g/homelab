import Foundation
import Network
import Synchronization

/// Where the API lives right now. The public URL always works; an optional LAN URL is preferred
/// whenever it answers `/server/ping` (checked on every network path change).
///
/// This deliberately does not read the Wi-Fi SSID: that needs the "Access Wi-Fi Information"
/// entitlement plus location permission. Probing the LAN address gives the same result
/// (home network -> LAN, elsewhere -> public) with no extra capability.
final class ServerEndpoints: Sendable {
    struct State: Sendable, Equatable {
        var publicAPI: URL?
        var lanAPI: URL?
        var usingLAN = false
        var active: URL? { usingLAN ? (lanAPI ?? publicAPI) : publicAPI }
    }

    private let state: Mutex<State>
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "memories.endpoints")
    private let onChange: Mutex<(@Sendable (State) -> Void)?> = Mutex(nil)

    init(publicAPI: URL?, lanAPI: URL?) {
        state = Mutex(State(publicAPI: publicAPI, lanAPI: lanAPI))
    }

    var current: State { state.withLock { $0 } }
    var activeAPI: URL? { state.withLock { $0.active } }

    /// True when requests go over the public (Cloudflare) URL and so hit the 100 MB cap.
    var isPublic: Bool { state.withLock { !$0.usingLAN } }

    func update(publicAPI: URL?, lanAPI: URL?) {
        state.withLock {
            $0.publicAPI = publicAPI
            $0.lanAPI = lanAPI
            if lanAPI == nil { $0.usingLAN = false }
        }
        Task { await self.probe() }
    }

    func setOnChange(_ handler: @escaping @Sendable (State) -> Void) {
        onChange.withLock { $0 = handler }
    }

    func start() {
        monitor.pathUpdateHandler = { [weak self] _ in
            guard let self else { return }
            Task { await self.probe() }
        }
        monitor.start(queue: queue)
    }

    /// Pings the LAN API with a short timeout and switches accordingly.
    func probe() async {
        let lan = state.withLock { $0.lanAPI }
        var reachable = false
        if let lan {
            var req = URLRequest(url: lan.appending(path: "server/ping"))
            req.timeoutInterval = 2
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 2
            config.waitsForConnectivity = false
            let session = URLSession(configuration: config)
            if let (_, resp) = try? await session.data(for: req),
               (resp as? HTTPURLResponse)?.statusCode == 200 {
                reachable = true
            }
            session.invalidateAndCancel()
        }
        let (changed, snapshot) = state.withLock { s -> (Bool, State) in
            let old = s.usingLAN
            s.usingLAN = reachable
            return (old != reachable, s)
        }
        if changed { onChange.withLock { $0 }?(snapshot) }
    }

    // MARK: Discovery

    enum DiscoveryError: LocalizedError {
        case invalidURL
        case notImmich(String)

        var errorDescription: String? {
            switch self {
            case .invalidURL: "That doesn't look like a server address."
            case .notImmich(let detail): "No Immich server answered there. \(detail)"
            }
        }
    }

    /// Normalises what the user typed: adds https:// when no scheme, drops trailing slashes.
    static func normalize(_ input: String) -> URL? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host() != nil else { return nil }
        return url
    }

    /// `<server>/.well-known/immich` -> `{"api":{"endpoint":"/api"}}` -> `<server>/api`, then
    /// checks `/server/version`. Falls back to `<server>/api` and to the URL as typed.
    static func discover(_ server: URL, session: URLSession = .shared) async throws -> (api: URL, version: ServerVersionResponseDto) {
        var candidates: [URL] = []
        if let (data, resp) = try? await session.data(from: server.appending(path: ".well-known/immich")),
           (resp as? HTTPURLResponse)?.statusCode == 200,
           let wk = try? JSONDecoder().decode(WellKnownDto.self, from: data) {
            candidates.append(resolve(endpoint: wk.api.endpoint, against: server))
        }
        candidates.append(server.appending(path: "api"))
        if server.lastPathComponent == "api" { candidates.insert(server, at: 0) }

        var lastError = "Check the address."
        for api in candidates {
            do {
                var req = URLRequest(url: api.appending(path: "server/version"))
                req.timeoutInterval = 10
                let (data, resp) = try await session.data(for: req)
                guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
                    lastError = "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0) from \(api.absoluteString)."
                    continue
                }
                let v = try JSONDecoder().decode(ServerVersionResponseDto.self, from: data)
                return (api, v)
            } catch {
                lastError = error.localizedDescription
            }
        }
        throw DiscoveryError.notImmich(lastError)
    }

    static func resolve(endpoint: String, against server: URL) -> URL {
        if endpoint.hasPrefix("http://") || endpoint.hasPrefix("https://"), let abs = URL(string: endpoint) {
            return abs
        }
        var base = server.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        let path = endpoint.hasPrefix("/") ? endpoint : "/" + endpoint
        return URL(string: base + path) ?? server.appending(path: "api")
    }
}
