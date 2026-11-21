import SwiftUI

/// Previews run on the mock library (no server).
@MainActor
private func previewApp(_ args: [String] = []) -> AppModel {
    AppModel(launch: LaunchOptions(arguments: ["preview", "-mock"] + args))
}

#Preview("Library") {
    MainTabView().environment(previewApp())
}

#Preview("Months") {
    MainTabView().environment(previewApp(["-libraryMode", "months"]))
}

#Preview("Collections") {
    MainTabView().environment(previewApp(["-initialTab", "collections"]))
}

#Preview("Search") {
    MainTabView().environment(previewApp(["-initialTab", "search"]))
}

#Preview("Settings") {
    SettingsView().environment(previewApp())
}

#Preview("Login") {
    LoginView().environment(previewApp())
}
