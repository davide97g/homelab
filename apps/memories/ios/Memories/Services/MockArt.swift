import UIKit

/// Deterministic generated "photos" for mock mode and previews: skies, seas, hills, skylines.
/// No bundled images, nothing from Apple.
enum MockArt {
    enum Theme: Int, CaseIterable, Sendable {
        case sunset, sea, mountains, city, meadow, night

        var keywords: [String] {
            switch self {
            case .sunset: ["sunset", "sun", "evening", "orange"]
            case .sea: ["sea", "beach", "water", "ocean", "summer"]
            case .mountains: ["mountain", "snow", "ski", "hike"]
            case .city: ["city", "building", "street", "skyline"]
            case .meadow: ["park", "grass", "tree", "nature", "dog"]
            case .night: ["night", "stars", "moon", "concert"]
            }
        }
    }

    struct SplitMix: RandomNumberGenerator {
        var state: UInt64
        init(_ seed: UInt64) { state = seed &+ 0x9E37_79B9_7F4A_7C15 }
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
    }

    static func theme(for seed: UInt64) -> Theme {
        Theme(rawValue: Int(seed % UInt64(Theme.allCases.count)))!
    }

    static func render(seed: UInt64, ratio: Double, longSide: CGFloat) -> UIImage {
        let ratio = max(0.3, min(3.5, ratio))
        let size = ratio >= 1
            ? CGSize(width: longSide, height: (longSide / ratio).rounded())
            : CGSize(width: (longSide * ratio).rounded(), height: longSide)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            draw(seed: seed, in: CGRect(origin: .zero, size: size), ctx: ctx.cgContext)
        }
    }

    static func draw(seed: UInt64, in rect: CGRect, ctx: CGContext) {
        var rng = SplitMix(seed)
        let theme = theme(for: seed)
        let hueShift = CGFloat(Double.random(in: -0.04...0.04, using: &rng))
        func c(_ h: CGFloat, _ s: CGFloat, _ b: CGFloat) -> CGColor {
            var hh = (h + hueShift).truncatingRemainder(dividingBy: 1)
            if hh < 0 { hh += 1 }
            return UIColor(hue: hh, saturation: s, brightness: b, alpha: 1).cgColor
        }
        let w = rect.width, h = rect.height
        let horizon = h * CGFloat(Double.random(in: 0.48...0.68, using: &rng))

        func gradient(_ colors: [CGColor], from: CGPoint, to: CGPoint) {
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil)!
            ctx.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        }
        func ridge(base: CGFloat, amp: CGFloat, color: CGColor, peaks: Int) {
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: h))
            path.addLine(to: CGPoint(x: 0, y: base))
            let step = w / CGFloat(peaks)
            for i in 0...peaks {
                let x = CGFloat(i) * step
                let y = base - amp * CGFloat(Double.random(in: 0.2...1, using: &rng))
                path.addLine(to: CGPoint(x: x + step / 2, y: y))
                path.addLine(to: CGPoint(x: x + step, y: base - amp * 0.15))
            }
            path.addLine(to: CGPoint(x: w, y: h))
            path.closeSubpath()
            ctx.addPath(path)
            ctx.setFillColor(color)
            ctx.fillPath()
        }

        switch theme {
        case .sunset:
            gradient([c(0.62, 0.55, 0.45), c(0.95, 0.55, 0.95), c(0.08, 0.75, 1)], from: .zero, to: CGPoint(x: 0, y: horizon))
            let r = w * 0.12
            ctx.setFillColor(c(0.12, 0.45, 1))
            ctx.fillEllipse(in: CGRect(x: w * CGFloat(Double.random(in: 0.25...0.7, using: &rng)), y: horizon - r * 1.4, width: r * 2, height: r * 2))
            ridge(base: horizon + h * 0.04, amp: h * 0.12, color: c(0.75, 0.35, 0.35), peaks: 4)
            ridge(base: h * 0.86, amp: h * 0.1, color: c(0.78, 0.4, 0.2), peaks: 3)
        case .sea:
            gradient([c(0.57, 0.45, 1), c(0.55, 0.15, 1)], from: .zero, to: CGPoint(x: 0, y: horizon))
            gradient([c(0.53, 0.8, 0.75), c(0.5, 0.7, 0.55)], from: CGPoint(x: 0, y: horizon), to: CGPoint(x: 0, y: h))
            ctx.setFillColor(c(0.13, 0.25, 0.97))
            ctx.fill(CGRect(x: 0, y: h * 0.84, width: w, height: h * 0.16))
            ctx.setStrokeColor(UIColor.white.withAlphaComponent(0.5).cgColor)
            ctx.setLineWidth(max(1, w / 160))
            for i in 0..<5 {
                let y = horizon + (h * 0.84 - horizon) * CGFloat(i + 1) / 6
                ctx.move(to: CGPoint(x: w * 0.1, y: y)); ctx.addLine(to: CGPoint(x: w * 0.6, y: y))
            }
            ctx.strokePath()
            // Fill the sea first, so draw clouds on top of the sky.
            ctx.setFillColor(UIColor.white.withAlphaComponent(0.85).cgColor)
            for _ in 0..<3 {
                let cw = w * CGFloat(Double.random(in: 0.15...0.3, using: &rng))
                ctx.fillEllipse(in: CGRect(x: w * CGFloat(Double.random(in: 0...0.8, using: &rng)), y: horizon * CGFloat(Double.random(in: 0.15...0.6, using: &rng)), width: cw, height: cw * 0.35))
            }
        case .mountains:
            gradient([c(0.6, 0.6, 0.85), c(0.58, 0.2, 1)], from: .zero, to: CGPoint(x: 0, y: horizon))
            ridge(base: horizon, amp: h * 0.28, color: c(0.6, 0.12, 0.95), peaks: 3)
            ridge(base: horizon + h * 0.1, amp: h * 0.18, color: c(0.6, 0.35, 0.55), peaks: 4)
            ridge(base: h * 0.9, amp: h * 0.12, color: c(0.35, 0.5, 0.35), peaks: 5)
        case .city:
            gradient([c(0.6, 0.25, 0.9), c(0.08, 0.3, 1)], from: .zero, to: CGPoint(x: 0, y: horizon))
            var x: CGFloat = 0
            while x < w {
                let bw = w * CGFloat(Double.random(in: 0.06...0.16, using: &rng))
                let bh = h * CGFloat(Double.random(in: 0.2...0.55, using: &rng))
                ctx.setFillColor(c(0.62, 0.2, CGFloat(Double.random(in: 0.25...0.5, using: &rng))))
                ctx.fill(CGRect(x: x, y: h - bh - h * 0.12, width: bw, height: bh + h * 0.12))
                ctx.setFillColor(c(0.13, 0.5, 1))
                let win = max(2, bw / 6)
                var wy = h - bh - h * 0.1
                while wy < h * 0.85 {
                    if Bool.random(using: &rng) { ctx.fill(CGRect(x: x + win, y: wy, width: win, height: win)) }
                    wy += win * 2.5
                }
                x += bw + max(1, w / 200)
            }
            ctx.setFillColor(c(0.0, 0.0, 0.2))
            ctx.fill(CGRect(x: 0, y: h * 0.88, width: w, height: h * 0.12))
        case .meadow:
            gradient([c(0.55, 0.5, 0.95), c(0.5, 0.15, 1)], from: .zero, to: CGPoint(x: 0, y: horizon))
            ridge(base: horizon + h * 0.05, amp: h * 0.08, color: c(0.27, 0.55, 0.65), peaks: 2)
            gradient([c(0.25, 0.7, 0.75), c(0.22, 0.8, 0.5)], from: CGPoint(x: 0, y: horizon + h * 0.05), to: CGPoint(x: 0, y: h))
            ctx.setFillColor(c(0.25, 0.7, 0.75))
            ctx.fill(CGRect(x: 0, y: horizon + h * 0.05, width: w, height: h))
            for _ in 0..<Int.random(in: 1...3, using: &rng) {
                let tx = w * CGFloat(Double.random(in: 0.1...0.85, using: &rng))
                let ty = horizon + h * CGFloat(Double.random(in: 0.05...0.2, using: &rng))
                let tr = w * CGFloat(Double.random(in: 0.06...0.12, using: &rng))
                ctx.setFillColor(c(0.08, 0.6, 0.35))
                ctx.fill(CGRect(x: tx - tr * 0.12, y: ty, width: tr * 0.24, height: tr * 1.5))
                ctx.setFillColor(c(0.3, 0.7, 0.45))
                ctx.fillEllipse(in: CGRect(x: tx - tr, y: ty - tr * 1.4, width: tr * 2, height: tr * 2))
            }
        case .night:
            gradient([c(0.7, 0.8, 0.12), c(0.68, 0.7, 0.35)], from: .zero, to: CGPoint(x: 0, y: h))
            ctx.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
            for _ in 0..<40 {
                let s = max(1, w / CGFloat(Double.random(in: 150...300, using: &rng)))
                ctx.fillEllipse(in: CGRect(x: w * CGFloat(Double.random(in: 0...1, using: &rng)), y: horizon * CGFloat(Double.random(in: 0...1, using: &rng)), width: s, height: s))
            }
            let m = w * 0.09
            ctx.setFillColor(c(0.14, 0.15, 1))
            ctx.fillEllipse(in: CGRect(x: w * 0.68, y: h * 0.12, width: m * 2, height: m * 2))
            ridge(base: h * 0.85, amp: h * 0.15, color: c(0.7, 0.5, 0.08), peaks: 4)
        }
    }

    /// Avatar for mock People: a soft head-and-shoulders silhouette on a coloured disc.
    static func avatar(seed: UInt64, side: CGFloat) -> UIImage {
        var rng = SplitMix(seed)
        let hue = CGFloat(Double.random(in: 0...1, using: &rng))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let size = CGSize(width: side, height: side)
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            let cg = ctx.cgContext
            let colors = [UIColor(hue: hue, saturation: 0.45, brightness: 0.95, alpha: 1).cgColor,
                          UIColor(hue: hue + 0.08, saturation: 0.6, brightness: 0.7, alpha: 1).cgColor]
            let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil)!
            cg.drawLinearGradient(g, start: .zero, end: CGPoint(x: side, y: side), options: [])
            cg.setFillColor(UIColor.white.withAlphaComponent(0.85).cgColor)
            cg.fillEllipse(in: CGRect(x: side * 0.32, y: side * 0.2, width: side * 0.36, height: side * 0.4))
            cg.fillEllipse(in: CGRect(x: side * 0.12, y: side * 0.64, width: side * 0.76, height: side * 0.7))
        }
    }
}
