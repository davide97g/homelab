// Generates the app icon: `swift tools/make-icon.swift Memories/Resources/Assets.xcassets/AppIcon.appiconset`
// Our own artwork: two tilted photo frames (a little landscape with a sun) on a warm gradient.
// Deliberately nothing like Apple's Photos flower.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255, a])!
}

func render(dark: Bool) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
    let s = CGFloat(size)
    // Flip to top-left origin.
    ctx.translateBy(x: 0, y: s); ctx.scaleBy(x: 1, y: -1)

    let bg = dark ? [color(0x2A1B3D), color(0x14101F)] : [color(0xFFC56E), color(0xF0507A), color(0x7A4BD0)]
    let g = CGGradient(colorsSpace: space, colors: bg as CFArray, locations: nil)!
    ctx.drawLinearGradient(g, start: .zero, end: CGPoint(x: s, y: s), options: [])

    func frame(center: CGPoint, side: CGFloat, angle: CGFloat, fill: CGColor, landscape: Bool) {
        ctx.saveGState()
        ctx.translateBy(x: center.x, y: center.y)
        ctx.rotate(by: angle * .pi / 180)
        let r = CGRect(x: -side / 2, y: -side / 2, width: side, height: side)
        ctx.setShadow(offset: CGSize(width: 0, height: 18), blur: 40, color: color(0x000000, 0.28))
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: side * 0.13, cornerHeight: side * 0.13, transform: nil))
        ctx.setFillColor(fill)
        ctx.fillPath()
        ctx.setShadow(offset: .zero, blur: 0, color: nil)
        if landscape {
            let inner = r.insetBy(dx: side * 0.09, dy: side * 0.09)
            ctx.addPath(CGPath(roundedRect: inner, cornerWidth: side * 0.07, cornerHeight: side * 0.07, transform: nil))
            ctx.clip()
            let sky = CGGradient(colorsSpace: space, colors: [color(0xFFE3B3), color(0xFFB27A)] as CFArray, locations: nil)!
            ctx.drawLinearGradient(sky, start: CGPoint(x: 0, y: inner.minY), end: CGPoint(x: 0, y: inner.maxY), options: [])
            ctx.setFillColor(color(0xF7A84A))
            let sun = side * 0.16
            ctx.fillEllipse(in: CGRect(x: inner.maxX - sun * 1.9, y: inner.minY + sun * 0.7, width: sun, height: sun))
            ctx.setFillColor(color(0x6C4AB6))
            ctx.move(to: CGPoint(x: inner.minX, y: inner.maxY))
            ctx.addLine(to: CGPoint(x: inner.minX + inner.width * 0.38, y: inner.minY + inner.height * 0.45))
            ctx.addLine(to: CGPoint(x: inner.minX + inner.width * 0.62, y: inner.minY + inner.height * 0.72))
            ctx.addLine(to: CGPoint(x: inner.minX + inner.width * 0.78, y: inner.minY + inner.height * 0.58))
            ctx.addLine(to: CGPoint(x: inner.maxX, y: inner.maxY))
            ctx.closePath()
            ctx.fillPath()
            ctx.setFillColor(color(0x4A2F8A))
            ctx.move(to: CGPoint(x: inner.minX + inner.width * 0.45, y: inner.maxY))
            ctx.addLine(to: CGPoint(x: inner.minX + inner.width * 0.78, y: inner.minY + inner.height * 0.62))
            ctx.addLine(to: CGPoint(x: inner.maxX, y: inner.minY + inner.height * 0.8))
            ctx.addLine(to: CGPoint(x: inner.maxX, y: inner.maxY))
            ctx.closePath()
            ctx.fillPath()
        }
        ctx.restoreGState()
    }
    frame(center: CGPoint(x: s * 0.44, y: s * 0.45), side: s * 0.5, angle: -12, fill: color(0xFFFFFF, dark ? 0.25 : 0.45), landscape: false)
    frame(center: CGPoint(x: s * 0.56, y: s * 0.56), side: s * 0.5, angle: 7, fill: color(0xFFFFFF), landscape: true)
    return ctx.makeImage()!
}

func write(_ img: CGImage, _ name: String) {
    let url = out.appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    CGImageDestinationFinalize(dest)
    print("wrote \(url.path)")
}

write(render(dark: false), "icon-1024.png")
write(render(dark: true), "icon-1024-dark.png")
