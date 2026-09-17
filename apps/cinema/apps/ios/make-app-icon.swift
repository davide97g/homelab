//
// Cinema — the app icon, rendered rather than drawn by hand.
//
//   swift apps/ios/make-app-icon.swift
//
// The mark is the film glyph the web rail uses and `Shared/Cinema/CinemaMark.swift`
// draws in the app, on Reel's canvas, in Reel's one action colour. Both colours
// are read from packages/design-tokens/tokens.json, so the icon cannot drift
// from the palette the rest of the app is built on.
//
// Writes AppIcon-primary-primary.png into the fork's asset catalogue.
//

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - Palette, from the tokens

let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // apps/ios
    .deletingLastPathComponent() // apps
    .deletingLastPathComponent() // repository root

let tokensURL = root.appending(path: "packages/design-tokens/tokens.json")

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

guard let data = try? Data(contentsOf: tokensURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let colors = json["color"] as? [String: Any]
else {
    fail("cannot read \(tokensURL.path)")
}

func token(_ name: String) -> CGColor {
    guard let entry = colors[name] as? [String: Any],
          let hex = entry["hex"] as? String
    else {
        fail("no colour token: \(name)")
    }

    var value: UInt64 = 0
    Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)

    return CGColor(
        srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
        green: CGFloat((value >> 8) & 0xFF) / 255,
        blue: CGFloat(value & 0xFF) / 255,
        alpha: 1
    )
}

let canvas = token("canvas")
let primary = token("primary")

// MARK: - The glyph

/// Lucide's `film`, on its 24-unit grid. Kept identical to
/// Shared/Cinema/CinemaMark.swift so the icon and the in-app mark are one shape.
func filmPath(side: CGFloat, origin: CGPoint) -> CGPath {
    let unit = side / 24

    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: origin.x + x * unit, y: origin.y + y * unit)
    }

    let path = CGMutablePath()

    path.addRoundedRect(
        in: CGRect(x: origin.x + 2 * unit, y: origin.y + 2 * unit, width: 20 * unit, height: 20 * unit),
        cornerWidth: 2.18 * unit,
        cornerHeight: 2.18 * unit
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

// MARK: - Render

let size = 1024

// No alpha channel at all: App Store Connect rejects an icon that has one.
guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    fail("cannot allocate the bitmap")
}

let bounds = CGRect(x: 0, y: 0, width: size, height: size)

// Flat near-black. Reel has no glow and no gradient, and an icon is the one
// place a house style is read at a glance.
context.setFillColor(canvas)
context.fill(bounds)

// The mark, at just over half the icon: large enough to read on a home screen,
// inside the safe area Apple's grid asks for.
let markSide = CGFloat(size) * 0.52
let markOrigin = CGPoint(x: (CGFloat(size) - markSide) / 2, y: (CGFloat(size) - markSide) / 2)

context.setStrokeColor(primary)
context.setLineWidth(markSide * 2 / 24)
context.setLineCap(.round)
context.setLineJoin(.round)
context.addPath(filmPath(side: markSide, origin: markOrigin))
context.strokePath()

guard let image = context.makeImage() else {
    fail("cannot render the icon")
}

let destination = root.appending(
    path: "apps/ios/Swiftfin/Swiftfin/Resources/Assets.xcassets/AppIcons/Primary/AppIcon-primary-primary.appiconset/AppIcon-primary-primary.png"
)

guard let sink = CGImageDestinationCreateWithURL(
    destination as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
) else {
    fail("cannot write \(destination.path)")
}

CGImageDestinationAddImage(sink, image, nil)

guard CGImageDestinationFinalize(sink) else {
    fail("cannot encode the png")
}

print("✓ \(destination.path)")
