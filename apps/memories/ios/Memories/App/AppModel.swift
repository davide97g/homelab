import Foundation
import Observation
import UIKit

/// App-wide state: session, the active `MediaService`, image pipeline, the Library timeline and
/// backup. Views get it from the environment.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case signedOut, ready }

    private(set) var phase: Phase = .signedOut
    private(set) var service: any MediaService
    private(set) var pipeline: ImagePipeline
    private(set) var library: TimelineStore
    private(set) var user: UserSummary?
    var selectedTab: AppTab
    var showSettings = false
    var toast: String?
    /// Mirrors `ServerEndpoints` for the UI.
    private(set) var usingLAN = false
    /// A TV code to approve: set by a `/memories/device?user_code=` link or Settings.
    var deviceApproval: DeviceApproval?
    /// Signed in to accounts.davideghiotto.it (needed to approve TVs).
    private(set) var accountsEmail: String?

    struct DeviceApproval: Identifiable, Equatable {
        let id = UUID()
        var code: String
    }

    let launch: LaunchOptions
    @ObservationIgnored let endpoints: ServerEndpoints
    @ObservationIgnored let api: APIClient
    @ObservationIgnored let accounts: AccountsClient
    let backup: BackupManager
    let spaceSaver: SpaceSaver

    private enum Keys {
        static let server = "serverURL", publicAPI = "publicAPI", lan = "lanURL", lanAPI = "lanAPI"
        static let token = "accessToken"
        static let accountsSession = "accountsSession", accountsEmail = "accountsEmail"
    }

    var serverURL: String { UserDefaults.standard.string(forKey: Keys.server) ?? "" }
    var lanURL: String { UserDefaults.standard.string(forKey: Keys.lan) ?? "" }

    init(launch: LaunchOptions = .current) {
        self.launch = launch
        let d = UserDefaults.standard
        let endpoints = ServerEndpoints(
            publicAPI: d.string(forKey: Keys.publicAPI).flatMap(URL.init(string:)),
            lanAPI: d.string(forKey: Keys.lanAPI).flatMap(URL.init(string:)))
        self.endpoints = endpoints
        let token = launch.mock ? nil : Keychain.get(Keys.token)
        let api = APIClient(endpoints: endpoints, token: token)
        self.api = api
        accounts = AccountsClient(base: launch.accountsURL ?? AccountsClient.defaultBase)
        accountsEmail = Keychain.get(Keys.accountsSession) == nil ? nil : d.string(forKey: Keys.accountsEmail)
        selectedTab = launch.initialTab
        let backup = BackupManager(api: api, endpoints: endpoints)
        self.backup = backup
        spaceSaver = SpaceSaver(api: api, backup: backup)

        let service: any MediaService = launch.mock
            ? MockMediaService(count: launch.mockCount)
            : RemoteMediaService(api: api)
        self.service = service
        pipeline = ImagePipeline(service: service, device: backup.index)
        library = TimelineStore(query: .library, service: service)
        spaceSaver.service = service
        spaceSaver.pipeline = pipeline

        if launch.mock {
            phase = .ready
            backup.isMock = true
        } else if token != nil, endpoints.activeAPI != nil {
            phase = .ready
        }

        api.setOnUnauthorized { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        endpoints.setOnChange { [weak self] state in
            Task { @MainActor in self?.usingLAN = state.usingLAN }
        }
        backup.onPassFinished = { [weak self] in self?.spaceSaver.maybeAutoClean() }
        endpoints.start()
        pipeline.trimDiskCache()
        if phase == .ready { Task { await refreshUser() } }
        if launch.openSettings { showSettings = true }
        if let code = launch.approveCode { deviceApproval = DeviceApproval(code: code) }
    }

    // MARK: Session

    func refreshUser() async {
        user = try? await service.currentUser()
    }

    /// Discovers the API under `server`, logs in, stores the token in the Keychain.
    func signIn(server: String, email: String, password: String) async throws {
        guard let base = ServerEndpoints.normalize(server) else { throw ServerEndpoints.DiscoveryError.invalidURL }
        let (apiURL, _) = try await ServerEndpoints.discover(base)
        endpoints.update(publicAPI: apiURL, lanAPI: endpoints.current.lanAPI)
        let login = LoginCredentialDto(email: email.trimmingCharacters(in: .whitespaces), password: password)
        api.setToken(nil)
        let res: LoginResponseDto = try await api.send("POST", "auth/login", body: login)
        finishSignIn(base: base, apiURL: apiURL, token: res.accessToken)
        user = UserSummary(id: res.userId, name: res.name, email: res.userEmail)
    }

    /// Step two of the email-code sign-in: accounts gives a session, the broker swaps it for this
    /// iPhone's own Immich token, and from there it is the same as a password sign-in.
    func signInWithAccounts(email: String, code: String) async throws {
        let session = try await accounts.signIn(email: email.trimmingCharacters(in: .whitespaces).lowercased(), code: code)
        do {
            let grant = try await accounts.appToken(
                app: "memories", session: session,
                deviceId: UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString,
                deviceName: UIDevice.current.name, client: "Memories iOS",
                version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
            guard let base = ServerEndpoints.normalize(grant.serverUrl) else { throw ServerEndpoints.DiscoveryError.invalidURL }
            let (apiURL, _) = try await ServerEndpoints.discover(base)
            endpoints.update(publicAPI: apiURL, lanAPI: endpoints.current.lanAPI)
            keepAccountsSession(session, email: email)
            finishSignIn(base: base, apiURL: apiURL, token: grant.accessToken)
            await refreshUser()
        } catch {
            await accounts.signOut(session: session)
            throw error
        }
    }

    /// Signs in to accounts only, to approve a TV, without touching the Immich session.
    func signInToAccounts(email: String, code: String) async throws {
        let session = try await accounts.signIn(email: email.trimmingCharacters(in: .whitespaces).lowercased(), code: code)
        keepAccountsSession(session, email: email)
    }

    var accountsSession: String? { Keychain.get(Keys.accountsSession) }

    /// The stored accounts session stopped working (expired, or revoked by an admin).
    func dropAccountsSession() {
        Keychain.set(nil, for: Keys.accountsSession)
        accountsEmail = nil
    }

    private func keepAccountsSession(_ session: String, email: String) {
        Keychain.set(session, for: Keys.accountsSession)
        UserDefaults.standard.set(email, forKey: Keys.accountsEmail)
        accountsEmail = email
    }

    private func finishSignIn(base: URL, apiURL: URL, token: String) {
        api.setToken(token)
        Keychain.set(token, for: Keys.token)
        let d = UserDefaults.standard
        d.set(base.absoluteString, forKey: Keys.server)
        d.set(apiURL.absoluteString, forKey: Keys.publicAPI)
        resetServices(RemoteMediaService(api: api))
        phase = .ready
    }

    /// `https://accounts.davideghiotto.it/memories/device?user_code=…`, from the TV's QR.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.path.hasSuffix("/device") else { return false }
        let code = parts.queryItems?.first { $0.name == "user_code" }?.value ?? ""
        deviceApproval = DeviceApproval(code: code)
        return true
    }

    func startDemo() {
        resetServices(MockMediaService(count: launch.mockCount))
        backup.isMock = true
        phase = .ready
        Task { await refreshUser() }
    }

    func signOut() {
        if !service.isMock {
            let api = self.api
            Task { try? await api.perform(api.request("POST", "auth/logout")) }
        }
        Keychain.set(nil, for: Keys.token)
        api.setToken(nil)
        if let session = accountsSession {
            let accounts = self.accounts
            Task { await accounts.signOut(session: session) }
        }
        dropAccountsSession()
        pipeline.clearAll()
        ImagePipeline.clearPinned()
        backup.stop()
        backup.isMock = false
        user = nil
        showSettings = false
        phase = .signedOut
        resetServices(RemoteMediaService(api: api))
    }

    private func handleUnauthorized() {
        guard phase == .ready, !service.isMock else { return }
        toast = APIError.unauthorized.errorDescription
        signOut()
    }

    private func resetServices(_ service: any MediaService) {
        self.service = service
        pipeline = ImagePipeline(service: service, device: backup.index)
        library = TimelineStore(query: .library, service: service)
        spaceSaver.service = service
        spaceSaver.pipeline = pipeline
    }

    /// "Save to iPhone" from the viewer or a selection.
    func saveToDevice(_ assets: [Asset]) {
        guard !assets.isEmpty else { return }
        toast = assets.count == 1 ? "Downloading original…" : "Downloading \(assets.count) originals…"
        Task { toast = await spaceSaver.save(assets) }
    }

    /// Optional LAN address (e.g. http://192.168.1.20:2283). Empty clears it.
    func setLANURL(_ input: String) async -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        let d = UserDefaults.standard
        if trimmed.isEmpty {
            d.removeObject(forKey: Keys.lan)
            d.removeObject(forKey: Keys.lanAPI)
            endpoints.update(publicAPI: endpoints.current.publicAPI, lanAPI: nil)
            usingLAN = false
            return nil
        }
        guard var url = ServerEndpoints.normalize(trimmed) else { return "Invalid address." }
        if !trimmed.contains("://") { url = URL(string: "http://" + trimmed) ?? url }
        do {
            let (api, _) = try await ServerEndpoints.discover(url)
            d.set(url.absoluteString, forKey: Keys.lan)
            d.set(api.absoluteString, forKey: Keys.lanAPI)
            endpoints.update(publicAPI: endpoints.current.publicAPI, lanAPI: api)
            await endpoints.probe()
            usingLAN = endpoints.current.usingLAN
            return nil
        } catch {
            return "Not reachable now: \(error.localizedDescription)"
        }
    }

    // MARK: Mutations shared by grid, viewer and selection

    func setFavorite(_ ids: [String], _ value: Bool, in source: any AssetSource) async {
        for id in ids { source.update(id) { $0.isFavorite = value } }
        if source !== library { for id in ids { library.update(id) { $0.isFavorite = value } } }
        do {
            try await service.setFavorite(ids, value)
        } catch {
            for id in ids { source.update(id) { $0.isFavorite = !value } }
            toast = error.localizedDescription
        }
    }

    func trash(_ ids: [String], in source: any AssetSource) async {
        do {
            try await service.trash(ids)
            source.remove(Set(ids))
            if source !== library { library.remove(Set(ids)) }
        } catch {
            toast = error.localizedDescription
        }
    }

    func restore(_ ids: [String], in source: any AssetSource) async {
        do {
            try await service.restore(ids)
            source.remove(Set(ids))
            await library.reload()
        } catch {
            toast = error.localizedDescription
        }
    }
}
