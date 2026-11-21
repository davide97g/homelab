//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The accounts.davideghiotto.it session on this device: kept in the Keychain so the
// same iPhone can approve TVs later, and the TV approval waiting to be shown (from a
// `/cinema/device?user_code=` universal link or Settings).
//

import Foundation
import JellyfinAPI
import KeychainSwift

@MainActor
final class CinemaAccounts: ObservableObject {

    static let shared = CinemaAccounts()

    struct Approval: Identifiable, Equatable {
        let id = UUID()
        var code: String
    }

    /// `-accountsURL http://localhost:3190` points a debug run at a local accounts.
    let client: AccountsClient = {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-accountsURL"), i + 1 < args.count, let url = URL(string: args[i + 1]) {
            return AccountsClient(base: url)
        }
        return AccountsClient(base: AccountsClient.defaultBase)
    }()

    @Published
    private(set) var email: String?
    @Published
    var approval: Approval?

    private let keychain = KeychainSwift()
    private static let sessionKey = "cinema.accountsSession"
    private static let emailKey = "cinema.accountsEmail"

    private init() {
        email = keychain.get(Self.sessionKey) == nil ? nil : UserDefaults.standard.string(forKey: Self.emailKey)
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-approveCode"), i + 1 < args.count {
            approval = Approval(code: args[i + 1])
        }
    }

    var session: String? { keychain.get(Self.sessionKey) }

    func signIn(email: String, code: String) async throws {
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        let session = try await client.signIn(email: address, code: code)
        keychain.set(session, forKey: Self.sessionKey, withAccess: .accessibleAfterFirstUnlockThisDeviceOnly)
        UserDefaults.standard.set(address, forKey: Self.emailKey)
        self.email = address
    }

    /// The stored session stopped working (expired, or revoked by an admin).
    func forget() {
        keychain.delete(Self.sessionKey)
        email = nil
    }

    /// The broker: this device's own Jellyfin token, under the same device identity the app's
    /// Jellyfin client sends, so the server sees one device, not two.
    func jellyfinToken(for configuration: JellyfinClient.Configuration) async throws -> String {
        guard let session else { throw AccountsClient.Failure.noSession }
        do {
            return try await client.appToken(
                app: "cinema",
                session: session,
                deviceId: configuration.deviceID,
                deviceName: configuration.deviceName,
                client: configuration.client,
                version: configuration.version
            ).accessToken
        } catch let failure as AccountsClient.Failure where failure.status == 401 {
            forget()
            throw failure
        }
    }

    /// `https://accounts.davideghiotto.it/cinema/device?user_code=…`, from the TV's QR.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.path.hasSuffix("/device") else { return false }
        let code = parts.queryItems?.first { $0.name == "user_code" }?.value ?? ""
        // The same link can arrive twice (activity + URL): one sheet is enough.
        if approval?.code == code { return true }
        approval = Approval(code: code)
        return true
    }
}
