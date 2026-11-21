import SwiftUI
import UIKit

@main
struct MemoriesApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(delegate.app)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Created here (not in the App struct) so background launches for upload events and
    /// BGProcessingTask have the backup engine before any UI exists.
    @MainActor lazy var app = AppModel()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackupScheduler.register { [weak self] in self?.app.backup }
        _ = app
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        nonisolated(unsafe) let handler = completionHandler
        app.backup.uploader.setBackgroundCompletion { handler() }
    }
}
