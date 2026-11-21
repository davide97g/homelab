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
        /// The app's Immich account is not linked to a homelab account (an admin links it).
        case notLinked(String)

        var errorDescription: String? {
            switch self {
            case .http(let code, let message): message.isEmpty ? "Sign-in service error \(code)." : message
            case .noSession: "The sign-in service sent no session."
            case .notLinked(let message): message
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

    /// A TV's code, as accounts sees it when the phone app vouches for it with its own token.
    struct AppApproval: Decodable, Sendable {
        let userCode: String
        let clientId: String
        let user: Me.User

        var what: String { DeviceRequest(userCode: userCode, status: "pending", clientId: clientId).what }
    }

    /// Approve a TV with this iPhone's own Immich token instead of an accounts session: no email
    /// code. accounts asks Immich whose token it is and finds the homelab account linked to it;
    /// it only approves TVs of the same app. `check` returns who would approve, without changing anything.
    @discardableResult
    func withApp(_ action: String, app: String, userCode: String, upstreamToken: String) async throws -> AppApproval? {
        let (data, _) = try await call("POST", "device/with-app", body: [
            "app": app, "userCode": Self.normalizeUserCode(userCode), "action": action,
        ], bearer: upstreamToken)
        return action == "check" ? try JSONDecoder().decode(AppApproval.self, from: data) : nil
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
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 409, (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String == "not_linked" {
                throw Failure.notLinked(Self.message(data))
            }
            throw Failure.http(http.statusCode, Self.message(data))
        }
        return (data, http)
    }

    private static func message(_ data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        if let m = obj["message"] as? String { return m }
        if let m = obj["error_description"] as? String { return m }
        return obj["error"] as? String ?? ""
    }
}
