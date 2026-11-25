import BackgroundTasks
import Foundation

/// BGProcessingTask (long, network, can run overnight on power) and BGAppRefreshTask (short)
/// both run a backup pass, after a quick look for new similar photos (the reminder). Identifiers are listed in Info.plist under
/// BGTaskSchedulerPermittedIdentifiers.
enum BackupScheduler {
    static let processingID = "it.davideghiotto.memories.backup"
    static let refreshID = "it.davideghiotto.memories.backup-refresh"

    /// Call from `didFinishLaunching` (registration must happen before launch completes).
    @MainActor
    static func register(manager: @escaping @MainActor () -> BackupManager?,
                         similar: @escaping @MainActor () -> SimilarCleaner?) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingID, using: .main) { task in
            MainActor.assumeIsolated { run(task, manager(), similar(), budget: 25 * 60) }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshID, using: .main) { task in
            MainActor.assumeIsolated { run(task, manager(), similar(), budget: 20) }
        }
    }

    @MainActor
    private static func run(_ task: BGTask, _ manager: BackupManager?, _ similar: SimilarCleaner?, budget: TimeInterval) {
        schedule()
        let start = Date()
        let work = Task { @MainActor in
            // Rate-limited inside (every few hours, one reminder a day).
            await similar?.backgroundCheck()
            if let manager, manager.isEnabled, !Task.isCancelled {
                await manager.runPass(deadline: start.addingTimeInterval(budget))
            }
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel() }
    }

    static func schedule() {
        let processing = BGProcessingTaskRequest(identifier: processingID)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = false
        processing.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(processing)

        let refresh = BGAppRefreshTaskRequest(identifier: refreshID)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(refresh)
    }
}
