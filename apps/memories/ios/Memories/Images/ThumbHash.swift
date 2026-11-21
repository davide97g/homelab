import Foundation
import UIKit

/// Swift port of Evan Wallace's ThumbHash (MIT, https://github.com/evanw/thumbhash).
/// Immich sends `thumbhash` as base64; the decoder turns it into a ~32 px RGBA placeholder.
/// The encoder exists for tests and for the mock data source.
enum ThumbHash {
    struct RGBAImage: Equatable {
        var width: Int
        var height: Int
        var rgba: [UInt8]
    }

    // MARK: Decode

    static func decode(base64: String) -> RGBAImage? {
        guard let data = Data(base64Encoded: base64), data.count >= 5 else { return nil }
        return decode([UInt8](data))
    }

    static func decode(_ hash: [UInt8]) -> RGBAImage? {
        guard hash.count >= 5 else { return nil }
        let header24 = Int(hash[0]) | (Int(hash[1]) << 8) | (Int(hash[2]) << 16)
        let header16 = Int(hash[3]) | (Int(hash[4]) << 8)
        let lDC = Double(header24 & 63) / 63
        let pDC = Double((header24 >> 6) & 63) / 31.5 - 1
        let qDC = Double((header24 >> 12) & 63) / 31.5 - 1
        let lScale = Double((header24 >> 18) & 31) / 31
        let hasAlpha = (header24 >> 23) != 0
        let pScale = Double((header16 >> 3) & 63) / 63
        let qScale = Double((header16 >> 9) & 63) / 63
        let isLandscape = (header16 >> 15) != 0
        let lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7)
        let ly = max(3, isLandscape ? header16 & 7 : (hasAlpha ? 5 : 7))
        if hasAlpha && hash.count < 6 { return nil }
        let aDC = hasAlpha ? Double(hash[5] & 15) / 15 : 1
        let aScale = hasAlpha ? Double(hash[5] >> 4) / 15 : 0

        let acStart = hasAlpha ? 6 : 5
        var acIndex = 0
        func byte(_ i: Int) -> Int { i < hash.count ? Int(hash[i]) : 0 }
        func decodeChannel(_ nx: Int, _ ny: Int, _ scale: Double) -> [Double] {
            var ac: [Double] = []
            for cy in 0..<ny {
                var cx = cy > 0 ? 0 : 1
                while cx * ny < nx * (ny - cy) {
                    let nibble = (byte(acStart + (acIndex >> 1)) >> ((acIndex & 1) << 2)) & 15
                    acIndex += 1
                    ac.append((Double(nibble) / 7.5 - 1) * scale)
                    cx += 1
                }
            }
            return ac
        }
        let lAC = decodeChannel(lx, ly, lScale)
        let pAC = decodeChannel(3, 3, pScale * 1.25)
        let qAC = decodeChannel(3, 3, qScale * 1.25)
        let aAC = hasAlpha ? decodeChannel(5, 5, aScale) : []

        let ratio = approximateAspectRatio(hash)
        let w = Int((ratio > 1 ? 32 : 32 * ratio).rounded())
        let h = Int((ratio > 1 ? 32 / ratio : 32).rounded())
        guard w > 0, h > 0 else { return nil }
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let nfx = max(lx, hasAlpha ? 5 : 3)
        let nfy = max(ly, hasAlpha ? 5 : 3)
        var fx = [Double](repeating: 0, count: nfx)
        var fy = [Double](repeating: 0, count: nfy)
        var i = 0
        for y in 0..<h {
            for x in 0..<w {
                var l = lDC, p = pDC, q = qDC, a = aDC
                for cx in 0..<nfx { fx[cx] = cos(.pi / Double(w) * (Double(x) + 0.5) * Double(cx)) }
                for cy in 0..<nfy { fy[cy] = cos(.pi / Double(h) * (Double(y) + 0.5) * Double(cy)) }

                var j = 0
                for cy in 0..<ly {
                    var cx = cy > 0 ? 0 : 1
                    let fy2 = fy[cy] * 2
                    while cx * ly < lx * (ly - cy) {
                        l += lAC[j] * fx[cx] * fy2
                        cx += 1; j += 1
                    }
                }
                j = 0
                for cy in 0..<3 {
                    var cx = cy > 0 ? 0 : 1
                    let fy2 = fy[cy] * 2
                    while cx < 3 - cy {
                        let f = fx[cx] * fy2
                        p += pAC[j] * f
                        q += qAC[j] * f
                        cx += 1; j += 1
                    }
                }
                if hasAlpha {
                    j = 0
                    for cy in 0..<5 {
                        var cx = cy > 0 ? 0 : 1
                        let fy2 = fy[cy] * 2
                        while cx < 5 - cy {
                            a += aAC[j] * fx[cx] * fy2
                            cx += 1; j += 1
                        }
                    }
                }
                let b = l - 2.0 / 3.0 * p
                let r = (3 * l - b + q) / 2
                let g = r - q
                rgba[i] = UInt8(max(0, 255 * min(1, r)))
                rgba[i + 1] = UInt8(max(0, 255 * min(1, g)))
                rgba[i + 2] = UInt8(max(0, 255 * min(1, b)))
                rgba[i + 3] = UInt8(max(0, 255 * min(1, a)))
                i += 4
            }
        }
        return RGBAImage(width: w, height: h, rgba: rgba)
    }

    static func approximateAspectRatio(_ hash: [UInt8]) -> Double {
        guard hash.count >= 5 else { return 1 }
        let header = Int(hash[3])
        let hasAlpha = (hash[2] & 0x80) != 0
        let isLandscape = (hash[4] & 0x80) != 0
        let lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7
        let ly = isLandscape ? header & 7 : (hasAlpha ? 5 : 7)
        return ly == 0 ? 1 : Double(lx) / Double(ly)
    }

    static func averageRGBA(_ hash: [UInt8]) -> (r: Double, g: Double, b: Double, a: Double) {
        guard hash.count >= 5 else { return (0.2, 0.2, 0.2, 1) }
        let header = Int(hash[0]) | (Int(hash[1]) << 8) | (Int(hash[2]) << 16)
        let l = Double(header & 63) / 63
        let p = Double((header >> 6) & 63) / 31.5 - 1
        let q = Double((header >> 12) & 63) / 31.5 - 1
        let hasAlpha = (header >> 23) != 0
        let a = hasAlpha && hash.count > 5 ? Double(hash[5] & 15) / 15 : 1
        let b = l - 2.0 / 3.0 * p
        let r = (3 * l - b + q) / 2
        let g = r - q
        return (max(0, min(1, r)), max(0, min(1, g)), max(0, min(1, b)), a)
    }

    // MARK: Encode

    /// Encodes an RGBA image (≤100×100, not premultiplied) to a ThumbHash.
    static func encode(width w: Int, height h: Int, rgba: [UInt8]) -> [UInt8] {
        precondition(w <= 100 && h <= 100 && rgba.count == w * h * 4)
        var avgR = 0.0, avgG = 0.0, avgB = 0.0, avgA = 0.0
        for i in 0..<(w * h) {
            let j = i * 4
            let alpha = Double(rgba[j + 3]) / 255
            avgR += alpha / 255 * Double(rgba[j])
            avgG += alpha / 255 * Double(rgba[j + 1])
            avgB += alpha / 255 * Double(rgba[j + 2])
            avgA += alpha
        }
        if avgA > 0 { avgR /= avgA; avgG /= avgA; avgB /= avgA }

        let hasAlpha = avgA < Double(w * h)
        let lLimit = hasAlpha ? 5.0 : 7.0
        let maxWH = Double(max(w, h))
        let lx = max(1, Int((lLimit * Double(w) / maxWH).rounded()))
        let ly = max(1, Int((lLimit * Double(h) / maxWH).rounded()))
        var l = [Double](repeating: 0, count: w * h)
        var p = l, q = l, a = l
        for i in 0..<(w * h) {
            let j = i * 4
            let alpha = Double(rgba[j + 3]) / 255
            let r = avgR * (1 - alpha) + alpha / 255 * Double(rgba[j])
            let g = avgG * (1 - alpha) + alpha / 255 * Double(rgba[j + 1])
            let b = avgB * (1 - alpha) + alpha / 255 * Double(rgba[j + 2])
            l[i] = (r + g + b) / 3
            p[i] = (r + g) / 2 - b
            q[i] = r - g
            a[i] = alpha
        }

        func encodeChannel(_ channel: [Double], _ nx: Int, _ ny: Int) -> (Double, [Double], Double) {
            var dc = 0.0, ac: [Double] = [], scale = 0.0
            var fx = [Double](repeating: 0, count: w)
            for cy in 0..<ny {
                var cx = 0
                while cx * ny < nx * (ny - cy) {
                    var f = 0.0
                    for x in 0..<w { fx[x] = cos(.pi / Double(w) * Double(cx) * (Double(x) + 0.5)) }
                    for y in 0..<h {
                        let fy = cos(.pi / Double(h) * Double(cy) * (Double(y) + 0.5))
                        for x in 0..<w { f += channel[x + y * w] * fx[x] * fy }
                    }
                    f /= Double(w * h)
                    if cx > 0 || cy > 0 {
                        ac.append(f)
                        scale = max(scale, abs(f))
                    } else {
                        dc = f
                    }
                    cx += 1
                }
            }
            if scale > 0 { ac = ac.map { 0.5 + 0.5 / scale * $0 } }
            return (dc, ac, scale)
        }

        let (lDC, lAC, lScale) = encodeChannel(l, max(3, lx), max(3, ly))
        let (pDC, pAC, pScale) = encodeChannel(p, 3, 3)
        let (qDC, qAC, qScale) = encodeChannel(q, 3, 3)
        let alphaChannel = hasAlpha ? encodeChannel(a, 5, 5) : (0, [], 0)

        func r(_ v: Double) -> Int { Int(v.rounded(.toNearestOrAwayFromZero)) }
        let isLandscape = w > h
        let header24 = r(63 * lDC) | (r(31.5 + 31.5 * pDC) << 6) | (r(31.5 + 31.5 * qDC) << 12)
            | (r(31 * lScale) << 18) | ((hasAlpha ? 1 : 0) << 23)
        let header16 = (isLandscape ? ly : lx) | (r(63 * pScale) << 3) | (r(63 * qScale) << 9)
            | ((isLandscape ? 1 : 0) << 15)
        var hash: [UInt8] = [
            UInt8(header24 & 255), UInt8((header24 >> 8) & 255), UInt8(header24 >> 16),
            UInt8(header16 & 255), UInt8(header16 >> 8),
        ]
        let acStart = hasAlpha ? 6 : 5
        if hasAlpha { hash.append(UInt8(r(15 * alphaChannel.0) | (r(15 * alphaChannel.2) << 4))) }
        let channels = hasAlpha ? [lAC, pAC, qAC, alphaChannel.1] : [lAC, pAC, qAC]
        let total = channels.reduce(0) { $0 + $1.count }
        hash.append(contentsOf: [UInt8](repeating: 0, count: (total + 1) / 2))
        var acIndex = 0
        for ac in channels {
            for f in ac {
                hash[acStart + (acIndex >> 1)] |= UInt8(r(15 * f) << ((acIndex & 1) << 2))
                acIndex += 1
            }
        }
        return hash
    }

    // MARK: UIKit

    static func image(base64: String) -> UIImage? {
        guard let decoded = decode(base64: base64) else { return nil }
        return image(from: decoded)
    }

    static func image(from img: RGBAImage) -> UIImage? {
        let data = Data(img.rgba) as CFData
        guard let provider = CGDataProvider(data: data),
              let cg = CGImage(
                width: img.width, height: img.height, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: img.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        else { return nil }
        return UIImage(cgImage: cg)
    }

    /// Encodes a UIImage by first scaling it into a ≤100×100 RGBA buffer.
    static func encode(image: UIImage) -> [UInt8]? {
        guard let cg = image.cgImage else { return nil }
        let scale = min(100 / Double(cg.width), 100 / Double(cg.height), 1)
        let w = max(1, Int(Double(cg.width) * scale)), h = max(1, Int(Double(cg.height) * scale))
        var buffer = [UInt8](repeating: 0, count: w * h * 4)
        let ok = buffer.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(
                data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? encode(width: w, height: h, rgba: buffer) : nil
    }
}
