import SwiftUI

/// "Sign in this TV?" A TV shows a code and a QR; the QR opens this sheet through a
/// `/memories/device?user_code=` universal link, or the code is typed here from Settings.
/// Needs an accounts session, so someone signed in with a server password signs in by email first.
struct DeviceApprovalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var code: String

    @State private var request: AccountsClient.DeviceRequest?
    @State private var busy = false
    @State private var error: String?
    @State private var done: Bool?

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
        .task(id: app.accountsEmail) { await claimIfReady() }
    }

    @ViewBuilder private var content: some View {
        if let done {
            Text(done ? "Done. The TV is signing in." : "Refused. The TV will not sign in.")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
        } else if app.accountsEmail == nil {
            Text("Sign in to your homelab account to approve the TV.")
                .font(.subheadline)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            EmailCodeForm(submitTitle: "Continue") { email, code in
                try await app.signInToAccounts(email: email, code: code)
            }
        } else if let request {
            VStack(spacing: 6) {
                Text("Sign in \(request.what)?")
                    .font(.title2.weight(.bold))
                Text("As \(app.accountsEmail ?? ""), with code \(Text(Self.pretty(request.userCode)).monospaced())")
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
                .onSubmit { Task { await claimIfReady() } }
            if let error { ErrorBanner(text: error) }
            Button { Task { await claimIfReady() } } label: {
                Group { if busy { ProgressView().tint(.white) } else { Text("Continue") } }
                    .font(.headline).frame(maxWidth: .infinity).frame(height: 30)
            }
            .buttonStyle(.glassProminent)
            .disabled(busy || AccountsClient.normalizeUserCode(code).count < 8)
        }
    }

    static func pretty(_ code: String) -> String {
        code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }

    private func claimIfReady() async {
        guard request == nil, done == nil, let session = app.accountsSession,
              AccountsClient.normalizeUserCode(code).count >= 8 else { return }
        busy = true
        error = nil
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
        guard let request, let session = app.accountsSession else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.accounts.decide(userCode: request.userCode, approve: approve, session: session)
                done = approve
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
