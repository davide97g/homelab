import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var app = app
        Group {
            switch app.phase {
            case .signedOut:
                LoginView()
                    .transition(.opacity)
            case .ready:
                MainTabView()
                    .id(ObjectIdentifier(app.library))
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: app.phase)
        .sheet(isPresented: $app.showSettings) {
            SettingsView()
                .environment(app)
        }
        .fullScreenCover(isPresented: $app.showSimilar) {
            SimilarGameView()
                .environment(app)
        }
        .sheet(item: $app.deviceApproval) { approval in
            DeviceApprovalView(code: approval.code)
                .environment(app)
        }
        // The TV's QR: https://accounts.davideghiotto.it/memories/device?user_code=…
        .onOpenURL { url in app.handle(url: url) }
        // A universal link (the TV's QR scanned with the Camera) arrives as a browsing-web
        // activity; onOpenURL alone missed it on iOS 27.
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { app.handle(url: url) }
        }
        // Automatic "free up space" asks only in the foreground (iOS shows its own prompt).
        .onChange(of: scenePhase, initial: true) { _, phase in
            guard phase == .active, app.phase == .ready else { return }
            // Every time the app comes forward, so backup never waits for a library change.
            app.backup.appBecameActive()
            Task {
                try? await Task.sleep(for: .seconds(4))
                app.spaceSaver.maybeAutoClean()
            }
        }
        .overlay(alignment: .top) {
            if let toast = app.toast {
                Text(toast)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation { app.toast = nil }
                    }
            }
        }
        .animation(.snappy, value: app.toast)
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @State private var searchText = ""

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Library", systemImage: "photo.on.rectangle.angled", value: AppTab.library) {
                LibraryScreen()
            }
            Tab("Collections", systemImage: "square.stack.fill", value: AppTab.collections) {
                CollectionsScreen()
            }
            Tab(value: AppTab.search, role: .search) {
                SearchScreen()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}
