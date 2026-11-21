import Foundation
import Synchronization

enum APIError: LocalizedError, Equatable {
    case notConfigured
    case unauthorized
    case http(Int, String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: "No server configured."
        case .unauthorized: "Your session has expired. Sign in again."
        case .http(let code, let message): message.isEmpty ? "Server error \(code)." : "\(message) (\(code))"
        case .decoding(let what): "Unexpected response from the server: \(what)"
        }
    }
}

/// Thin async/await client over URLSession. Bearer token from the Keychain, base URL from
/// `ServerEndpoints` (public or LAN).
final class APIClient: Sendable {
    let endpoints: ServerEndpoints
    private let tokenStore: Mutex<String?>
    let session: URLSession
    /// Called (off the main actor) when the server answers 401.
    private let onUnauthorized: Mutex<(@Sendable () -> Void)?> = Mutex(nil)

    init(endpoints: ServerEndpoints, token: String?, session: URLSession? = nil) {
        self.endpoints = endpoints
        self.tokenStore = Mutex(token)
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.httpMaximumConnectionsPerHost = 8
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.urlCache = nil // images have their own disk cache
            config.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: config)
        }
    }

    var token: String? { tokenStore.withLock { $0 } }
    func setToken(_ token: String?) { tokenStore.withLock { $0 = token } }
    func setOnUnauthorized(_ f: @escaping @Sendable () -> Void) { onUnauthorized.withLock { $0 = f } }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    var authHeaders: [String: String] {
        guard let token else { return [:] }
        return ["Authorization": "Bearer \(token)"]
    }

    func url(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard let base = endpoints.activeAPI else { throw APIError.notConfigured }
        var url = base.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        return url
    }

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil) throws -> URLRequest {
        var req = URLRequest(url: try url(path, query: query))
        req.httpMethod = method
        for (k, v) in authHeaders { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    // MARK: Calls

    func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = [], as: T.Type = T.self) async throws -> T {
        try await decode(T.self, from: request("GET", path, query: query))
    }

    func send<T: Decodable & Sendable>(_ method: String, _ path: String, body: some Encodable, as: T.Type = T.self) async throws -> T {
        try await decode(T.self, from: request(method, path, body: Self.encoder.encode(body)))
    }

    func sendNoContent(_ method: String, _ path: String, body: some Encodable) async throws {
        _ = try await perform(request(method, path, body: Self.encoder.encode(body)))
    }

    func data(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        try await perform(request("GET", path, query: query))
    }

    @discardableResult
    func perform(_ req: URLRequest) async throws -> Data {
        let (data, resp) = try await session.data(for: req)
        try check(resp, data)
        return data
    }

    func check(_ resp: URLResponse, _ data: Data) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        if http.statusCode == 401 {
            onUnauthorized.withLock { $0 }?()
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.message(from: data))
        }
    }

    private func decode<T: Decodable>(_: T.Type, from req: URLRequest) async throws -> T {
        let data = try await perform(req)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding("\(T.self): \(error)")
        }
    }

    /// NestJS errors: `{"message": "..." | ["..."], "error": "...", "statusCode": n}`.
    static func message(from data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return String(data: data.prefix(200), encoding: .utf8) ?? ""
        }
        if let m = obj["message"] as? String { return m }
        if let m = obj["message"] as? [String] { return m.joined(separator: ", ") }
        return obj["error"] as? String ?? ""
    }
}
