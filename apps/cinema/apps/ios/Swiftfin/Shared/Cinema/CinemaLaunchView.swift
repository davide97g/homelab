//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// What a cold launch shows. iOS's own launch screen is the bare canvas (Info.plist names the
// LaunchBackground colour, the canvas token), so this view starts on exactly that frame:
// the film mark draws itself in, its perforations settle, the wordmark comes up and tightens,
// and then the whole thing lifts away to the app underneath. About 1.7 s; with Reduce Motion,
// the mark simply appears and fades.
//

#if os(iOS)
import SwiftUI

struct CinemaLaunchView: View {

    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion)
    private var reduceMotion

    @State
    private var frame: CGFloat = 0
    @State
    private var rails: CGFloat = 0
    @State
    private var perforations = false
    @State
    private var bloom = false
    @State
    private var word = false
    @State
    private var leaving = false

    private let size: CGFloat = 92

    var body: some View {
        ZStack {
            Color.cinemaCanvas

            VStack(spacing: 22) {
                ZStack {
                    stroke(.frame).trim(from: 0, to: frame).stroke(Color.cinemaPrimary, style: style)
                    stroke(.rails).trim(from: 0, to: rails).stroke(Color.cinemaPrimary, style: style)
                    stroke(.perforations)
                        .stroke(Color.cinemaPrimary, style: style)
                        .opacity(perforations ? 1 : 0)
                        .scaleEffect(perforations ? 1 : 0.82)
                }
                .frame(width: size, height: size)
                .background {
                    // A soft red light behind the mark, there and gone, like a projector warming up.
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [Color.cinemaPrimary.opacity(0.45), Color.cinemaPrimary.opacity(0)],
                                center: .center,
                                startRadius: 0,
                                endRadius: size * 1.1
                            )
                        )
                        .frame(width: size * 2.2, height: size * 2.2)
                        .opacity(bloom ? 1 : 0)
                        .scaleEffect(bloom ? 1 : 0.6)
                }

                Text(verbatim: "Cinema")
                    .font(.system(size: 30, weight: .bold))
                    .tracking(word ? -0.4 : 6)
                    .foregroundStyle(Color.cinemaForeground)
                    .opacity(word ? 1 : 0)
                    .offset(y: word ? 0 : 10)
            }
            .scaleEffect(leaving ? 1.12 : 1)
            .blur(radius: leaving ? 8 : 0)
        }
        .opacity(leaving ? 0 : 1)
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .allowsHitTesting(!leaving)
        .task { await play() }
    }

    private var style: StrokeStyle {
        StrokeStyle(lineWidth: size * CinemaFilmMark.strokeRatio, lineCap: .round, lineJoin: .round)
    }

    private func stroke(_ parts: CinemaFilmMark.Parts) -> CinemaFilmMark {
        CinemaFilmMark(parts: parts)
    }

    private func play() async {
        if reduceMotion {
            frame = 1
            rails = 1
            perforations = true
            word = true
            await pause(0.6)
            withAnimation(.easeOut(duration: 0.3)) { leaving = true }
            await pause(0.3)
            onFinish()
            return
        }

        await pause(0.08)
        withAnimation(.timingCurve(0.65, 0, 0.35, 1, duration: 0.62)) { frame = 1 }
        await pause(0.3)
        withAnimation(.timingCurve(0.65, 0, 0.35, 1, duration: 0.45)) { rails = 1 }
        await pause(0.3)
        withAnimation(.easeOut(duration: 0.7)) { bloom = true }
        withAnimation(.spring(response: 0.42, dampingFraction: 0.62)) { perforations = true }
        await pause(0.15)
        withAnimation(.spring(response: 0.6, dampingFraction: 0.85)) { word = true }
        await pause(0.45)
        withAnimation(.easeIn(duration: 0.5)) { bloom = false }
        await pause(0.2)
        withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.45)) { leaving = true }
        await pause(0.45)
        onFinish()
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }
}

#Preview {
    CinemaLaunchView {}
}
#endif
