import Foundation
import Testing
@testable import Memories

/// Vectors produced by the reference JS implementation (npm thumbhash 0.1.1) on a synthetic
/// gradient image (same pixels as `gradient(_:_:)` below), via `rgbaToThumbHash`/`thumbHashToRGBA`.
struct ThumbHashTests {
    static func gradient(_ w: Int, _ h: Int) -> [UInt8] {
        var a = [UInt8](repeating: 0, count: w * h * 4)
        for y in 0..<h {
            for x in 0..<w {
                let i = (y * w + x) * 4
                a[i] = UInt8(Int(Double(x) * 255 / Double(w - 1)))
                a[i + 1] = UInt8(Int(Double(y) * 255 / Double(h - 1)))
                a[i + 2] = UInt8((x + y) * 7 % 256)
                a[i + 3] = 255
            }
        }
        return a
    }

    @Test("encode matches the reference", arguments: [
        (16, 12, "HAkOHZxwd3dweHiIiHiHeHRwCPd4"),
        (9, 20, "HQkOIxyBcIiHh4iHgIgI+Hg="),
    ])
    func encode(w: Int, h: Int, expected: String) {
        let hash = ThumbHash.encode(width: w, height: h, rgba: Self.gradient(w, h))
        let ref = [UInt8](Data(base64Encoded: expected)!)
        #expect(hash.count == ref.count)
        // Header bytes must match exactly. AC nibbles may differ by one where a coefficient
        // sits on an exact .5 and libm's cos() and V8's differ in the last ulp.
        #expect(Array(hash.prefix(5)) == Array(ref.prefix(5)))
        var off = 0
        for (a, b) in zip(hash.dropFirst(5), ref.dropFirst(5)) {
            for shift in [0, 4] {
                let d = abs(Int((a >> shift) & 15) - Int((b >> shift) & 15))
                #expect(d <= 1)
                off += d
            }
        }
        #expect(off <= 2)
    }

    @Test func decodeLandscapeMatchesReference() throws {
        let img = try #require(ThumbHash.decode(base64: "HAkOHZxwd3dweHiIiHiHeHRwCPd4"))
        #expect(img.width == 32)
        #expect(img.height == 23)
        #expect(img.rgba.reduce(0) { $0 + Int($1) } == 436_703)
        #expect(Array(img.rgba.prefix(8)) == [2, 7, 15, 255, 5, 9, 17, 255])
    }

    @Test func decodePortraitMatchesReference() throws {
        let img = try #require(ThumbHash.decode(base64: "HQkOIxyBcIiHh4iHgIgI+Hg="))
        #expect(img.width == 14)
        #expect(img.height == 32)
        #expect(img.rgba.reduce(0) { $0 + Int($1) } == 270_262)
        #expect(Array(img.rgba.prefix(8)) == [47, 33, 33, 255, 50, 31, 33, 255])
    }

    @Test func averageAndRatio() throws {
        let bytes = [UInt8](try #require(Data(base64Encoded: "HAkOHZxwd3dweHiIiHiHeHRwCPd4")))
        let avg = ThumbHash.averageRGBA(bytes)
        #expect(abs(avg.r - 0.5) < 1e-9)
        #expect(abs(avg.g - 0.4841269841269841) < 1e-9)
        #expect(abs(ThumbHash.approximateAspectRatio(bytes) - 1.4) < 1e-9)
    }

    @Test func garbageIsRejected() {
        #expect(ThumbHash.decode(base64: "not base64!") == nil)
        #expect(ThumbHash.decode([1, 2]) == nil)
    }

    @Test func imageFromHash() {
        #expect(ThumbHash.image(base64: "HAkOHZxwd3dweHiIiHiHeHRwCPd4")?.size.width == 32)
    }
}
