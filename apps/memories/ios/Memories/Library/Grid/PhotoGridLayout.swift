import UIKit

/// Square-cell grid with arithmetic layout: attributes for a rect are computed from row math,
/// never by walking every item, so 50k+ items cost the same as 50.
final class PhotoGridLayout: UICollectionViewLayout {
    var columns: Int { didSet { if columns != oldValue { invalidateLayout() } } }
    var spacing: CGFloat
    /// When set, `targetContentOffset` keeps this item at the same on-screen y after a
    /// column change (pinch zoom).
    var anchor: (index: Int, viewY: CGFloat)?

    private var itemCount = 0
    private var side: CGFloat = 0
    private var width: CGFloat = 0

    init(columns: Int, spacing: CGFloat = 2) {
        self.columns = columns
        self.spacing = spacing
        super.init()
    }

    required init?(coder: NSCoder) { fatalError() }

    override func prepare() {
        super.prepare()
        guard let cv = collectionView else { return }
        itemCount = cv.numberOfSections > 0 ? cv.numberOfItems(inSection: 0) : 0
        width = cv.bounds.width - cv.adjustedContentInset.left - cv.adjustedContentInset.right
        let cols = CGFloat(max(1, columns))
        side = max(1, (width - spacing * (cols - 1)) / cols)
    }

    var rowHeight: CGFloat { side + spacing }
    var itemSide: CGFloat { side }

    override var collectionViewContentSize: CGSize {
        let rows = (itemCount + columns - 1) / max(1, columns)
        return CGSize(width: width, height: max(0, CGFloat(rows) * rowHeight - spacing))
    }

    func frame(for index: Int) -> CGRect {
        let row = index / columns, col = index % columns
        // Keep integral pixel edges so the 2 px gutters don't shimmer.
        let x = (CGFloat(col) * (side + spacing)).rounded(.down)
        let nextX = col == columns - 1 ? width : (CGFloat(col + 1) * (side + spacing)).rounded(.down) - spacing
        return CGRect(x: x, y: CGFloat(row) * rowHeight, width: nextX - x, height: side)
    }

    func index(at point: CGPoint) -> Int? {
        guard itemCount > 0, point.y >= 0 else { return nil }
        let row = Int(point.y / rowHeight)
        let col = min(columns - 1, max(0, Int(point.x / (side + spacing))))
        let i = row * columns + col
        return i < itemCount ? i : nil
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        guard itemCount > 0 else { return [] }
        let firstRow = max(0, Int(rect.minY / rowHeight))
        let lastRow = max(firstRow, Int(rect.maxY / rowHeight))
        let first = firstRow * columns
        let last = min(itemCount - 1, (lastRow + 1) * columns - 1)
        guard first <= last else { return [] }
        return (first...last).map { attrs(for: $0) }
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard indexPath.item < itemCount else { return nil }
        return attrs(for: indexPath.item)
    }

    private func attrs(for i: Int) -> UICollectionViewLayoutAttributes {
        let a = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: i, section: 0))
        a.frame = frame(for: i)
        return a
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        newBounds.width != collectionView?.bounds.width
    }

    override func targetContentOffset(forProposedContentOffset proposed: CGPoint) -> CGPoint {
        guard let anchor, let cv = collectionView, anchor.index < itemCount else { return proposed }
        let y = frame(for: anchor.index).minY - anchor.viewY
        let minY = -cv.adjustedContentInset.top
        let maxY = max(minY, collectionViewContentSize.height + cv.adjustedContentInset.bottom - cv.bounds.height)
        return CGPoint(x: proposed.x, y: min(max(y, minY), maxY))
    }
}
