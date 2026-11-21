import SwiftUI

/// Email, then the 6-digit code accounts.davideghiotto.it mails. `onSubmit` gets both and does the
/// rest (sign in to Memories, or only to accounts to approve a TV).
struct EmailCodeForm: View {
    @Environment(AppModel.self) private var app
    var submitTitle: String
    var onSubmit: (_ email: String, _ code: String) async throws -> Void

    @State private var email = ""
    @State private var code = ""
    @State private var sentTo: String?
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case email, code }

    var body: some View {
        VStack(spacing: 12) {
            if let sentTo {
                Text("We sent a code to \(Text(sentTo).bold()).")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                HStack(spacing: 10) {
                    Image(systemName: "number").frame(width: 22).foregroundStyle(.secondary)
                    TextField("6-digit code", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.title3.monospacedDigit())
                        .focused($focus, equals: .code)
                        .onChange(of: code) { _, new in onCodeChange(new) }
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "envelope").frame(width: 22).foregroundStyle(.secondary)
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.send)
                        .onSubmit(sendCode)
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
            }

            if let error { ErrorBanner(text: error) }

            primaryButton

            if sentTo != nil {
                Button("Use a different email") {
                    sentTo = nil
                    code = ""
                    error = nil
                    focus = .email
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            }
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
                if busy { ProgressView().tint(.white) } else { Text(title) }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 30)
        }
        .buttonStyle(.glassProminent)
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
                try await app.accounts.sendCode(email: address)
                sentTo = address
                focus = .code
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
