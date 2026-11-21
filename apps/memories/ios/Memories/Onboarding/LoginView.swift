import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var server = "https://memories.davideghiotto.it/immich"
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var withPassword = false
    @FocusState private var focus: Field?

    private enum Field { case server, email, password }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0xF7B267), Color(hex: 0xF25C78), Color(hex: 0x6C4AB6)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 10) {
                        AppGlyph()
                            .frame(width: 92, height: 92)
                        Text("Memories")
                            .font(.system(size: 34, weight: .bold))
                            .tracking(0.37)
                        Text("Your photo library, on your own server.")
                            .font(.subheadline)
                            .opacity(0.85)
                    }
                    .foregroundStyle(.white)
                    .padding(.top, 60)

                    if withPassword {
                        passwordForm
                    } else {
                        EmailCodeForm(submitTitle: "Sign In") { email, code in
                            try await app.signInWithAccounts(email: email, code: code)
                        }
                    }

                    VStack(spacing: 12) {
                        Button(withPassword ? "Sign in with an email code" : "Sign in with a server password") {
                            withAnimation(.snappy) { withPassword.toggle(); error = nil }
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)

                        Button("Explore with Sample Library") { app.startDemo() }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .buttonStyle(.glass)
                    }

                    Text(withPassword
                         ? "Memories finds the API through \(Text("/.well-known/immich").monospaced()) and keeps your session token in the Keychain."
                         : "One account for the whole homelab: a code by email, no password. Ask for an invite if you have none.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    @ViewBuilder private var passwordForm: some View {
        VStack(spacing: 12) {
            field("Server URL", text: $server, icon: "server.rack", field: .server)
                .keyboardType(.URL)
                .textContentType(.URL)
            field("Email", text: $email, icon: "envelope", field: .email)
                .keyboardType(.emailAddress)
                .textContentType(.username)
            HStack(spacing: 10) {
                Image(systemName: "lock").frame(width: 22).foregroundStyle(.secondary)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(signIn)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .glassEffect(.regular, in: .rect(cornerRadius: 16))
        }

        if let error { ErrorBanner(text: error) }

        Button(action: signIn) {
            Group {
                if busy { ProgressView().tint(.white) } else { Text("Sign In") }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 30)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy || email.isEmpty || password.isEmpty || server.isEmpty)
    }

    private func field(_ title: String, text: Binding<String>, icon: String, field: Field) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).frame(width: 22).foregroundStyle(.secondary)
            TextField(title, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: field)
                .submitLabel(.next)
                .onSubmit { focus = field == .server ? .email : .password }
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }

    private func signIn() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.signIn(server: server, email: email, password: password)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

struct ErrorBanner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(12)
            .frame(maxWidth: .infinity)
            .glassEffect(.regular.tint(.red.opacity(0.4)), in: .rect(cornerRadius: 14))
    }
}

/// The in-app version of the app icon (drawn, not an asset): stacked frames over a warm gradient.
struct AppGlyph: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0xFFC56E), Color(hex: 0xF0507A), Color(hex: 0x7A4BD0)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.white.opacity(0.45))
                .frame(width: 46, height: 46)
                .rotationEffect(.degrees(-12))
                .offset(x: -6, y: -4)
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.white)
                .frame(width: 46, height: 46)
                .overlay {
                    ZStack(alignment: .bottom) {
                        Circle().fill(Color(hex: 0xF7A84A)).frame(width: 13).offset(x: 8, y: -22)
                        Path { p in
                            p.move(to: CGPoint(x: 0, y: 38)); p.addLine(to: CGPoint(x: 14, y: 20))
                            p.addLine(to: CGPoint(x: 24, y: 30)); p.addLine(to: CGPoint(x: 32, y: 22))
                            p.addLine(to: CGPoint(x: 38, y: 38)); p.closeSubpath()
                        }
                        .fill(Color(hex: 0x6C4AB6))
                        .frame(width: 38, height: 38)
                    }
                    .frame(width: 38, height: 38)
                    .clipShape(.rect(cornerRadius: 6))
                }
                .rotationEffect(.degrees(6))
                .offset(x: 6, y: 4)
                .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
        }
        .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
    }
}
