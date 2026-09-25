//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The feature band: the one large card at the top of the home screen, paged on
// dots. It mirrors `apps/web`'s FeatureCard, and it is modelled on tvOS's
// CinematicSelectionContentGroup — same idea, same two libraries, sized for a
// phone and driven by taps rather than focus.
//

#if os(iOS)
import Combine
import Defaults
import FactoryKit
import JellyfinAPI
import SwiftUI

struct FeatureContentGroup: ContentGroup {

    let id = "cinema-feature"
    let viewModel: FeatureContentGroupViewModel

    /// A group with nothing behind it disappears rather than rendering an
    /// empty frame, which is how every other group here behaves.
    var _shouldBeResolved: Bool {
        viewModel.hasContent
    }

    init(
        resumeLibrary: ResumeItemsLibrary,
        recentlyAddedLibrary: RecentlyAddedLibrary
    ) {
        self.viewModel = FeatureContentGroupViewModel(
            resumeLibrary: resumeLibrary,
            recentlyAddedLibrary: recentlyAddedLibrary
        )
    }

    func body(with viewModel: FeatureContentGroupViewModel) -> some View {
        FeatureBand(viewModel: viewModel)
    }
}

// MARK: - View model

final class FeatureContentGroupViewModel: ViewModel, WithRefresh {

    typealias Background = FeatureContentGroupViewModel

    let recentlyAddedViewModel: PagingLibraryViewModel<RecentlyAddedLibrary>
    let resumeViewModel: PagingLibraryViewModel<ResumeItemsLibrary>

    var background: FeatureContentGroupViewModel {
        get { self }
        set {}
    }

    /// How many pages the band holds. Also the recently-added page size: that
    /// library exists here only to fill the band.
    static let capacity = 5

    /// What you were watching leads; the newest arrivals stand in when there is
    /// nothing to resume. Capped, because this is a pager, not a library.
    var items: [BaseItemDto] {
        let resume = resumeViewModel.elements.elements
        let source = resume.isNotEmpty ? resume : recentlyAddedViewModel.elements.elements
        return Array(source.prefix(Self.capacity))
    }

    var hasContent: Bool {
        items.isNotEmpty
    }

    init(
        resumeLibrary: ResumeItemsLibrary,
        recentlyAddedLibrary: RecentlyAddedLibrary
    ) {
        // The resume list is sized for the row under the band, which shows more
        // than the band's five; the fallback is sized for the band alone.
        self.resumeViewModel = PagingLibraryViewModel(library: resumeLibrary, pageSize: 20)
        self.recentlyAddedViewModel = PagingLibraryViewModel(library: recentlyAddedLibrary, pageSize: Self.capacity)

        super.init()

        resumeViewModel.objectWillChange
            .merge(with: recentlyAddedViewModel.objectWillChange)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
    }

    func refresh() {
        Task {
            await refresh()
        }
    }

    func refresh() async {
        await resumeViewModel.refresh()

        // The fallback is for an account with nothing in progress, which is the
        // uncommon case. Fetched alongside the resume list it was a third
        // request on every refresh whose answer was thrown away.
        guard resumeViewModel.elements.isEmpty else { return }

        await recentlyAddedViewModel.refresh()
    }
}

// MARK: - View

private struct FeatureBand: View {

    @Injected(\.currentUserSession)
    private var userSession: UserSession?

    @ObservedObject
    var viewModel: FeatureContentGroupViewModel

    @Router
    private var router

    @State
    private var selection: String?

    private var items: [BaseItemDto] {
        viewModel.items
    }

    var body: some View {
        // The band is a card on the page, so it carries the same inset as the
        // rows below it. Edge-to-edge made it read as a header rather than as
        // the first item of the same list.
        TabView(selection: $selection) {
            ForEach(items, id: \.id) { item in
                FeatureCard(
                    item: item,
                    onPlay: { play(item) },
                    onDetails: { router.route(to: .item(item: item)) }
                )
                .tag(item.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .aspectRatio(aspectRatio, contentMode: .fit)
        .overlay(alignment: .bottomTrailing) {
            // On the card, level with the action row, rather than below it.
            if items.count > 1 {
                PageDots(items: items, selection: $selection)
                    .padding(.trailing, 16)
                    .padding(.bottom, FeatureCard.indicatorBottomInset)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: CinemaTokens.Radius.xl))
        .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
        .edgePadding(.horizontal)
        .onChange(of: items.map(\.id)) { _, ids in
            // The pager's selection has to survive a refresh replacing the
            // items, and has to exist before the first render or TabView shows
            // a blank page.
            if selection == nil || !ids.contains(selection) {
                selection = ids.first ?? nil
            }
        }
        .onAppear {
            selection = items.first?.id
        }
    }

    /// A phone wants the copy close to the artwork; an iPad has the width to
    /// let the backdrop breathe.
    private var aspectRatio: CGFloat {
        UIDevice.isPad ? 21 / 9 : 16 / 10
    }

    /// Play straight from the band. The item view is one tap away for
    /// everything else — this button exists so the common case is not two.
    private func play(_ item: BaseItemDto) {
        guard let provider = item.getPlaybackItemProvider(userSession: userSession) else {
            router.route(to: .item(item: item))
            return
        }

        let queue: (any MediaPlayerQueue)? = item.type == .episode
            ? EpisodeMediaPlayerQueue(episode: item)
            : nil

        router.route(to: .videoPlayer(provider: provider, queue: queue))
    }
}

private struct PageDots: View {

    let items: [BaseItemDto]

    @Binding
    var selection: String?

    var body: some View {
        HStack(spacing: 6) {
            ForEach(items, id: \.id) { item in
                Capsule()
                    .fill(item.id == selection ? Color.cinemaForeground : Color.cinemaForeground.opacity(0.35))
                    .frame(width: item.id == selection ? 20 : 6, height: 6)
                    // A 6pt dot is not a tap target; the hit area is.
                    .contentShape(Rectangle().inset(by: -8))
                    .onTapGesture {
                        selection = item.id
                    }
            }
        }
        .animation(.snappy, value: selection)
        .accessibilityHidden(true)
    }
}
#endif
