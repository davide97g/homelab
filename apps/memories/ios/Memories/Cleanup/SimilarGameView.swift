import SwiftUI
import UserNotifications

/// Similar Photos as a card stack: swipe right to keep, left to delete, one set at a time.
/// Hold the compare button to flip the card to the photo you're keeping and spot what changed.
/// A finished set is deleted for good a few seconds later; Undo brings it back until then.
struct SimilarGameView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    /// Decisions for the set on top: asset id -> keep.
    @State private var decisions: [String: Bool] = [:]
    @State private var history: [String] = []
    @State private var pending: Pending?
    @State private var session = Session()
    @State private var showSummary = false
    @State private var drag: CGSize = .zero
    @State private var comparing = false
    @State private var hint: String?
    @State private var hapticSwipe = 0
    @State private var hapticRefuse = 0
    @State private var hapticRing = 0
    @AppStorage("similar.seenTutorial") private var seenTutorial = false

    private static let threshold: CGFloat = 110
    private static let undoWindow: Duration = .seconds(4)

    struct Pending {
        let group: SimilarGroup
        let keep: [String]
        let discard: [String]
        let history: [String]
        let task: Task<Void, Never>
    }

    struct Session {
        var sets = 0
        var deleted = 0
        var bytes: Int64 = 0
    }

    private var cleaner: SimilarCleaner { app.similar }
    private var group: SimilarGroup? { cleaner.groups.first }
    private var undecided: [SimilarItem] { group?.items.filter { decisions[$0.id] == nil } ?? [] }
    private var current: SimilarItem? { undecided.first }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if showSummary || (group == nil && cleaner.loaded) {
                    SimilarSummary(session: session, done: close)
                } else if let group, let current {
                    header.padding(.horizontal, 20).padding(.top, 4)
                    strip(group).padding(.top, 14)
                    cards(current).padding(.horizontal, 20).padding(.vertical, 12)
                    caption(current)
                    controls.padding(.top, 14).padding(.bottom, 8)
                } else if let error = cleaner.error {
                    ContentUnavailableView {
                        Label("Couldn't Load", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try Again") { Task { await cleaner.load(force: true) } }
                    }
                } else {
                    ProgressView(cleaner.scanning ? "Searching your library…" : "Looking for similar photos…")
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.groupedBackground)
            .overlay(alignment: .bottom) { undoPill }
            .navigationTitle("Similar Photos")
            .navigationSubtitle(subtitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { finishSession() }
                }
                if !showSummary {
                    ToolbarItem(placement: .primaryAction) { menu(group) }
                }
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticSwipe)
        .sensoryFeedback(.warning, trigger: hapticRefuse)
        .sensoryFeedback(.success, trigger: hapticRing)
        .sensoryFeedback(.selection, trigger: side)
        .task { await cleaner.load(force: true) }
        .interactiveDismissDisabled()
    }

    private var subtitle: String {
        let n = cleaner.groups.count
        if showSummary || n == 0 { return "" }
        return n == 1 ? "Last set" : "\(n.formatted()) sets left"
    }

    // MARK: Header: today's ring, space freed, streak

    private var header: some View {
        HStack(spacing: 12) {
            GoalRing(progress: cleaner.ringProgress, closed: cleaner.ringClosed, lineWidth: 5)
                .frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(cleaner.ringClosed ? "Goal reached" : "\(cleaner.stats.setsToday) of \(cleaner.dailyGoal) sets today")
                    .font(.subheadline.weight(.semibold))
                    .contentTransition(.numericText())
                Text(cleaner.stats.bytesToday > 0
                     ? "\(ByteCountFormatter.string(fromByteCount: cleaner.stats.bytesToday, countStyle: .file)) freed today"
                     : "Keep the best, delete the rest")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
            Spacer()
            if cleaner.currentStreak > 0 {
                Label("\(cleaner.currentStreak)", systemImage: "flame.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.orange)
                    .contentTransition(.numericText())
                    .accessibilityLabel("\(cleaner.currentStreak)-day streak")
            }
        }
        .animation(.snappy, value: cleaner.stats)
    }

    // MARK: The set, as a strip of thumbnails

    private func strip(_ group: SimilarGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(group.items) { item in
                    let decision = decisions[item.id]
                    AssetImage(item.asset)
                        .frame(width: 40, height: 40)
                        .clipShape(.rect(cornerRadius: 6))
                        .opacity(decision == false ? 0.35 : 1)
                        .overlay {
                            if item.id == current?.id {
                                RoundedRectangle(cornerRadius: 6).stroke(Theme.accent, lineWidth: 2)
                            }
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if let decision {
                                Image(systemName: decision ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .font(.system(size: 14))
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, decision ? Color.green : Color.red)
                                    .offset(x: 4, y: 4)
                            }
                        }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .animation(.snappy, value: decisions)
    }

    // MARK: Cards

    /// -1 past the delete threshold, 1 past keep, 0 in between (drives the selection tick).
    private var side: Int {
        drag.width > Self.threshold ? 1 : drag.width < -Self.threshold ? -1 : 0
    }

    private func cards(_ item: SimilarItem) -> some View {
        let next = undecided.dropFirst().first
        return ZStack {
            if let next {
                SimilarCard(item: next, shown: next)
                    .scaleEffect(0.93)
                    .offset(y: 16)
                    .opacity(0.5)
                    .allowsHitTesting(false)
            }
            SimilarCard(item: item, shown: comparing ? (reference(for: item) ?? item) : item)
                .overlay(alignment: .top) { stamps }
                .overlay(alignment: .bottom) {
                    if comparing, let ref = reference(for: item) {
                        Label(ref.isSuggested ? "Best" : "Kept", systemImage: "square.on.square")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .glassEffect(.regular, in: .capsule)
                            .padding(12)
                    }
                }
                .offset(x: drag.width, y: drag.height * 0.25)
                .rotationEffect(.degrees(Double(drag.width) / 22), anchor: .bottom)
                .gesture(dragGesture)
                .id(item.id)
                .transition(.identity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Photo \(position(of: item)) of \(group?.items.count ?? 0)")
                .accessibilityAction(named: "Keep") { decide(item, keep: true) }
                .accessibilityAction(named: "Delete") { decide(item, keep: false) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var stamps: some View {
        let strength = min(1, abs(drag.width) / Self.threshold)
        HStack {
            Stamp(text: "Keep", systemImage: "checkmark", color: .green)
                .opacity(drag.width > 0 ? strength : 0)
            Spacer()
            Stamp(text: "Delete", systemImage: "trash", color: .red)
                .opacity(drag.width < 0 ? strength : 0)
        }
        .padding(16)
        .allowsHitTesting(false)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { drag = $0.translation }
            .onEnded { v in
                guard let item = current else { return }
                let dx = v.translation.width, flick = v.predictedEndTranslation.width
                if dx > Self.threshold || flick > Self.threshold * 2.5 {
                    swipe(item, keep: true)
                } else if dx < -Self.threshold || flick < -Self.threshold * 2.5 {
                    swipe(item, keep: false)
                } else {
                    withAnimation(.spring(duration: 0.35, bounce: 0.3)) { drag = .zero }
                }
            }
    }

    private func caption(_ item: SimilarItem) -> some View {
        var parts = [item.asset.localDate.formatted(.dateTime.day().month(.abbreviated).year().hour().minute().second().inTimeZone(.gmt))]
        if let w = item.width, let h = item.height, w > 0 { parts.append("\(w) × \(h)") }
        if let b = item.bytes { parts.append(ByteCountFormatter.string(fromByteCount: b, countStyle: .file)) }
        return VStack(spacing: 4) {
            Text(parts.joined(separator: " · "))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(hint ?? (seenTutorial ? " " : "Swipe right to keep, left to delete"))
                .font(.footnote.weight(.medium))
                .foregroundStyle(hint == nil ? Color.secondary : Color.orange)
                .animation(.snappy, value: hint)
        }
        .padding(.horizontal, 20)
    }

    // MARK: Buttons

    private var controls: some View {
        HStack(spacing: 22) {
            RoundButton(systemImage: "trash", tint: .red, size: 64) {
                if let current { swipe(current, keep: false) }
            }
            .accessibilityLabel("Delete")
            RoundButton(systemImage: "arrow.uturn.backward", tint: .primary, size: 48) { undo() }
                .disabled(history.isEmpty && pending == nil)
                .accessibilityLabel("Undo")
            compareButton
            RoundButton(systemImage: "checkmark", tint: .green, size: 64) {
                if let current { swipe(current, keep: true) }
            }
            .accessibilityLabel("Keep")
        }
    }

    /// Press and hold: the card shows the photo you're keeping, release to come back.
    private var compareButton: some View {
        Image(systemName: "square.on.square")
            .font(.system(size: 19, weight: .semibold))
            .foregroundStyle(comparing ? Theme.accent : .primary)
            .frame(width: 48, height: 48)
            .glassEffect(.regular.interactive(), in: .circle)
            .onLongPressGesture(minimumDuration: 60, maximumDistance: 40, perform: {}, onPressingChanged: { comparing = $0 })
            .accessibilityLabel("Hold to compare")
            .opacity(current.flatMap(reference(for:)) == nil ? 0.35 : 1)
    }

    @ViewBuilder
    private var undoPill: some View {
        if let pending, !showSummary {
            HStack(spacing: 14) {
                Text(pending.discard.isEmpty ? "Kept all \(pending.keep.count)"
                     : pending.discard.count == 1 ? "Deleting 1 photo" : "Deleting \(pending.discard.count) photos")
                    .font(.subheadline.weight(.medium))
                Button("Undo") { undo() }
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 18).padding(.vertical, 11)
            .glassEffect(.regular, in: .capsule)
            .padding(.bottom, 96)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func menu(_ group: SimilarGroup?) -> some View {
        Menu("More", systemImage: "ellipsis") {
            if let group {
                Section {
                    Button("Keep Best, Delete Others", systemImage: "sparkles") { keepBest(group) }
                    Button("Not Similar, Keep All", systemImage: "rectangle.on.rectangle.slash") { keepAll(group) }
                    Button("Later", systemImage: "arrow.turn.down.right") {
                        resetSet()
                        withAnimation(.snappy) { cleaner.skip(group.id) }
                    }
                }
            }
            Section {
                Button("Search New Photos", systemImage: "magnifyingglass") { search(wholeLibrary: false) }
                Button("Recheck Whole Library", systemImage: "arrow.clockwise") { search(wholeLibrary: true) }
            }
            .disabled(cleaner.scanning)
        }
    }

    /// Manual run of Immich's duplicate detection. The current set and its swipes stay put.
    private func search(wholeLibrary: Bool) {
        app.toast = wholeLibrary ? "Rechecking the whole library…" : "Searching new photos…"
        Task { app.toast = await cleaner.scan(wholeLibrary: wholeLibrary) }
    }

    // MARK: Moves

    private func position(of item: SimilarItem) -> Int {
        (group?.items.firstIndex(of: item) ?? 0) + 1
    }

    /// What to compare against: the first photo already kept, else Immich's pick, else the next one.
    private func reference(for item: SimilarItem) -> SimilarItem? {
        guard let group else { return nil }
        if let kept = group.items.first(where: { decisions[$0.id] == true && $0.id != item.id }) { return kept }
        if let best = group.items.first(where: { $0.isSuggested && $0.id != item.id && decisions[$0.id] == nil }) { return best }
        return undecided.first { $0.id != item.id }
    }

    /// Deleting the last undecided photo when nothing is kept would empty the set.
    private func refuses(_ item: SimilarItem, keep: Bool) -> Bool {
        !keep && undecided.count == 1 && !decisions.values.contains(true)
    }

    private func swipe(_ item: SimilarItem, keep: Bool) {
        if refuses(item, keep: keep) {
            hapticRefuse += 1
            showHint("Keep at least one photo of the set")
            withAnimation(.spring(duration: 0.4, bounce: 0.45)) { drag = .zero }
            return
        }
        withAnimation(.easeIn(duration: 0.18)) {
            drag = CGSize(width: keep ? 700 : -700, height: drag.height)
        } completion: {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { drag = .zero }
            decide(item, keep: keep)
        }
    }

    private func decide(_ item: SimilarItem, keep: Bool) {
        guard let group, decisions[item.id] == nil, !refuses(item, keep: keep) else { return }
        hapticSwipe += 1
        seenTutorial = true
        decisions[item.id] = keep
        history.append(item.id)
        if group.items.allSatisfy({ decisions[$0.id] != nil }) { finish(group) }
    }

    private func keepBest(_ group: SimilarGroup) {
        let open = group.items.filter { decisions[$0.id] == nil }
        // Immich's pick if still open; otherwise the first open one, unless something is already kept.
        let best = open.first(where: \.isSuggested) ?? (decisions.values.contains(true) ? nil : open.first)
        for item in open {
            decisions[item.id] = item.id == best?.id
            history.append(item.id)
        }
        hapticSwipe += 1
        finish(group)
    }

    private func keepAll(_ group: SimilarGroup) {
        for item in group.items { decisions[item.id] = true }
        history = group.items.map(\.id)
        hapticSwipe += 1
        finish(group)
    }

    /// The set leaves the queue now and is deleted after the undo window.
    private func finish(_ group: SimilarGroup) {
        let keep = group.items.filter { decisions[$0.id] == true }.map(\.id)
        let discard = group.items.filter { decisions[$0.id] == false }.map(\.id)
        let previous = pending
        let task = Task { @MainActor in
            try? await Task.sleep(for: Self.undoWindow)
            guard !Task.isCancelled else { return }
            await commitPending(group.id)
        }
        let item = Pending(group: group, keep: keep, discard: discard, history: history, task: task)
        withAnimation(.snappy) {
            cleaner.take(group.id)
            pending = item
        }
        resetSet()
        // A new finish closes the previous undo window right away.
        if let previous {
            previous.task.cancel()
            Task { await commit(previous) }
        }
    }

    private func commitPending(_ id: String) async {
        guard let p = pending, p.group.id == id else { return }
        withAnimation(.snappy) { pending = nil }
        await commit(p)
    }

    private func commit(_ p: Pending) async {
        let wasClosed = cleaner.ringClosed
        do {
            try await cleaner.commit(p.group, keep: p.keep, discard: p.discard)
            session.sets += 1
            session.deleted += p.discard.count
            session.bytes += p.group.items.filter { p.discard.contains($0.id) }.reduce(0) { $0 + ($1.bytes ?? 0) }
            if !wasClosed && cleaner.ringClosed { hapticRing += 1 }
            if !p.discard.isEmpty { app.library.remove(Set(p.discard)) }
        } catch {
            app.toast = error.localizedDescription
            withAnimation(.snappy) { cleaner.putBack(p.group) }
        }
    }

    private func undo() {
        if let last = history.popLast() {
            withAnimation(.snappy) { _ = decisions.removeValue(forKey: last) }
            return
        }
        guard let p = pending else { return }
        p.task.cancel()
        withAnimation(.snappy) {
            pending = nil
            cleaner.putBack(p.group)
            // Back to the set as it was before its last swipe.
            history = Array(p.history.dropLast())
            decisions = Dictionary(uniqueKeysWithValues: history.map { id in
                (id, p.keep.contains(id))
            })
        }
    }

    private func resetSet() {
        decisions = [:]
        history = []
        drag = .zero
        comparing = false
    }

    private func showHint(_ text: String) {
        hint = text
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            if hint == text { hint = nil }
        }
    }

    /// Close: commit what is waiting, then the summary (if anything happened) or out.
    private func finishSession() {
        if showSummary { close(); return }
        if let p = pending {
            p.task.cancel()
            pending = nil
            Task {
                await commit(p)
                withAnimation(.snappy) { showSummary = true }
            }
            return
        }
        if session.sets > 0 || cleaner.pendingDeviceCount > 0 {
            withAnimation(.snappy) { showSummary = true }
        } else {
            close()
        }
    }

    private func close() {
        dismiss()
    }
}

// MARK: - Pieces

struct SimilarCard: View {
    let item: SimilarItem
    /// What the card shows: `item`, or the reference while comparing.
    let shown: SimilarItem

    var body: some View {
        AssetImage(shown.asset, kind: .preview)
            .aspectRatio(item.asset.ratio, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 22))
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 6) {
                    if item.isSuggested {
                        Label("Best", systemImage: "sparkles")
                    }
                    if item.asset.isVideo {
                        Label("Video", systemImage: "video.fill")
                    }
                }
                .font(.caption.weight(.semibold))
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .glassEffect(.regular, in: .capsule)
                .padding(12)
                .opacity(item.isSuggested || item.asset.isVideo ? 1 : 0)
            }
            .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
    }
}

private struct Stamp: View {
    let text: String
    let systemImage: String
    let color: Color

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.headline.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(color, in: .capsule)
    }
}

private struct RoundButton: View {
    let systemImage: String
    let tint: Color
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
    }
}

/// Activity-style ring: today's sets against the goal.
struct GoalRing: View {
    let progress: Double
    let closed: Bool
    var lineWidth: CGFloat = 6

    var body: some View {
        ZStack {
            Circle().stroke(Color.green.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(AngularGradient(colors: [Color(hex: 0x2BD46A), Color(hex: 0x16B85A), Color(hex: 0x2BD46A)], center: .center),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if closed {
                Image(systemName: "checkmark")
                    .font(.system(size: lineWidth * 2.2, weight: .bold))
                    .foregroundStyle(.green)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.6, bounce: 0.25), value: progress)
        .animation(.spring(duration: 0.5, bounce: 0.4), value: closed)
    }
}

/// End of a session: what was done, the streak, and the two follow-ups (iPhone copies, reminder).
struct SimilarSummary: View {
    @Environment(AppModel.self) private var app
    let session: SimilarGameView.Session
    let done: () -> Void
    @State private var removing = false
    @State private var message: String?

    private var cleaner: SimilarCleaner { app.similar }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                GoalRing(progress: cleaner.ringProgress, closed: cleaner.ringClosed, lineWidth: 14)
                    .frame(width: 120, height: 120)
                    .padding(.top, 28)
                VStack(spacing: 6) {
                    Text(title).font(.title2.weight(.bold))
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if session.sets > 0 {
                    HStack(spacing: 0) {
                        stat("\(session.sets)", session.sets == 1 ? "Set" : "Sets")
                        Divider().frame(height: 36)
                        stat("\(session.deleted)", "Deleted")
                        Divider().frame(height: 36)
                        stat(ByteCountFormatter.string(fromByteCount: session.bytes, countStyle: .file), "Freed")
                    }
                    .padding(.vertical, 14)
                    .background(Theme.card, in: .rect(cornerRadius: Theme.Radius.card))
                }
                if cleaner.currentStreak > 0 {
                    Label(cleaner.currentStreak == 1 ? "1-day streak" : "\(cleaner.currentStreak)-day streak", systemImage: "flame.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                }

                VStack(spacing: 10) {
                    if cleaner.pendingDeviceCount > 0 {
                        Button {
                            removing = true
                            Task {
                                message = await cleaner.removeFromDevice()
                                removing = false
                            }
                        } label: {
                            Text(cleaner.pendingDeviceCount == 1 ? "Remove 1 from This iPhone"
                                 : "Remove \(cleaner.pendingDeviceCount) from This iPhone")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(removing)
                        Text("Already deleted from your library. iOS asks once, and keeps them in Recently Deleted for 30 days.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    if cleaner.notificationStatus == .notDetermined && cleaner.remindersOn {
                        Button {
                            Task { await cleaner.requestNotifications() }
                        } label: {
                            Label("Remind Me About New Sets", systemImage: "bell")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .controlSize(.large)
                    }
                    if let message {
                        Text(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button {
                        Task { message = await cleaner.scan(wholeLibrary: false) }
                    } label: {
                        Label(cleaner.scanning ? "Searching…" : "Search Again", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .disabled(cleaner.scanning)
                    Button("Done", action: done)
                        .buttonStyle(.glass)
                        .controlSize(.large)
                        .padding(.top, 6)
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .sensoryFeedback(.success, trigger: cleaner.ringClosed)
    }

    private var title: String {
        if cleaner.groups.isEmpty { return session.sets > 0 ? "All Clear" : "No Similar Photos" }
        return cleaner.ringClosed ? "Goal Reached" : "Nice Work"
    }

    private var subtitle: String {
        if cleaner.groups.isEmpty && session.sets == 0 {
            return "When Immich finds photos that look alike, they show up here."
        }
        let left = cleaner.groups.count
        if left == 0 { return "No more similar photos for now." }
        let sets = left == 1 ? "1 set" : "\(left.formatted()) sets"
        return cleaner.ringClosed ? "\(sets) left for another day." : "\(sets) left. \(max(0, cleaner.dailyGoal - cleaner.stats.setsToday)) more to close today's ring."
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title3.weight(.bold).monospacedDigit())
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
