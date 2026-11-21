import Photos
import SwiftUI

/// Account, network and backup, opened from the avatar / "…" menu.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var lanInput = ""
    @State private var lanMessage: String?
    @State private var lanBusy = false

    var body: some View {
        @Bindable var backup = app.backup
        @Bindable var space = app.spaceSaver
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(name: app.user?.name)
                            .scaleEffect(1.5)
                            .frame(width: 52, height: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(app.user?.name ?? "Not signed in").font(.headline)
                            Text(app.user?.email ?? "").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    LabeledContent("Server", value: app.service.isMock ? "Sample library (mock)" : app.serverURL)
                    LabeledContent("Connection", value: app.usingLAN ? "Home network (LAN)" : "Internet")
                }

                Section {
                    backupHeader(backup)
                    Toggle("Back Up This iPhone", isOn: $backup.isEnabled)
                    Toggle("Wi-Fi Only", isOn: $backup.wifiOnly)
                    Toggle("Include Videos", isOn: $backup.includeVideos)
                    if backup.authorization == .denied || backup.authorization == .restricted {
                        Label("Memories can't see your photos. Allow access in Settings > Privacy > Photos.", systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    } else if backup.authorization == .limited {
                        Label("Limited access: only the photos you picked are backed up.", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button("Back Up Now") {
                        Task {
                            if backup.authorization == .notDetermined { await backup.requestAuthorization() }
                            backup.runNow()
                        }
                    }
                    .disabled(!(backup.isEnabled || backup.isMock))
                } header: {
                    Text("Backup")
                } footer: {
                    Text("Originals and live photos go to your server in the background. Files over 100 MB are skipped on the public URL (Cloudflare's limit) and sent when the home network URL is reachable.")
                }

                if !backup.skipped.isEmpty {
                    Section("Not Backed Up (\(backup.skipped.count))") {
                        ForEach(backup.skipped.prefix(50)) { item in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(item.filename).font(.subheadline.weight(.medium)).lineLimit(1)
                                    Spacer()
                                    if let size = item.size {
                                        Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Text(item.detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                storageSection(space)

                Section {
                    TextField("http://192.168.1.20:2283", text: $lanInput)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(saveLAN)
                    Button(lanBusy ? "Checking…" : "Save Home Network URL", action: saveLAN)
                        .disabled(lanBusy || app.service.isMock)
                    if let lanMessage {
                        Text(lanMessage).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Home Network")
                } footer: {
                    Text("When this address answers, Memories uses it instead of the public URL: faster, and no 100 MB limit. Checked every time the network changes, no Wi-Fi name needed.")
                }

                if !app.service.isMock {
                    Section {
                        Button("Sign In a TV", systemImage: "tv") {
                            app.showSettings = false
                            Task {
                                try? await Task.sleep(for: .milliseconds(450)) // one sheet at a time
                                app.deviceApproval = .init(code: "")
                            }
                        }
                    } header: {
                        Text("Homelab Account")
                    } footer: {
                        Text("\(app.accountsEmail.map { "Signed in as \($0). " } ?? "")A TV shows a code and a QR: scanning the QR opens Memories, or type the code here.")
                    }
                }

                Section {
                    Button("Clear Image Cache") { app.pipeline.clearAll() }
                    Button(app.service.isMock ? "Leave Sample Library" : "Sign Out", role: .destructive) { app.signOut() }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            .onAppear { lanInput = app.lanURL }
            .task { await app.spaceSaver.refreshEstimate() }
        }
    }

    // MARK: iPhone storage

    @ViewBuilder
    private func storageSection(_ space: SpaceSaver) -> some View {
        @Bindable var space = space
        Section {
            VStack(alignment: .leading, spacing: 3) {
                Text(storageTitle(space)).font(.headline)
                Text(storageDetail(space)).font(.subheadline).foregroundStyle(.secondary)
                if case .verifying(let n, let total) = space.phase, total > 0 {
                    ProgressView(value: Double(n), total: Double(total)).progressViewStyle(.linear)
                }
            }
            .padding(.vertical, 4)
            Button {
                Task { await space.freeUpSpace() }
            } label: {
                HStack {
                    Text("Free Up Space Now")
                    Spacer()
                    if space.isBusy { ProgressView() }
                }
            }
            .disabled(space.isBusy || app.service.isMock)
            Toggle("Free Up Space Automatically", isOn: $space.isAutomatic)
                .disabled(app.service.isMock)
            Picker("Keep on iPhone", selection: $space.keepDays) {
                ForEach(SpaceSaver.keepChoices, id: \.self) { days in
                    Text(keepLabel(days)).tag(days)
                }
            }
            Toggle("Keep Favorites on iPhone", isOn: $space.keepFavorites)
        } header: {
            Text("iPhone Storage")
        } footer: {
            Text("Removes originals from Photos once the server has them. Each one is checked on the server first, and its thumbnail stays in Memories so the library browses offline; opening it downloads the photo again. Edited photos, shared-album and hidden items always stay. iOS asks before deleting, and removed items wait 30 days in Recently Deleted before the space is free. With iCloud Photos on, deleting also removes them from iCloud.\n\nAutomatically: at most once a day, while Memories is open and backup is on.")
        }
    }

    private func keepLabel(_ days: Int) -> String {
        switch days {
        case 0: "Nothing"
        case 7: "Last Week"
        case 30: "Last 30 Days"
        case 90: "Last 3 Months"
        case 365: "Last Year"
        default: "Last \(days) Days"
        }
    }

    private func storageTitle(_ s: SpaceSaver) -> String {
        switch s.phase {
        case .scanning: "Looking for Backed-Up Items…"
        case .verifying: "Checking the Server…"
        case .pinning: "Saving Thumbnails…"
        case .waitingForConfirmation: "Waiting for Confirmation…"
        case .done(let msg): msg
        case .failed(let msg): msg
        case .idle:
            s.candidateCount == 0 ? "Nothing to Free Up"
                : "\(ByteCountFormatter.string(fromByteCount: s.candidateBytes, countStyle: .file)) Can Be Freed"
        }
    }

    private func storageDetail(_ s: SpaceSaver) -> String {
        var parts: [String] = []
        if s.candidateCount > 0 { parts.append("\(s.candidateCount.formatted()) backed-up items on this iPhone") }
        if s.freedCount > 0 {
            parts.append("\(s.freedCount.formatted()) removed so far (\(ByteCountFormatter.string(fromByteCount: s.freedBytes, countStyle: .file)))")
        }
        return parts.isEmpty ? "Only items already on the server are removed." : parts.joined(separator: " · ")
    }

    private func backupHeader(_ backup: BackupManager) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(.quaternary, lineWidth: 6)
                Circle()
                    .trim(from: 0, to: backup.totalCount == 0 ? 0 : backup.progress)
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.snappy, value: backup.progress)
                Image(systemName: statusSymbol(backup))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(statusTitle(backup)).font(.headline)
                Text(statusDetail(backup)).font(.subheadline).foregroundStyle(.secondary)
                if backup.bytesExpected > 0, backup.phase == .uploading {
                    ProgressView(value: Double(backup.bytesSent), total: Double(max(1, backup.bytesExpected)))
                        .progressViewStyle(.linear)
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func statusSymbol(_ b: BackupManager) -> String {
        switch b.phase {
        case .uploading: "arrow.up"
        case .scanning, .preparing: "magnifyingglass"
        case .waitingForWiFi: "wifi.exclamationmark"
        case .failed: "exclamationmark"
        case .done: "checkmark"
        case .idle: b.isEnabled ? "checkmark" : "pause.fill"
        }
    }

    private func statusTitle(_ b: BackupManager) -> String {
        switch b.phase {
        case .idle: b.isEnabled ? "Backup On" : "Backup Off"
        case .scanning: "Looking for New Items…"
        case .preparing(let what): "Preparing \(what)…"
        case .uploading: "Uploading \(b.pendingCount.formatted()) Items"
        case .waitingForWiFi: "Waiting for Wi-Fi"
        case .done: b.pendingCount == 0 ? "Up to Date" : "\(b.pendingCount.formatted()) Items Left"
        case .failed(let msg): msg
        }
    }

    private func statusDetail(_ b: BackupManager) -> String {
        if let e = b.lastError { return e }
        if b.totalCount == 0 { return b.lastRun == nil ? "Not run yet" : "No items found" }
        var s = "\(b.backedUpCount.formatted()) of \(b.totalCount.formatted()) backed up"
        if let last = b.lastRun { s += " · \(last.formatted(.relative(presentation: .named)))" }
        return s
    }

    private func saveLAN() {
        lanBusy = true
        Task {
            let error = await app.setLANURL(lanInput)
            lanBusy = false
            lanMessage = error ?? (lanInput.isEmpty ? "Cleared." : (app.usingLAN ? "Reachable: using it now." : "Saved. Used whenever it's reachable."))
        }
    }
}
