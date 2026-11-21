import SwiftUI
import UIKit

/// Tokens from apps/memories/DESIGN.md. Placeholder colors come from Photos.app's asset
/// catalog (REA evidence); the rest are system semantic colors.
enum Theme {
    /// `ThumbnailPlaceholderColor`: #CCCCCC light / #333333 dark.
    static let placeholderUIColor = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(white: 0.20, alpha: 1) : UIColor(white: 0.80, alpha: 1) }
    static let placeholder = Color(uiColor: placeholderUIColor)

    /// Library grid background: pure black in dark, white in light.
    static let gridUIColor = UIColor { $0.userInterfaceStyle == .dark ? .black : .white }
    static let gridBackground = Color(uiColor: gridUIColor)

    /// Grouped background: #F2F2F7 light / #000000 dark.
    static let groupedUIColor = UIColor { $0.userInterfaceStyle == .dark
        ? .black : UIColor(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF7 / 255, alpha: 1) }
    static let groupedBackground = Color(uiColor: groupedUIColor)

    /// Card: #FFFFFF light / #1C1C1E dark.
    static let cardUIColor = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255, alpha: 1) : .white }
    static let card = Color(uiColor: cardUIColor)

    static let accent = Color(uiColor: .systemBlue)

    enum Radius {
        static let card: CGFloat = 16
        static let albumCover: CGFloat = 10
    }

    /// Large title: 34pt bold, tracking 0.37.
    static let largeTitle = Font.system(size: 34, weight: .bold)
    static let largeTitleTracking: CGFloat = 0.37
    /// Library header date: 17pt semibold over a scrim.
    static let headerDate = Font.system(size: 17, weight: .semibold)

    /// Top scrim used under floating headers on the photo grid.
    static func topScrim(height: CGFloat = 160) -> some View {
        LinearGradient(
            stops: [
                .init(color: .black.opacity(0.55), location: 0),
                .init(color: .black.opacity(0.25), location: 0.55),
                .init(color: .clear, location: 1),
            ],
            startPoint: .top, endPoint: .bottom)
            .frame(height: height)
            .allowsHitTesting(false)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity)
    }
}
