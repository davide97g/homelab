import Foundation
import Observation

@MainActor
@Observable
final class ViewerModel {
    let source: any AssetSource
    let app: AppModel
    var currentIndex: Int
    /// Bound to the pager's scroll position.
    var scrollID: Int?
    var chromeVisible = true
    var isZoomed = false
    var showInfo = false
    var confirmDelete = false
    var livePlaying = false
    var errorMessage: String?
    private(set) var details: [String: AssetDetail] = [:]
    /// Bumped on source changes so pages re-read their asset.
    private(set) var revision = 0

    @ObservationIgnored var dismissAction: (() -> Void)?
    @ObservationIgnored private var listener: ListenerToken?

    init(source: any AssetSource, startIndex: Int, app: AppModel) {
        self.source = source
        self.app = app
        self.currentIndex = startIndex
        self.scrollID = startIndex
        listener = source.addListener { [weak self] _ in self?.sourceChanged() }
    }

    var count: Int { source.count }
    var current: Asset? { source.asset(at: currentIndex) }

    func asset(at i: Int) -> Asset? {
        _ = revision
        return source.asset(at: i)
    }

    func didScroll(to id: Int?) {
        guard let id, id != currentIndex else { return }
        currentIndex = id
        isZoomed = false
        livePlaying = false
        source.ensureLoaded(max(0, id - 3)..<min(count, id + 4))
    }

    private func sourceChanged() {
        revision += 1
        if count == 0 { dismissAction?(); return }
        if currentIndex >= count {
            currentIndex = count - 1
            scrollID = currentIndex
        }
    }

    func detail(for asset: Asset) -> AssetDetail? { details[asset.id] }

    func loadDetail(for asset: Asset) async {
        guard details[asset.id] == nil else { return }
        do {
            details[asset.id] = try await app.service.assetDetail(id: asset.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleFavorite() {
        guard let a = current else { return }
        Task { await app.setFavorite([a.id], !a.isFavorite, in: source) }
    }

    func deleteCurrent() {
        guard let a = current else { return }
        Task { await app.trash([a.id], in: source) }
    }

    func toggleChrome() { chromeVisible.toggle() }

    func close() { dismissAction?() }
}
