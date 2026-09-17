//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The resume row that sits under the feature band, drawn from the band's own
// view model rather than from a second one over the same endpoint.
//

#if os(iOS)
import SwiftUI

/// Upstream's shape for this row is `PosterGroup(library: ResumeItemsLibrary(…))`,
/// and beside the band that meant two view models over `/Items/Resume`: two
/// identical requests on every open, two more on every pull-to-refresh.
///
/// `ContentGroupViewModel` refreshes the view models of its groups uniqued by
/// object identity, so handing this group the band's view model is the whole
/// fix — the same move tvOS makes with `CinematicRecentlyAddedContentGroup`.
struct ResumeRowContentGroup: ContentGroup {

    let id = "cinema-resume-row"
    let viewModel: FeatureContentGroupViewModel

    /// Only the band falls back to recently-added; an empty resume list means
    /// there is no row to draw.
    var _shouldBeResolved: Bool {
        viewModel.resumeViewModel.elements.isNotEmpty
    }

    func body(with viewModel: FeatureContentGroupViewModel) -> some View {
        PosterHStackLibrarySection(
            viewModel: viewModel.resumeViewModel,
            group: PosterGroup(
                viewModel: viewModel.resumeViewModel,
                posterDisplayType: .landscape,
                posterSize: .medium,
                environment: .init(viewContext: .isInResume)
            )
        )
        .withViewContext(.isInResume)
    }
}
#endif
