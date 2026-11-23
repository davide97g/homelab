//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// A requested title on its way: four steps (requested, download, copy to the NAS, library),
// the one in progress with its bar and time left, and when it should be watchable. Without a
// report from the mini PC the steps still follow Seerr's status, just with no times. apps/web
// draws the same panel in src/components/discover/PipelineProgress.tsx.
//

#if os(iOS)
import SwiftUI

private enum PipelineStep: Int, CaseIterable {
    case request, download, nas, library

    var label: String {
        switch self {
        case .request: "Requested"
        case .download: "Download"
        case .nas: "Copy to NAS"
        case .library: "Library"
        }
    }

    init(stage: String) {
        switch stage {
        case "settling", "waiting", "sending", "verifying": self = .nas
        case "arrived": self = .library
        default: self = .download
        }
    }
}

struct PipelineProgressView: View {

    let standing: DiscoverStanding
    let progress: TitleProgress?

    var body: some View {
        // Re-renders every 30 s, so "12 min" counts down between polls.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            panel(now: context.date)
        }
    }

    private func panel(now: Date) -> some View {
        let step = progress.map { PipelineStep(stage: $0.stage) } ?? (standing == .pending ? .request : .download)
        let stalled = progress?.stage == "stalled"
        let line = describe(now: now)
        let eta = progress?.stage == "arrived" ? nil : progress?.eta

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                ForEach(PipelineStep.allCases, id: \.self) { s in
                    VStack(alignment: .leading, spacing: 6) {
                        Capsule()
                            .fill(
                                s.rawValue < step.rawValue ? Color.cinemaMatch
                                    : s == step ? (stalled ? Color.cinemaAmber : Color.cinemaPrimary)
                                    : Color.cinemaForeground.opacity(0.15)
                            )
                            .frame(height: 4)
                        Text(s.label.uppercased())
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(0.6)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .foregroundStyle(s == step ? Color.cinemaForeground : Color.cinemaMutedForeground)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(line.title)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    if let percent = line.percent {
                        Text("\(percent)%")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Color.cinemaMutedForeground)
                    }
                }
                if let percent = line.percent {
                    ProgressBar(percent: percent, color: stalled ? .cinemaAmber : .cinemaPrimary, height: 6)
                }
                if let detail = line.detail {
                    Text(detail)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color.cinemaMutedForeground)
                }
                if stalled, let message = progress?.message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(Color.cinemaAmber)
                }
            }

            if let eta {
                (Text("Ready to watch around ")
                    + Text(eta, format: .dateTime.hour().minute()).fontWeight(.semibold)
                    + Text(" · \(until(eta, now: now))").foregroundStyle(Color.cinemaMutedForeground))
                    .font(.caption)
                    .foregroundStyle(Color.cinemaForeground.opacity(0.8))
            }
        }
        .padding(16)
        .frame(maxWidth: 480, alignment: .leading)
        .background(Color.cinemaCanvas.opacity(0.7), in: RoundedRectangle(cornerRadius: CinemaTokens.Radius.lg))
    }

    private struct Line {
        var title: String
        var percent: Int?
        var detail: String?
    }

    private func describe(now: Date) -> Line {
        guard let p = progress else {
            return standing == .pending
                ? Line(title: "Waiting for an admin to approve it")
                : Line(title: "Looking for a good copy", detail: "It starts downloading as soon as one turns up.")
        }
        let files = (p.files ?? 0) > 1 ? " · \(p.filesArrived ?? 0) of \(p.files ?? 0) files there" : ""
        let got = p.download.map { "\(bytes(($0.size ?? 0) - ($0.left ?? 0))) of \(bytes($0.size ?? 0))" }
        let t = p.transfer
        let paused = t?.paused == true
        switch p.stage {
        case "queued":
            return Line(title: "Queued for download", percent: percentOf(p), detail: got)
        case "downloading":
            let left = p.download?.eta.map { " · \(until($0, now: now)) left" } ?? ""
            return Line(title: "Downloading", percent: percentOf(p), detail: got.map { $0 + left })
        case "stalled":
            return Line(title: "Download stuck", percent: percentOf(p), detail: got)
        case "importing":
            return Line(title: "Downloaded, moving it into place", percent: 100)
        case "settling":
            return Line(
                title: "Waiting for subtitles",
                detail: t?.startsAt.map { "The copy to the NAS starts around \(clock($0))\(files)" }
            )
        case "waiting":
            return paused
                ? Line(title: "Copy to the NAS is paused", detail: "It resumes when NAS sync is switched back on.")
                : Line(title: "Next in line for the NAS", detail: t?.startsAt.map { "Starts around \(clock($0))\(files)" })
        case "sending":
            let left = paused ? "" : (t?.eta.map { " · \(until($0, now: now)) left" } ?? "")
            return Line(
                title: paused ? "Copy to the NAS is paused" : "Copying to the NAS",
                percent: percentOf(p),
                detail: t.map { "\(bytes($0.bytes ?? 0)) of \(bytes($0.total ?? 0))\(left)\(files)" }
            )
        case "verifying":
            return Line(title: "Checking the copy", percent: 100, detail: "Comparing checksums on both ends.")
        case "arrived":
            return Line(title: "On the NAS, adding it to the library", detail: "The Watch button appears in a minute or two.")
        default:
            return Line(title: "On its way", percent: percentOf(p))
        }
    }
}

/// A slim bar along the bottom of a poster card, only while something is actually moving.
struct ProgressSliver: View {

    let progress: TitleProgress?

    var body: some View {
        if let p = progress, p.stage != "arrived" {
            ProgressBar(
                percent: percentOf(p) ?? 0,
                color: p.stage == "stalled" ? .cinemaAmber : p.transfer != nil ? .cinemaMatch : .cinemaPrimary,
                height: 4,
                track: Color.cinemaForeground.opacity(0.15)
            )
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
    }
}

private struct ProgressBar: View {
    let percent: Int
    let color: Color
    let height: CGFloat
    var track: Color = Color.cinemaForeground.opacity(0.1)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule()
                    .fill(color)
                    .frame(width: geo.size.width * CGFloat(min(max(percent, 0), 100)) / 100)
                    .animation(.easeOut(duration: 0.7), value: percent)
            }
        }
        .frame(height: height)
    }
}

private func percentOf(_ p: TitleProgress) -> Int? {
    if PipelineStep(stage: p.stage) == .nas, let t = p.transfer, let total = t.total, total > 0 {
        return Int((t.bytes ?? 0) / total * 100)
    }
    if let d = p.download, let size = d.size, size > 0 {
        return Int((size - (d.left ?? 0)) / size * 100)
    }
    return nil
}

private func clock(_ date: Date) -> String {
    date.formatted(.dateTime.hour().minute())
}

private func until(_ date: Date, now: Date) -> String {
    let min = max(1, Int((date.timeIntervalSince(now) / 60).rounded()))
    if min < 60 { return "~\(min) min" }
    let h = min / 60
    let m = min % 60
    return h < 24 ? "~\(h) h" + (m > 0 ? " \(m) min" : "") : "~\(Int((Double(h) / 24).rounded())) d"
}

private func bytes(_ n: Double) -> String {
    if n >= 1e9 { return String(format: "%.1f GB", n / 1e9) }
    if n >= 1e6 { return "\(Int((n / 1e6).rounded())) MB" }
    return "\(max(0, Int((n / 1e3).rounded()))) KB"
}
#endif
