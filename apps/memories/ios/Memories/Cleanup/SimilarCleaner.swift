import Foundation
import Observation
import UserNotifications

/// Similar Photos: the sets Immich's duplicate detection finds, the daily ring, the streak, the
/// reminder, and the iPhone copies still to remove.
///
/// Deleting is deliberate and final on the server (`force`), so the game commits a set only a few
/// seconds after its last swipe, with Undo in between (`SimilarGameView`).
@MainActor
@Observable
final class SimilarCleaner {
    struct Stats: Codable, Equatable {
        /// `yyyy-MM-dd`, local calendar.
        var day = ""
        var setsToday = 0
        var bytesToday: Int64 = 0
        var deletedToday = 0
        /// Last day the ring closed, and how many days in a row it has.
        var lastGoalDay = ""
        var streak = 0
        var setsTotal = 0
        var deletedTotal = 0
        var bytesTotal: Int64 = 0
        var lastPlayed: Date?
    }

    private(set) var groups: [SimilarGroup] = []
    private(set) var loaded = false
    private(set) var loading = false
    /// A manual search (Immich's duplicate detection) is running.
    private(set) var scanning = false
    private(set) var error: String?
    private(set) var stats: Stats
    /// Server ids deleted in the game whose original is still on this iPhone.
    private(set) var pendingDevice: [String: String] = [:] // remoteId -> PhotoKit id
    private(set) var notificationStatus: UNAuthorizationStatus = .notDetermined

    static let goalChoices = [3, 5, 10, 20]
    var dailyGoal: Int {
        didSet { defaults.set(dailyGoal, forKey: Keys.goal) }
    }
    var remindersOn: Bool {
        didSet {
            defaults.set(remindersOn, forKey: Keys.reminders)
            if remindersOn { Task { await requestNotifications() } }
        }
    }

    /// Sets taken off the queue and waiting for their undo window: a reload must not bring them back.
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored var service: (any MediaService)?
    @ObservationIgnored private let space: SpaceSaver
    @ObservationIgnored private let defaults = UserDefaults.standard

    private enum Keys {
        static let stats = "similar.stats", goal = "similar.goal", reminders = "similar.reminders"
        static let pending = "similar.pendingDevice", notified = "similar.notifiedIds"
        static let lastNotified = "similar.lastNotified", lastCheck = "similar.lastCheck"
    }
    static let notificationID = "similar-photos"

    init(space: SpaceSaver) {
        self.space = space
        stats = (defaults.data(forKey: Keys.stats)).flatMap { try? JSONDecoder().decode(Stats.self, from: $0) } ?? Stats()
        dailyGoal = defaults.object(forKey: Keys.goal) as? Int ?? 5
        remindersOn = defaults.object(forKey: Keys.reminders) as? Bool ?? true
        pendingDevice = defaults.dictionary(forKey: Keys.pending) as? [String: String] ?? [:]
        let pending = Set(pendingDevice.values)
        space.isDiscarded = { pending.contains($0) }
        rollDay()
        Task { await refreshNotificationStatus() }
    }

    // MARK: Ring and streak

    var ringProgress: Double { dailyGoal == 0 ? 0 : min(1, Double(stats.setsToday) / Double(dailyGoal)) }
    var ringClosed: Bool { stats.lastGoalDay == Self.dayKey(.now) }
    /// The streak still counts until the end of the day after it last grew.
    var currentStreak: Int {
        let today = Self.dayKey(.now), yesterday = Self.dayKey(Calendar.current.date(byAdding: .day, value: -1, to: .now) ?? .now)
        return stats.lastGoalDay == today || stats.lastGoalDay == yesterday ? stats.streak : 0
    }
    /// Rough: everything but the first (suggested) photo of each set.
    var reclaimableBytes: Int64 {
        var sum: Int64 = 0
        for g in groups { for item in g.items.dropFirst() { sum += item.bytes ?? 0 } }
        return sum
    }

    /// Later: to the back of the queue.
    func skip(_ id: String) {
        guard let i = groups.firstIndex(where: { $0.id == id }) else { return }
        groups.append(groups.remove(at: i))
    }

    static func dayKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func rollDay() {
        let today = Self.dayKey(.now)
        guard stats.day != today else { return }
        stats.day = today
        stats.setsToday = 0
        stats.bytesToday = 0
        stats.deletedToday = 0
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(stats) { defaults.set(data, forKey: Keys.stats) }
    }

    // MARK: Sets

    func load(force: Bool = false) async {
        guard let service, !loading, force || !loaded else { return }
        loading = true
        defer { loading = false }
        do {
            let fetched = try await service.similarGroups().filter { !inFlight.contains($0.id) }
            // Sets already queued keep their place (the one on screen stays on top); new ones follow.
            let byId = Dictionary(fetched.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            let known = groups.compactMap { byId[$0.id] }
            let knownIds = Set(known.map(\.id))
            groups = known + fetched.filter { !knownIds.contains($0.id) }
            error = nil
            loaded = true
        } catch {
            self.error = error.localizedDescription
        }
        rollDay()
    }

    /// Search now instead of waiting for Immich's own run after new uploads. Returns what to tell
    /// the user.
    func scan(wholeLibrary: Bool) async -> String {
        guard let service, !scanning else { return "" }
        scanning = true
        defer { scanning = false }
        let before = Set(groups.map(\.id))
        var note: String?
        do {
            try await service.scanSimilar(wholeLibrary: wholeLibrary)
        } catch APIError.http(403, _) {
            note = "Only an Immich admin can start a search. Showing the latest results."
        } catch is CancellationError {
            return ""
        } catch {
            note = error.localizedDescription
        }
        await load(force: true)
        if let note { return note }
        let fresh = groups.filter { !before.contains($0.id) }.count
        switch fresh {
        case 0: return groups.isEmpty ? "No similar photos found." : "Nothing new. \(groups.count.formatted()) sets to go."
        case 1: return "Found 1 new set."
        default: return "Found \(fresh.formatted()) new sets."
        }
    }

    /// The set leaves the queue right away (the game moves on); `commit` makes it final.
    func take(_ id: String) {
        inFlight.insert(id)
        groups.removeAll { $0.id == id }
    }

    /// Puts a set back after Undo or a failed commit.
    func putBack(_ group: SimilarGroup, at index: Int = 0) {
        inFlight.remove(group.id)
        guard !groups.contains(where: { $0.id == group.id }) else { return }
        groups.insert(group, at: min(index, groups.count))
    }

    /// Final: Immich merges metadata onto `keep` and deletes `discard` for good.
    func commit(_ group: SimilarGroup, keep: [String], discard: [String]) async throws {
        guard let service else { return }
        // Before the server delete: which originals are still on this iPhone.
        var local: [String: String] = [:]
        for id in discard { if let l = space.localId(onDevice: id) { local[id] = l } }
        try await service.resolveSimilar(group.id, keep: keep, discard: discard)
        inFlight.remove(group.id)

        rollDay()
        let bytes = group.items.filter { discard.contains($0.id) }.reduce(Int64(0)) { $0 + ($1.bytes ?? 0) }
        stats.setsToday += 1
        stats.setsTotal += 1
        stats.deletedToday += discard.count
        stats.deletedTotal += discard.count
        stats.bytesToday += bytes
        stats.bytesTotal += bytes
        stats.lastPlayed = .now
        // The ring closes at the goal, or when there is nothing left to do today.
        if !ringClosed, stats.setsToday >= dailyGoal || groups.isEmpty {
            let yesterday = Self.dayKey(Calendar.current.date(byAdding: .day, value: -1, to: .now) ?? .now)
            stats.streak = stats.lastGoalDay == yesterday ? stats.streak + 1 : 1
            stats.lastGoalDay = Self.dayKey(.now)
        }
        save()
        if !local.isEmpty {
            pendingDevice.merge(local) { $1 }
            savePending()
        }
    }

    // MARK: iPhone copies

    var pendingDeviceCount: Int { pendingDevice.count }

    /// One iOS prompt for every original whose server copy the game deleted.
    @discardableResult
    func removeFromDevice() async -> String? {
        guard !pendingDevice.isEmpty else { return nil }
        do {
            let gone = try await space.deleteFromDevice(localIds: Array(pendingDevice.values))
            guard !gone.isEmpty else { return nil }
            pendingDevice = pendingDevice.filter { !gone.contains($0.value) }
            savePending()
            return gone.count == 1 ? "Removed 1 photo from this iPhone." : "Removed \(gone.count) photos from this iPhone."
        } catch {
            return error.localizedDescription
        }
    }

    private func savePending() {
        defaults.set(pendingDevice, forKey: Keys.pending)
        let pending = Set(pendingDevice.values)
        space.isDiscarded = { pending.contains($0) }
    }

    // MARK: Reminder

    func refreshNotificationStatus() async {
        notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestNotifications() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshNotificationStatus()
    }

    /// From the background refresh: at most one reminder a day, only for sets the user hasn't
    /// been told about, or when the game hasn't been opened for two days.
    func backgroundCheck() async {
        guard remindersOn, let service, !service.isMock else { return }
        if let last = defaults.object(forKey: Keys.lastCheck) as? Date, Date().timeIntervalSince(last) < 3 * 3600 { return }
        defaults.set(Date(), forKey: Keys.lastCheck)
        await refreshNotificationStatus()
        guard notificationStatus == .authorized || notificationStatus == .provisional else { return }
        if let last = defaults.object(forKey: Keys.lastNotified) as? Date, Date().timeIntervalSince(last) < 20 * 3600 { return }
        guard let found = try? await service.similarGroups(), !found.isEmpty else { return }
        groups = found
        loaded = true

        let told = Set(defaults.stringArray(forKey: Keys.notified) ?? [])
        let fresh = found.filter { !told.contains($0.id) }
        let idle = stats.lastPlayed.map { Date().timeIntervalSince($0) > 2 * 86_400 } ?? true
        guard !fresh.isEmpty || idle else { return }

        let content = UNMutableNotificationContent()
        content.title = found.count == 1 ? "1 set of similar photos" : "\(found.count) sets of similar photos"
        let bytes = reclaimableBytes
        content.body = bytes > 0
            ? "Keep the best shots and free about \(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))."
            : "Keep the best shots, delete the rest."
        if currentStreak > 0, !ringClosed { content.body += " Your \(currentStreak)-day streak is waiting." }
        content.sound = nil
        content.threadIdentifier = Self.notificationID
        let request = UNNotificationRequest(identifier: Self.notificationID, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
        defaults.set(Date(), forKey: Keys.lastNotified)
        defaults.set(found.map(\.id), forKey: Keys.notified)
    }
}
