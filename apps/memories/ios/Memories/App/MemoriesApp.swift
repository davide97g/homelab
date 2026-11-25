import SwiftUI
import UIKit
import UserNotifications

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

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Created here (not in the App struct) so background launches for upload events and
    /// BGProcessingTask have the backup engine before any UI exists.
    @MainActor lazy var app = AppModel()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackupScheduler.register(manager: { [weak self] in self?.app.backup },
                                 similar: { [weak self] in self?.app.similar })
        UNUserNotificationCenter.current().delegate = self
        _ = app
        return true
    }

    // MARK: Notifications (the Similar Photos reminder)

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.identifier
        nonisolated(unsafe) let done = completionHandler
        Task { @MainActor in
            if id == SimilarCleaner.notificationID, app.phase == .ready {
                app.showSettings = false
                app.showSimilar = true
            }
            done()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        nonisolated(unsafe) let handler = completionHandler
        app.backup.uploader.setBackgroundCompletion { handler() }
    }
}
