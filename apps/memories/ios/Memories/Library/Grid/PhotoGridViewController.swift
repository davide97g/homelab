import SwiftUI
import UIKit

/// The photo grid. UIKit on purpose: a `UICollectionView` with an arithmetic layout, cell reuse
/// with per-cell load cancellation, `prefetchDataSource`, pinch zoom with an anchored content
/// offset, pan-to-select across cells and the system zoom transition into the viewer. LazyVGrid
/// can't size 50k items without materialising them, has no prefetch/cancel hooks, and can't open
/// pinned to the bottom reliably.
final class PhotoGridViewController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegate,
    UICollectionViewDataSourcePrefetching, UIGestureRecognizerDelegate {

    let source: any AssetSource
    let state: GridState
    let app: AppModel
    var extraInsets: UIEdgeInsets = .zero { didSet { if extraInsets != oldValue { applyInsets() } } }
    /// Library opens at the newest item (bottom); album grids open at the top.
    var startsAtBottom = true

    private var collectionView: UICollectionView!
    private var layout: PhotoGridLayout!
    private var listener: ListenerToken?
    private var didInitialScroll = false
    private var lastScrollRequest: UUID?
    private var lastTopIndex = -1

    // Pinch
    private var pinchBaseline: CGFloat = 1
    // Drag-to-select
    private var dragStart: Int?
    private var dragSelects = true
    private var dragSnapshot: Set<String> = []
    private var autoscrollLink: CADisplayLink?
    private var autoscrollSpeed: CGFloat = 0
    private var lastDragPoint: CGPoint = .zero

    init(source: any AssetSource, state: GridState, app: AppModel) {
        self.source = source
        self.state = state
        self.app = app
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.gridUIColor
        layout = PhotoGridLayout(columns: state.columns)
        collectionView = UICollectionView(frame: view.bounds, collectionViewLayout: layout)
        collectionView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        collectionView.backgroundColor = Theme.gridUIColor
        collectionView.register(PhotoCell.self, forCellWithReuseIdentifier: PhotoCell.reuseID)
        collectionView.dataSource = self
        collectionView.delegate = self
        collectionView.prefetchDataSource = self
        collectionView.contentInsetAdjustmentBehavior = .always
        collectionView.alwaysBounceVertical = true
        collectionView.showsVerticalScrollIndicator = true
        collectionView.allowsSelection = true
        view.addSubview(collectionView)
        applyInsets()

        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        collectionView.addGestureRecognizer(pinch)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleSelectPan(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        collectionView.addGestureRecognizer(pan)

        listener = source.addListener { [weak self] change in self?.apply(change) }
        Task { await source.load() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        initialScrollIfNeeded()
    }

    private func applyInsets() {
        guard isViewLoaded else { return }
        collectionView.contentInset = extraInsets
        collectionView.verticalScrollIndicatorInsets = extraInsets
    }

    // MARK: SwiftUI -> UIKit

    func sync() {
        guard isViewLoaded else { return }
        if layout.columns != state.columns { setColumns(state.columns, anchorAt: nil) }
        if collectionView.allowsMultipleSelection != state.isSelecting {
            collectionView.allowsMultipleSelection = state.isSelecting
        }
        reconfigureVisible()
        if let req = state.scrollRequest, req.id != lastScrollRequest {
            lastScrollRequest = req.id
            if let i = req.index { scroll(to: i, animated: req.animated) } else { scrollToBottom(animated: req.animated) }
        }
        if let i = state.openViewerRequest, source.count > 0 {
            if source.asset(at: min(i, source.count - 1)) != nil {
                state.openViewerRequest = nil
                openViewer(at: min(i, source.count - 1))
            } else {
                source.ensureLoaded(max(0, i - 1)..<min(source.count, i + 1))
            }
        }
    }

    // MARK: Data changes

    private func apply(_ change: GridChange) {
        switch change {
        case .reloadAll:
            let wasAtBottom = isNearBottom
            collectionView.reloadData()
            collectionView.layoutIfNeeded()
            if !didInitialScroll { initialScrollIfNeeded() } else if wasAtBottom && startsAtBottom { scrollToBottom(animated: false) }
        case .reconfigure(let range):
            refreshVisibleCells(in: range)
            prefetchImages(for: range.clamped(to: visibleRange(margin: 2)))
        }
        updateHeader()
        if state.openViewerRequest != nil { sync() }
    }

    private func reconfigureVisible() { refreshVisibleCells(in: nil) }

    /// Re-configures on-screen cells in place. Deliberately not `reconfigureItems(at:)`: that runs
    /// a batch update, and an update that lands right after a programmatic jump (open at bottom)
    /// "preserves" stale visible items and yanks the offset back.
    private func refreshVisibleCells(in range: Range<Int>?) {
        for cell in collectionView.visibleCells {
            guard let cell = cell as? PhotoCell, let ip = collectionView.indexPath(for: cell) else { continue }
            if let range, !range.contains(ip.item) { continue }
            let asset = source.asset(at: ip.item)
            cell.configure(asset: asset, pipeline: app.pipeline, selecting: state.isSelecting,
                           selected: asset.map { state.selection.contains($0.id) } ?? false)
        }
    }

    private func initialScrollIfNeeded() {
        guard !didInitialScroll, source.count > 0, collectionView.bounds.height > 0 else { return }
        didInitialScroll = true
        if startsAtBottom {
            scrollToBottom(animated: false)
            // Once more after the first layout pass settles (safe-area insets arrive late).
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isNearBottom else { return }
                self.scrollToBottom(animated: false)
                self.updateHeader()
            }
        }
        loadVisible()
        updateHeader()
    }

    private var isNearBottom: Bool {
        let maxY = collectionView.contentSize.height + collectionView.adjustedContentInset.bottom - collectionView.bounds.height
        return collectionView.contentOffset.y >= maxY - 80
    }

    func scrollToBottom(animated: Bool) {
        // Size from the layout itself: contentSize can still be stale right after reloadData.
        layout.invalidateLayout()
        collectionView.layoutIfNeeded()
        let height = max(collectionView.contentSize.height, layout.collectionViewContentSize.height)
        let maxY = height + collectionView.adjustedContentInset.bottom - collectionView.bounds.height
        let y = max(-collectionView.adjustedContentInset.top, maxY)
        collectionView.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
        loadVisible()
    }

    func scroll(to index: Int, animated: Bool) {
        guard index < source.count else { return }
        collectionView.layoutIfNeeded()
        let frame = layout.frame(for: index)
        let maxY = max(-collectionView.adjustedContentInset.top,
                       collectionView.contentSize.height + collectionView.adjustedContentInset.bottom - collectionView.bounds.height)
        let y = min(maxY, max(-collectionView.adjustedContentInset.top, frame.minY - collectionView.adjustedContentInset.top - 8))
        collectionView.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
        loadVisible()
    }

    // MARK: Loading

    private func visibleRange(margin rows: Int) -> Range<Int> {
        let top = collectionView.contentOffset.y + collectionView.adjustedContentInset.top
        let bottom = collectionView.contentOffset.y + collectionView.bounds.height
        let rh = max(1, layout.rowHeight)
        let firstRow = max(0, Int(top / rh) - rows)
        let lastRow = Int(bottom / rh) + rows
        let lo = min(source.count, firstRow * layout.columns)
        let hi = min(source.count, (lastRow + 1) * layout.columns)
        return lo..<max(lo, hi)
    }

    private func loadVisible() {
        let rowsPerScreen = Int(collectionView.bounds.height / max(1, layout.rowHeight)) + 1
        source.ensureLoaded(visibleRange(margin: rowsPerScreen))
    }

    private func prefetchImages(for range: Range<Int>) {
        guard !range.isEmpty else { return }
        let reqs = range.compactMap { source.asset(at: $0) }.map {
            ImageRequest(id: $0.id, kind: .thumbnail, thumbhash: $0.thumbhash)
        }
        app.pipeline.prefetch(reqs)
    }

    // MARK: UICollectionViewDataSource

    func numberOfSections(in collectionView: UICollectionView) -> Int { 1 }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { source.count }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: PhotoCell.reuseID, for: indexPath) as! PhotoCell
        let asset = source.asset(at: indexPath.item)
        cell.configure(asset: asset, pipeline: app.pipeline, selecting: state.isSelecting,
                       selected: asset.map { state.selection.contains($0.id) } ?? false)
        if asset == nil { source.ensureLoaded(indexPath.item..<(indexPath.item + 1)) }
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        guard let lo = indexPaths.map(\.item).min(), let hi = indexPaths.map(\.item).max() else { return }
        source.ensureLoaded(lo..<(hi + 1))
        prefetchImages(for: lo..<(hi + 1))
    }

    // MARK: Delegate

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: false)
        guard let asset = source.asset(at: indexPath.item) else { return }
        if state.isSelecting {
            toggle(asset.id)
            refreshVisibleCells(in: indexPath.item..<(indexPath.item + 1))
        } else {
            openViewer(at: indexPath.item)
        }
    }

    func collectionView(_ collectionView: UICollectionView, contextMenuConfigurationForItemsAt indexPaths: [IndexPath], point: CGPoint) -> UIContextMenuConfiguration? {
        guard !state.isSelecting, let ip = indexPaths.first, let asset = source.asset(at: ip.item) else { return nil }
        return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
            guard let self else { return nil }
            let fav = UIAction(title: asset.isFavorite ? "Unfavorite" : "Favorite",
                               image: UIImage(systemName: asset.isFavorite ? "heart.slash" : "heart")) { _ in
                Task { await self.app.setFavorite([asset.id], !asset.isFavorite, in: self.source) }
            }
            let select = UIAction(title: "Select", image: UIImage(systemName: "checkmark.circle")) { _ in
                self.state.isSelecting = true
                self.state.selection = [asset.id]
            }
            let delete = UIAction(title: "Delete", image: UIImage(systemName: "trash"), attributes: .destructive) { _ in
                Task { await self.app.trash([asset.id], in: self.source) }
            }
            return UIMenu(children: [fav, select, UIMenu(options: .displayInline, children: [delete])])
        }
    }

    private func toggle(_ id: String) {
        if state.selection.contains(id) { state.selection.remove(id) } else { state.selection.insert(id) }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        loadVisible()
        updateHeader()
    }

    private func updateHeader() {
        guard source.count > 0 else {
            state.topDate = nil
            state.topPlace = nil
            return
        }
        let y = collectionView.contentOffset.y + collectionView.adjustedContentInset.top + 4
        let probe = CGPoint(x: 4, y: max(0, y))
        let idx = layout.index(at: probe) ?? max(0, min(source.count - 1, Int(y / max(1, layout.rowHeight)) * layout.columns))
        let atBottom = isNearBottom
        if state.isAtBottom != atBottom { state.isAtBottom = atBottom }
        guard idx != lastTopIndex else { return }
        lastTopIndex = idx
        let asset = source.asset(at: idx)
        let date = asset?.localDate ?? (source as? TimelineStore)?.bucketDate(at: idx)
        if state.topDate.map({ !Calendar.current.isDate($0, equalTo: date ?? .distantPast, toGranularity: .month) }) ?? true {
            state.topDate = date
        }
        let place = (source as? TimelineStore).flatMap { store in store.location(of: idx).flatMap { store.topPlace(ofBucket: $0.bucket) } }
            ?? asset?.place
        if state.topPlace != place { state.topPlace = place }
    }

    // MARK: Pinch zoom (3 / 5 / 7 / 13 columns)

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began:
            pinchBaseline = 1
        case .changed:
            let ratio = g.scale / pinchBaseline
            guard ratio > 1.3 || ratio < 0.75 else { return }
            let steps = GridState.columnSteps
            let i = steps.firstIndex(of: layout.columns) ?? 1
            let next = ratio > 1 ? max(0, i - 1) : min(steps.count - 1, i + 1)
            guard steps[next] != layout.columns else { pinchBaseline = g.scale; return }
            pinchBaseline = g.scale
            let point = g.location(in: collectionView)
            setColumns(steps[next], anchorAt: point)
            state.columns = steps[next]
            UISelectionFeedbackGenerator().selectionChanged()
        default:
            break
        }
    }

    private func setColumns(_ columns: Int, anchorAt point: CGPoint?) {
        let anchorPoint = point ?? CGPoint(x: collectionView.bounds.midX, y: collectionView.contentOffset.y + collectionView.bounds.height / 2)
        let anchorIndex = layout.index(at: anchorPoint) ?? visibleRange(margin: 0).lowerBound
        let viewY = anchorPoint.y - collectionView.contentOffset.y
        let newLayout = PhotoGridLayout(columns: columns)
        // Place the anchor's new row so the finger stays over the same photo.
        let fraction = (anchorPoint.y - layout.frame(for: anchorIndex).minY) / max(1, layout.itemSide)
        newLayout.anchor = (anchorIndex, viewY - fraction * (collectionView.bounds.width / CGFloat(columns)))
        let wasAtBottom = isNearBottom && startsAtBottom
        collectionView.setCollectionViewLayout(newLayout, animated: true) { [weak self] _ in
            newLayout.anchor = nil
            if wasAtBottom { self?.scrollToBottom(animated: false) }
        }
        layout = newLayout
        loadVisible()
    }

    // MARK: Drag to select

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer, g.view === collectionView else { return true }
        guard state.isSelecting else { return false }
        let v = pan.velocity(in: collectionView)
        return abs(v.x) > abs(v.y)
    }

    @objc private func handleSelectPan(_ g: UIPanGestureRecognizer) {
        let p = g.location(in: collectionView)
        lastDragPoint = p
        switch g.state {
        case .began:
            guard let i = layout.index(at: p), let a = source.asset(at: i) else { return }
            dragStart = i
            dragSnapshot = state.selection
            dragSelects = !state.selection.contains(a.id)
            applyDrag(to: i)
        case .changed:
            guard dragStart != nil else { return }
            if let i = layout.index(at: p) { applyDrag(to: i) }
            updateAutoscroll(for: g.location(in: view))
        default:
            dragStart = nil
            stopAutoscroll()
        }
    }

    private func applyDrag(to current: Int) {
        guard let start = dragStart else { return }
        var sel = dragSnapshot
        for i in min(start, current)...max(start, current) {
            guard let a = source.asset(at: i) else { continue }
            if dragSelects { sel.insert(a.id) } else { sel.remove(a.id) }
        }
        if sel != state.selection {
            state.selection = sel
            reconfigureVisible()
        }
    }

    private func updateAutoscroll(for pointInView: CGPoint) {
        let edge: CGFloat = 80
        let top = view.safeAreaInsets.top + extraInsets.top + edge
        let bottom = view.bounds.height - view.safeAreaInsets.bottom - extraInsets.bottom - edge
        if pointInView.y < top {
            autoscrollSpeed = -min(24, (top - pointInView.y) / 3)
        } else if pointInView.y > bottom {
            autoscrollSpeed = min(24, (pointInView.y - bottom) / 3)
        } else {
            autoscrollSpeed = 0
        }
        if autoscrollSpeed != 0, autoscrollLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(autoscrollTick))
            link.add(to: .main, forMode: .common)
            autoscrollLink = link
        } else if autoscrollSpeed == 0 {
            stopAutoscroll()
        }
    }

    @objc private func autoscrollTick() {
        let minY = -collectionView.adjustedContentInset.top
        let maxY = max(minY, collectionView.contentSize.height + collectionView.adjustedContentInset.bottom - collectionView.bounds.height)
        var o = collectionView.contentOffset
        o.y = min(maxY, max(minY, o.y + autoscrollSpeed))
        let dy = o.y - collectionView.contentOffset.y
        collectionView.contentOffset = o
        lastDragPoint.y += dy
        if let i = layout.index(at: lastDragPoint) { applyDrag(to: i) }
    }

    private func stopAutoscroll() {
        autoscrollLink?.invalidate()
        autoscrollLink = nil
        autoscrollSpeed = 0
    }

    // MARK: Viewer

    func openViewer(at index: Int) {
        guard presentedViewController == nil else { return }
        let model = ViewerModel(source: source, startIndex: index, app: app)
        let host = UIHostingController(rootView: ViewerView(model: model).environment(app))
        host.view.backgroundColor = .black
        // The viewer is always dark. `.preferredColorScheme` inside a UIKit-presented host
        // doesn't reach the glass, which then went light on bright photos with white icons.
        host.overrideUserInterfaceStyle = .dark
        model.dismissAction = { [weak host] in host?.dismiss(animated: true) }

        let options = UIViewController.Transition.ZoomOptions()
        options.interactiveDismissShouldBegin = { _ in !model.isZoomed }
        options.alignmentRectProvider = nil
        host.preferredTransition = .zoom(options: options) { [weak self, weak model] _ in
            guard let self, let model else { return nil }
            return self.sourceView(forIndex: model.currentIndex)
        }
        host.modalPresentationStyle = .fullScreen
        present(host, animated: true)
    }

    /// Cell for the zoom transition; scrolls it into view first when the viewer paged away.
    private func sourceView(forIndex index: Int) -> UIView? {
        guard index < source.count else { return nil }
        let ip = IndexPath(item: index, section: 0)
        if collectionView.cellForItem(at: ip) == nil || !isFullyVisible(ip) {
            scroll(to: max(0, index - layout.columns * 2), animated: false)
            collectionView.layoutIfNeeded()
        }
        return (collectionView.cellForItem(at: ip) as? PhotoCell)?.imageView
    }

    private func isFullyVisible(_ ip: IndexPath) -> Bool {
        guard let attrs = collectionView.layoutAttributesForItem(at: ip) else { return false }
        let visible = collectionView.bounds.inset(by: collectionView.adjustedContentInset)
        return visible.contains(attrs.frame)
    }
}

/// SwiftUI wrapper.
struct PhotoGrid: UIViewControllerRepresentable {
    let source: any AssetSource
    let state: GridState
    var extraInsets: UIEdgeInsets = .zero
    var startsAtBottom = true
    @Environment(AppModel.self) private var app

    func makeUIViewController(context: Context) -> PhotoGridViewController {
        let vc = PhotoGridViewController(source: source, state: state, app: app)
        vc.startsAtBottom = startsAtBottom
        vc.extraInsets = extraInsets
        return vc
    }

    func updateUIViewController(_ vc: PhotoGridViewController, context: Context) {
        // Reading these registers observation, so SwiftUI calls us again when they change.
        _ = (state.columns, state.isSelecting, state.selection, state.scrollRequest, state.openViewerRequest)
        vc.extraInsets = extraInsets
        vc.sync()
    }
}
