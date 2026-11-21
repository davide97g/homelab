import Foundation

/// accounts.davideghiotto.it, the homelab's sign-in (apps/accounts in the monorepo).
///
/// One account per person, a 6-digit code by email, no passwords. After signing in, the broker
/// hands back this device's own Immich token, so Memories talks to Immich exactly as before and
/// keeps working when accounts is down. The same session approves TVs (`/memories/device` links).
struct AccountsClient: Sendable {
    static let defaultBase = URL(string: "https://accounts.davideghiotto.it")!

    let base: URL
    var session: URLSession = Self.cookieless

    /// Bearer only. A stored Better Auth cookie would ride along on later calls without an
    /// `Origin`, and Better Auth refuses those (CSRF check): cookies are for browsers.
    static let cookieless: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        return URLSession(configuration: config)
    }()

    enum Failure: LocalizedError {
        case http(Int, String)
        case noSession

        var errorDescription: String? {
            switch self {
            case .http(let code, let message): message.isEmpty ? "Sign-in service error \(code)." : message
            case .noSession: "The sign-in service sent no session."
            }
        }

        var status: Int? { if case .http(let code, _) = self { code } else { nil } }
    }

    /// The broker's answer: the app's own token and where its server lives.
    struct AppGrant: Decodable, Sendable {
        let accessToken: String
        let userId: String
        let serverUrl: String
    }

    /// A TV's pending sign-in, after this account claimed it.
    struct DeviceRequest: Decodable, Sendable {
        let userCode: String
        let status: String
        let clientId: String

        enum CodingKeys: String, CodingKey {
            case userCode = "user_code", status, clientId = "client_id"
        }

        /// What the person is approving, in words.
        var what: String {
            switch clientId {
            case "cinema-tv": "Cinema on a TV"
            case "memories-tv": "Memories on a TV"
            default: clientId
            }
        }
    }

    struct Me: Decodable, Sendable {
        struct User: Decodable, Sendable { let email: String; let name: String }
        let user: User
    }

    /// TV codes are shown as `ABCD-EFGH`; the server wants `ABCDEFGH`.
    static func normalizeUserCode(_ raw: String) -> String {
        raw.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    // MARK: Email code

    func sendCode(email: String) async throws {
        _ = try await call("POST", "auth/email-otp/send-verification-otp", body: ["email": email, "type": "sign-in"])
    }

    /// Returns the session token native clients send as `Authorization: Bearer`.
    func signIn(email: String, code: String) async throws -> String {
        let (_, resp) = try await call("POST", "auth/sign-in/email-otp", body: ["email": email, "otp": code])
        guard let token = resp.value(forHTTPHeaderField: "set-auth-token"), !token.isEmpty else { throw Failure.noSession }
        return token
    }

    func me(session: String) async throws -> Me {
        let (data, _) = try await call("GET", "me", bearer: session)
        return try JSONDecoder().decode(Me.self, from: data)
    }

    func signOut(session: String) async {
        _ = try? await call("POST", "auth/sign-out", body: [String: String](), bearer: session)
    }

    // MARK: Broker

    func appToken(app: String, session: String, deviceId: String, deviceName: String, client: String, version: String) async throws -> AppGrant {
        let (data, _) = try await call("POST", "apps/\(app)/token", body: [
            "deviceId": deviceId, "deviceName": deviceName, "client": client, "version": version,
        ], bearer: session)
        return try JSONDecoder().decode(AppGrant.self, from: data)
    }

    // MARK: Approving a TV

    /// Binds the code to this account. Required before approve or deny.
    func claim(userCode: String, session: String) async throws -> DeviceRequest {
        let code = Self.normalizeUserCode(userCode)
        let (data, _) = try await call("GET", "auth/device", query: [URLQueryItem(name: "user_code", value: code)], bearer: session)
        return try JSONDecoder().decode(DeviceRequest.self, from: data)
    }

    func decide(userCode: String, approve: Bool, session: String) async throws {
        _ = try await call("POST", approve ? "auth/device/approve" : "auth/device/deny",
                           body: ["userCode": Self.normalizeUserCode(userCode)], bearer: session)
    }

    // MARK: Plumbing

    private func call(_ method: String, _ path: String, query: [URLQueryItem] = [], body: [String: String]? = nil,
                      bearer: String? = nil) async throws -> (Data, HTTPURLResponse) {
        var url = base.appending(path: "api").appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = try JSONEncoder().encode(body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Failure.http(0, "") }
        guard (200..<300).contains(http.statusCode) else { throw Failure.http(http.statusCode, Self.message(data)) }
        return (data, http)
    }

    private static func message(_ data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        if let m = obj["message"] as? String { return m }
        if let m = obj["error_description"] as? String { return m }
        return obj["error"] as? String ?? ""
    }
}
