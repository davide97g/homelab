import Foundation
import Testing
@testable import Memories

/// Unit part always runs. The live part runs against a local accounts with `DEV_OTP` set
/// (apps/accounts README, "Develop"):
///
///     TEST_RUNNER_ACCOUNTS_TEST_URL=http://localhost:3190 xcodebuild test …
struct AccountsClientTests {
    @Test func userCodeIsNormalized() {
        #expect(AccountsClient.normalizeUserCode("abcd-efgh") == "ABCDEFGH")
        #expect(AccountsClient.normalizeUserCode(" J6KG USFQ ") == "J6KGUSFQ")
    }

    @MainActor @Test func deviceLinkOpensTheApprovalSheet() {
        let app = AppModel(launch: LaunchOptions(arguments: ["-mock"]))
        #expect(app.handle(url: URL(string: "https://accounts.davideghiotto.it/memories/device?user_code=ABCDEFGH")!))
        #expect(app.deviceApproval?.code == "ABCDEFGH")
        #expect(!app.handle(url: URL(string: "https://accounts.davideghiotto.it/admin")!))
    }

    static let live = ProcessInfo.processInfo.environment["ACCOUNTS_TEST_URL"].flatMap(URL.init(string:))

    /// The phone's whole job, against the real server: email code, claim a TV code, approve it,
    /// and the TV's poll turns into a session. The broker answers 403 (no Immich access granted).
    @Test(.enabled(if: live != nil)) func approvesATV() async throws {
        let base = try #require(Self.live)
        let client = AccountsClient(base: base)
        let otp = ProcessInfo.processInfo.environment["ACCOUNTS_TEST_OTP"] ?? "123456"
        let email = ProcessInfo.processInfo.environment["ACCOUNTS_TEST_EMAIL"] ?? "admin@test.local"

        try await client.sendCode(email: email)
        let session = try await client.signIn(email: email, code: otp)
        #expect(try await client.me(session: session).user.email == email)

        let tv = try await post(base, "auth/device/code", ["client_id": "memories-tv"])
        let userCode = try #require(tv["user_code"] as? String)
        let deviceCode = try #require(tv["device_code"] as? String)

        let request = try await client.claim(userCode: "\(userCode.prefix(4))-\(userCode.suffix(4))", session: session)
        #expect(request.clientId == "memories-tv")
        #expect(request.what == "Memories on a TV")
        try await client.decide(userCode: userCode, approve: true, session: session)

        try await Task.sleep(for: .seconds(5.5))
        let poll = try await post(base, "auth/device/token", [
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": deviceCode, "client_id": "memories-tv",
        ])
        #expect(poll["access_token"] is String)

        await #expect(throws: AccountsClient.Failure.self) {
            _ = try await client.appToken(app: "memories", session: session, deviceId: "test-iphone-0001",
                                          deviceName: "Test", client: "Memories iOS", version: "1")
        }
        await client.signOut(session: session)
        await #expect(throws: AccountsClient.Failure.self) { _ = try await client.me(session: session) }
    }

    private func post(_ base: URL, _ path: String, _ body: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: base.appending(path: "api").appending(path: path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await AccountsClient.cookieless.data(for: req)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }
}
