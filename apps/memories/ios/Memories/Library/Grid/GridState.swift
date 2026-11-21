import Foundation
import Observation

/// SwiftUI-side state for one photo grid: column count, selection, scroll commands, and what's
/// at the top of the screen (for the floating "Month Year" header).
@MainActor
@Observable
final class GridState {
    static let columnSteps = [3, 5, 7, 13]

    var columns: Int
    var isSelecting = false {
        didSet { if !isSelecting { selection = [] } }
    }
    var selection: Set<String> = []

    /// Header text sources, updated while scrolling.
    var topDate: Date?
    var topPlace: String?
    /// True once the user scrolled away from the newest items.
    var isAtBottom = true

    struct ScrollRequest: Equatable {
        let id = UUID()
        var index: Int?
        /// nil index = newest (bottom).
        var animated: Bool
    }
    var scrollRequest: ScrollRequest?
    /// Open the viewer at this index (deep link / programmatic).
    var openViewerRequest: Int?

    init(columns: Int = 5) {
        self.columns = columns
    }

    func zoom(in zoomIn: Bool) {
        let steps = Self.columnSteps
        let i = steps.firstIndex(of: columns) ?? 1
        let next = zoomIn ? max(0, i - 1) : min(steps.count - 1, i + 1)
        columns = steps[next]
    }

    func scrollToBottom(animated: Bool = true) {
        scrollRequest = ScrollRequest(index: nil, animated: animated)
    }

    func scroll(to index: Int, animated: Bool = false) {
        scrollRequest = ScrollRequest(index: index, animated: animated)
    }
}
