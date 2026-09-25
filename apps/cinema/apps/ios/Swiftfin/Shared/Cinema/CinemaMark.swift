//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The brand mark: the same film glyph `apps/web` puts at the top of its rail,
// drawn rather than imported so the three clients share one shape and it stays
// crisp at any size. Geometry is Lucide's `film`, on a 24-unit grid.
//

import SwiftUI

/// The film glyph, normalised to whatever square it is given.
struct CinemaFilmMark: Shape {

    /// Lucide draws on 24 units with a 2-unit stroke; keeping the ratio keeps
    /// the glyph's weight right at every size.
    static let strokeRatio: CGFloat = 2 / 24

    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let unit = side / 24
        let originX = rect.midX - side / 2
        let originY = rect.midY - side / 2

        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: originX + x * unit, y: originY + y * unit)
        }

        var path = Path()

        path.addRoundedRect(
            in: CGRect(
                origin: point(2, 2),
                size: CGSize(width: 20 * unit, height: 20 * unit)
            ),
            cornerSize: CGSize(width: 2.18 * unit, height: 2.18 * unit)
        )

        // The two sprocket rails, then the frame line between them.
        for x in [CGFloat(7), 17] {
            path.move(to: point(x, 2))
            path.addLine(to: point(x, 22))
        }

        path.move(to: point(2, 12))
        path.addLine(to: point(22, 12))

        // Four perforations, one per rail per half.
        for (x1, x2) in [(CGFloat(2), CGFloat(7)), (17, 22)] {
            for y in [CGFloat(7), 17] {
                path.move(to: point(x1, y))
                path.addLine(to: point(x2, y))
            }
        }

        return path
    }
}

/// The mark on its own, in the one action colour.
struct CinemaMark: View {

    var size: CGFloat = 24
    var color: Color = .cinemaPrimary

    var body: some View {
        CinemaFilmMark()
            .stroke(
                color,
                style: StrokeStyle(
                    lineWidth: size * CinemaFilmMark.strokeRatio,
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Mark plus name, the way the web app's rail sets it.
struct CinemaWordmark: View {

    var size: CGFloat = 24

    var body: some View {
        HStack(spacing: size * 0.33) {
            CinemaMark(size: size)

            Text(verbatim: "Cinema")
                .font(.system(size: size * 0.95, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(Color.cinemaForeground)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: "Cinema"))
    }
}

#Preview {
    VStack(spacing: 40) {
        CinemaMark(size: 96)
        CinemaWordmark(size: 28)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.cinemaCanvas)
}
