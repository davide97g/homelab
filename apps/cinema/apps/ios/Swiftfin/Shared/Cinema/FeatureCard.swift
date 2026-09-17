//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// One page of the feature band: backdrop, logo art where the server has it,
// the fact line, and the two actions. The web app's FeatureCard is the
// reference; see docs/DESIGN.md in the Cinema monorepo.
//

#if os(iOS)
import JellyfinAPI
import SwiftUI

struct FeatureCard: View {

    /// Fixed so the page dots the band overlays on the card can be centred
    /// against this row without measuring it.
    static let actionHeight: CGFloat = 40

    /// Where the dots sit: the card's padding, then half the action row.
    static let indicatorBottomInset: CGFloat = 16 + (actionHeight - 6) / 2

    let item: BaseItemDto
    let onPlay: () -> Void
    let onDetails: () -> Void

    private var backdropSource: ImageSource {
        item.imageSource(
            .backdrop,
            environment: ImageSourceOptions(maxWidth: 1200)
        )
    }

    private var logoSource: ImageSource {
        item.type == .episode
            ? item.imageSource(
                itemID: item.seriesID,
                .logo,
                tag: item.parentLogoImageTag,
                environment: ImageSourceOptions(maxWidth: 480, maxHeight: 160)
            )
            : item.imageSource(
                .logo,
                environment: ImageSourceOptions(maxWidth: 480, maxHeight: 160)
            )
    }

    /// There is no `logoImageTag` on BaseItemDto -- logos live in the generic
    /// `imageTags` dictionary, and an episode borrows its series' logo.
    private var hasLogo: Bool {
        item.type == .episode
            ? item.parentLogoImageTag != nil
            : item.imageTags?[ImageType.logo.rawValue] != nil
    }

    /// Jellyfin rates 0-10; everyone reads a percentage.
    private var matchPercent: Int? {
        guard let rating = item.communityRating else { return nil }
        return Int((rating * 10).rounded())
    }

    /// Only genuinely part-way through, which is Reel's rule for the hairline.
    private var progress: Double? {
        guard let progress = item.progressPercentage, progress > 0.01, progress < 0.99 else { return nil }
        return progress
    }

    private var facts: [String] {
        // Mid-watch, how much is left says more than the runtime does.
        if progress != nil, let progressLabel = item.progressLabel {
            return [progressLabel]
        }

        if item.type == .episode {
            return [
                item.parentIndexNumber.map { "S\($0)" },
                item.indexNumber.map { "E\($0)" },
                item.name,
            ].compactMap { $0 }
        }

        return [
            item.productionYear.map(String.init),
            item.runTimeLabel,
            item.officialRating,
        ].compactMap { $0 }
    }

    /// An episode leads with its series; a film has only itself.
    private var headline: String {
        item.type == .episode ? (item.seriesName ?? item.displayTitle) : item.displayTitle
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // The artwork fills and is clipped *before* anything is layered on
            // it. As a plain sibling in the stack it made the stack as wide as
            // the scaled image, which pushed the copy off the screen.
            Color.cinemaSurface
                .overlay {
                    ImageView(backdropSource)
                        .failure {
                            Color.cinemaSurface
                        }
                        .aspectRatio(contentMode: .fill)
                }
                .clipped()

            // Two washes: one carries the copy, one seats the card on the page.
            // The middle of the frame stays out of both.
            LinearGradient(
                stops: [
                    .init(color: Color.cinemaCanvas.opacity(0.95), location: 0),
                    .init(color: Color.cinemaCanvas.opacity(0.65), location: 0.45),
                    .init(color: .clear, location: 0.95),
                ],
                startPoint: .bottom,
                endPoint: .top
            )

            VStack(alignment: .leading, spacing: 8) {
                KindTag(item: item)

                Group {
                    if hasLogo {
                        ImageView(logoSource)
                            .failure { titleText }
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 220, maxHeight: 64, alignment: .leading)
                    } else {
                        titleText
                    }
                }

                factLine

                HStack(spacing: 10) {
                    Button(action: onPlay) {
                        Label(
                            progress == nil ? L10n.play : L10n.resume,
                            systemImage: "play.fill"
                        )
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 18)
                        .frame(minHeight: Self.actionHeight)
                        .background(Color.cinemaPrimary, in: RoundedRectangle(cornerRadius: CinemaTokens.Radius.md))
                        .foregroundStyle(Color.cinemaOnPrimary)
                    }

                    Button(action: onDetails) {
                        Label(L10n.details, systemImage: "info.circle")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 18)
                            .frame(minHeight: Self.actionHeight)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: CinemaTokens.Radius.md))
                            .foregroundStyle(Color.cinemaForeground)
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            .padding(16)

            // Reel draws progress as a hairline across the very bottom, and
            // only when playback is genuinely part-way through.
            if let progress {
                GeometryReader { proxy in
                    Rectangle()
                        .fill(Color.cinemaPrimary)
                        .frame(width: proxy.size.width * progress, height: 2)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
                .allowsHitTesting(false)
            }
        }
        .clipped()
        .contentShape(Rectangle())
        // Tapping the artwork is the same as asking for details -- the buttons
        // are the shortcuts, not the only way in.
        .onTapGesture(perform: onDetails)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(item.displayTitle)
    }

    private var titleText: some View {
        Text(headline)
            .font(.title2.weight(.bold))
            .foregroundStyle(Color.cinemaForeground)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
    }

    @ViewBuilder
    private var factLine: some View {
        HStack(spacing: 6) {
            if let matchPercent {
                Text(verbatim: "\(matchPercent)% match")
                    .foregroundStyle(Color.cinemaMatch)
                    .font(.caption.weight(.semibold))
            }

            DotSeparatedText(parts: facts)
        }
    }
}

/// A red tick and a word: Cinema's mark at card scale.
struct KindTag: View {

    let item: BaseItemDto

    private var label: String {
        switch item.type {
        case .series: L10n.series
        case .episode: L10n.episode
        case .movie: L10n.movie
        default: item.type?.displayTitle ?? ""
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Capsule()
                .fill(Color.cinemaPrimary)
                .frame(width: 3, height: 12)

            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(Color.cinemaForeground.opacity(0.75))
        }
    }
}

/// Metadata as text separated by dots, never as chips — chips made every card
/// look like a form.
struct DotSeparatedText: View {

    let parts: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
                if index > 0 {
                    Circle()
                        .fill(Color.cinemaMutedForeground)
                        .frame(width: 2, height: 2)
                }

                Text(part)
                    .font(.caption)
                    .foregroundStyle(Color.cinemaMutedForeground)
                    .lineLimit(1)
            }
        }
    }
}
#endif
