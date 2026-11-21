//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// Signing in with the homelab account (a code by email, no password) and approving
// a TV. iOS only: the TV signs in the other way round, by showing a code.
//

#if os(iOS)
import FactoryKit
import SwiftUI

/// Email, then the 6-digit code. Rows for an upstream `List`/`Form` section.
struct AccountsEmailCodeRows: View {

    var submitTitle: String
    var onSubmit: (_ email: String, _ code: String) async throws -> Void

    @State
    private var email = ""
    @State
    private var code = ""
    @State
    private var sentTo: String?
    @State
    private var busy = false
    @State
    private var error: String?
    @FocusState
    private var codeFocused: Bool

    var body: some View {
        if let sentTo {
            Text("We sent a code to \(Text(sentTo).bold()).")
                .font(.callout)
            TextField("6-digit code", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.title3.monospacedDigit())
                .focused($codeFocused)
                .onChange(of: code) { _, new in onCodeChange(new) }
        } else {
            TextField("Email", text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .onSubmit(sendCode)
        }

        if let error {
            Text(error)
                .font(.callout)
                .foregroundStyle(.red)
        }

        primaryButton

        if sentTo != nil {
            Button("Use a different email") {
                sentTo = nil
                code = ""
                error = nil
            }
            .font(.callout)
        }
    }

    private var primaryButton: some View {
        let waitingForEmail = sentTo == nil
        let title = waitingForEmail ? "Email Me a Code" : submitTitle
        let ready = waitingForEmail ? email.contains("@") : code.count == 6
        return Button {
            if waitingForEmail { sendCode() } else { submit() }
        } label: {
            Group {
                if busy { ProgressView() } else { Text(title) }
            }
            .frame(maxWidth: .infinity)
        }
        .fontWeight(.semibold)
        .buttonStyle(.borderedProminent)
        .tint(.cinemaPrimary)
        .controlSize(.large)
        .disabled(busy || !ready)
    }

    private func onCodeChange(_ new: String) {
        let digits = String(new.filter(\.isNumber).prefix(6))
        if digits != code { code = digits }
        if digits.count == 6 { submit() }
    }

    private func sendCode() {
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard !busy, address.contains("@") else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await CinemaAccounts.shared.client.sendCode(email: address)
                sentTo = address
                codeFocused = true
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func submit() {
        guard !busy, let sentTo, code.count == 6 else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await onSubmit(sentTo, code)
            } catch let failure as AccountsClient.Failure where failure.status == 401 || failure.status == 400 {
                self.error = "That code is wrong or has expired."
                code = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// "Sign in this TV?" Opened by the TV's QR (a `/cinema/device` universal link) or from Settings.
struct AccountsDeviceApprovalView: View {

    @ObservedObject
    private var accounts = CinemaAccounts.shared
    @Environment(\.dismiss)
    private var dismiss

    @State
    var code: String
    @State
    private var request: AccountsClient.DeviceRequest?
    /// Approval through this iPhone's own Jellyfin token: one tap, no email code.
    @State
    private var appRequest: AccountsClient.AppApproval?
    /// The Jellyfin account is not linked to a homelab account: why, in words.
    @State
    private var notLinked: String?
    @State
    private var checking = false
    @State
    private var busy = false
    @State
    private var error: String?
    @State
    private var done: Bool?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Image(systemName: "tv")
                        .font(.system(size: 54, weight: .light))
                        .foregroundStyle(Color.cinemaPrimary)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                content
            }
            .navigationTitle("Sign In a TV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(done == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
        .task(id: accounts.email) { await check() }
    }

    @ViewBuilder
    private var content: some View {
        if let done {
            Section {
                Text(done ? "Done. The TV is signing in." : "Refused. The TV will not sign in.")
                    .font(.headline)
            }
        } else if let appRequest {
            approval(what: appRequest.what, email: appRequest.user.email, userCode: appRequest.userCode)
        } else if let request {
            approval(what: request.what, email: accounts.email ?? "", userCode: request.userCode)
        } else if checking {
            Section {
                ProgressView().frame(maxWidth: .infinity)
            }
        } else if accounts.email == nil && (jellyfinToken == nil || notLinked != nil) {
            if let notLinked {
                Section {
                    Text(notLinked)
                }
            }
            Section {
                AccountsEmailCodeRows(submitTitle: "Continue") { email, code in
                    try await accounts.signIn(email: email, code: code)
                }
            } footer: {
                Text(notLinked == nil ? "Sign in to your homelab account to approve the TV." : "Or sign in to your homelab account by email.")
            }
        } else {
            codeEntry
        }
    }

    /// This iPhone's own Jellyfin token, when signed in to Cinema.
    private var jellyfinToken: String? {
        guard let token = Container.shared.currentUserSession()?.user.accessToken, !token.isEmpty else { return nil }
        return token
    }

    @ViewBuilder
    private func approval(what: String, email: String, userCode: String) -> some View {
            Section {
                Text("Sign in \(what)?")
                    .font(.title3.weight(.bold))
                Text("As \(email), code \(Text(Self.pretty(userCode)).monospaced())")
                    .foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red) }
                Button { decide(true) } label: {
                    Group { if busy { ProgressView() } else { Text("Approve") } }
                        .frame(maxWidth: .infinity)
                }
                .fontWeight(.semibold)
                .buttonStyle(.borderedProminent)
                .tint(.cinemaPrimary)
                .controlSize(.large)
                .disabled(busy)
                Button("Deny", role: .destructive) { decide(false) }
                    .disabled(busy)
            }
    }

    @ViewBuilder
    private var codeEntry: some View {
            Section {
                TextField("ABCD-EFGH", text: $code)
                    .font(.title2.monospaced())
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await check() } }
                if let error { Text(error).foregroundStyle(.red) }
                Button { Task { await check() } } label: {
                    Group { if busy { ProgressView() } else { Text("Continue") } }
                        .frame(maxWidth: .infinity)
                }
                .fontWeight(.semibold)
                .buttonStyle(.borderedProminent)
                .tint(.cinemaPrimary)
                .controlSize(.large)
                .disabled(busy || AccountsClient.normalizeUserCode(code).count < 8)
            } footer: {
                Text("Enter the code shown on the TV.")
            }
    }

    static func pretty(_ code: String) -> String {
        code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }

    /// Jellyfin token first (one tap), the accounts session otherwise.
    private func check() async {
        guard request == nil, appRequest == nil, done == nil,
              AccountsClient.normalizeUserCode(code).count >= 8 else { return }
        error = nil
        if let token = jellyfinToken, notLinked == nil {
            checking = true
            defer { checking = false }
            do {
                appRequest = try await accounts.client.withApp("check", app: "cinema", userCode: code, upstreamToken: token)
                return
            } catch AccountsClient.Failure.notLinked(let why) {
                notLinked = why
            } catch let failure as AccountsClient.Failure where failure.status == 410 || failure.status == 409 || failure.status == 403 {
                error = failure.localizedDescription
                return
            } catch {
                // accounts unreachable or the token refused: the accounts session below.
            }
        }
        await claimIfReady()
    }

    private func claimIfReady() async {
        guard request == nil, done == nil, let session = accounts.session,
              AccountsClient.normalizeUserCode(code).count >= 8 else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            request = try await accounts.client.claim(userCode: code, session: session)
        } catch let failure as AccountsClient.Failure where failure.status == 401 {
            accounts.forget()
        } catch {
            self.error = "That code is wrong or has expired. Check the TV."
        }
    }

    private func decide(_ approve: Bool) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                if let appRequest, let token = jellyfinToken {
                    try await accounts.client.withApp(approve ? "approve" : "deny", app: "cinema",
                                                      userCode: appRequest.userCode, upstreamToken: token)
                } else if let request, let session = accounts.session {
                    try await accounts.client.decide(userCode: request.userCode, approve: approve, session: session)
                } else {
                    return
                }
                done = approve
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
#endif
