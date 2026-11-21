import SwiftUI

/// "Sign in this TV?" A TV shows a code and a QR; the QR opens this sheet through a
/// `/memories/device?user_code=` universal link, or the code is typed here from Settings.
///
/// Signed in to Memories, this iPhone vouches for itself with its own Immich token: accounts finds
/// the homelab account linked to it and the sheet is one tap, no email code. Only when that is not
/// possible (no Immich session, or the Immich account is not linked yet) does it fall back to the
/// accounts session, signing in by email if needed.
struct DeviceApprovalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var code: String

    /// Approval through the accounts session.
    @State private var request: AccountsClient.DeviceRequest?
    /// Approval through this iPhone's Immich token.
    @State private var appRequest: AccountsClient.AppApproval?
    /// The Immich account is not linked to a homelab account: why, in words.
    @State private var notLinked: String?
    @State private var checking = false
    @State private var busy = false
    @State private var error: String?
    @State private var done: Bool?

    /// This iPhone can vouch with its Immich token.
    private var immichToken: String? {
        guard app.phase == .ready, !app.service.isMock else { return nil }
        return app.api.token
    }

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(colors: [Color(hex: 0xF7B267), Color(hex: 0xF25C78), Color(hex: 0x6C4AB6)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                    .ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 24) {
                        Image(systemName: "tv")
                            .font(.system(size: 54, weight: .light))
                            .foregroundStyle(.white)
                            .padding(.top, 24)
                        content
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Sign In a TV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(done == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
        .task(id: app.accountsEmail) { await check() }
    }

    @ViewBuilder private var content: some View {
        if let done {
            Text(done ? "Done. The TV is signing in." : "Refused. The TV will not sign in.")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
        } else if let appRequest {
            approval(what: appRequest.what, email: appRequest.user.email, userCode: appRequest.userCode)
        } else if let request {
            approval(what: request.what, email: app.accountsEmail ?? "", userCode: request.userCode)
        } else if checking {
            ProgressView().tint(.white).padding(.top, 12)
        } else if app.accountsEmail == nil && (immichToken == nil || notLinked != nil) {
            if let notLinked {
                Text(notLinked)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                Text("Or sign in to your homelab account:")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
            } else {
                Text("Sign in to your homelab account to approve the TV.")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
            }
            EmailCodeForm(submitTitle: "Continue") { email, code in
                try await app.signInToAccounts(email: email, code: code)
            }
        } else {
            Text("Enter the code on the TV.")
                .font(.subheadline)
                .foregroundStyle(.white)
            TextField("ABCD-EFGH", text: $code)
                .font(.title2.monospaced())
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(.horizontal, 16)
                .frame(height: 56)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
                .onSubmit { Task { await check() } }
            if let error { ErrorBanner(text: error) }
            Button { Task { await check() } } label: {
                Group { if busy { ProgressView().tint(.white) } else { Text("Continue") } }
                    .font(.headline).frame(maxWidth: .infinity).frame(height: 30)
            }
            .buttonStyle(.glassProminent)
            .disabled(busy || AccountsClient.normalizeUserCode(code).count < 8)
        }
    }

    @ViewBuilder
    private func approval(what: String, email: String, userCode: String) -> some View {
        VStack(spacing: 6) {
            Text("Sign in \(what)?")
                .font(.title2.weight(.bold))
            Text("As \(email), with code \(Text(Self.pretty(userCode)).monospaced())")
                .font(.subheadline)
                .opacity(0.85)
        }
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
        if let error { ErrorBanner(text: error) }
        Button { decide(true) } label: {
            Group { if busy { ProgressView().tint(.white) } else { Text("Approve") } }
                .font(.headline).frame(maxWidth: .infinity).frame(height: 30)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy)
        Button("Deny", role: .destructive) { decide(false) }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .disabled(busy)
    }

    static func pretty(_ code: String) -> String {
        code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }

    /// Immich token first (one tap), the accounts session otherwise.
    private func check() async {
        guard request == nil, appRequest == nil, done == nil,
              AccountsClient.normalizeUserCode(code).count >= 8 else { return }
        error = nil
        if let token = immichToken, notLinked == nil {
            checking = true
            defer { checking = false }
            do {
                appRequest = try await app.accounts.withApp("check", app: "memories", userCode: code, upstreamToken: token)
                return
            } catch AccountsClient.Failure.notLinked(let why) {
                notLinked = why
            } catch let failure as AccountsClient.Failure where failure.status == 410 || failure.status == 409 || failure.status == 403 {
                error = failure.localizedDescription
                return
            } catch {
                // accounts unreachable or Immich token refused: try the account session below.
            }
        }
        await claimWithSession()
    }

    private func claimWithSession() async {
        guard let session = app.accountsSession else { return }
        busy = true
        defer { busy = false }
        do {
            request = try await app.accounts.claim(userCode: code, session: session)
        } catch let failure as AccountsClient.Failure where failure.status == 401 {
            app.dropAccountsSession()
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
                if let appRequest, let token = immichToken {
                    try await app.accounts.withApp(approve ? "approve" : "deny", app: "memories",
                                                   userCode: appRequest.userCode, upstreamToken: token)
                } else if let request, let session = app.accountsSession {
                    try await app.accounts.decide(userCode: request.userCode, approve: approve, session: session)
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
