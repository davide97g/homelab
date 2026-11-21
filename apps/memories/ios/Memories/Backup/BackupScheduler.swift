import BackgroundTasks
import Foundation

/// BGProcessingTask (long, network, can run overnight on power) and BGAppRefreshTask (short)
/// both run a backup pass. Identifiers are listed in Info.plist under
/// BGTaskSchedulerPermittedIdentifiers.
enum BackupScheduler {
    static let processingID = "it.davideghiotto.memories.backup"
    static let refreshID = "it.davideghiotto.memories.backup-refresh"

    /// Call from `didFinishLaunching` (registration must happen before launch completes).
    @MainActor
    static func register(manager: @escaping @MainActor () -> BackupManager?) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingID, using: .main) { task in
            MainActor.assumeIsolated { run(task, manager(), budget: 25 * 60) }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshID, using: .main) { task in
            MainActor.assumeIsolated { run(task, manager(), budget: 20) }
        }
    }

    @MainActor
    private static func run(_ task: BGTask, _ manager: BackupManager?, budget: TimeInterval) {
        schedule()
        guard let manager, manager.isEnabled else {
            task.setTaskCompleted(success: true)
            return
        }
        let work = Task { @MainActor in
            await manager.runPass(deadline: Date().addingTimeInterval(budget))
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
