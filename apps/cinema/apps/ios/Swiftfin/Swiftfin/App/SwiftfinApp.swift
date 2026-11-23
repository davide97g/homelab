//
// Swiftfin is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, you can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Jellyfin & Jellyfin Contributors
//

import PreferencesView
import SwiftUI
import UIKit

@main
struct SwiftfinApp: App {

    /// Cinema: TV approvals, from a `/cinema/device` universal link or Settings.
    @ObservedObject
    private var accounts = CinemaAccounts.shared

    /// Cinema: the animated mark over the first second of a cold launch.
    @State
    private var launching = true

    init() {
        Self.configure()

        UIScrollView.appearance().keyboardDismissMode = .onDrag

        // Sometimes the tab bar won't appear properly on push, always have material background.
        UITabBar.appearance().scrollEdgeAppearance = UITabBarAppearance(idiom: .unspecified)

        SwiftfinSpotlight().addSwiftfinToSpotlight()
    }

    var body: some Scene {
        WindowGroup {
            OverlayToastView {
                PreferencesView {
                    WithLocalUserAuthentication {
                        RootView()
                            .supportedOrientations(UIDevice.isPad ? .allButUpsideDown : .portrait)
                    }
                }
            }
            .ignoresSafeArea()
            .overlay {
                if launching {
                    CinemaLaunchView { launching = false }
                }
            }
            // Cinema is dark-only. This is declarative rather than the window
            // override upstream uses, because that one guards on `keyWindow`
            // and silently does nothing when it runs before a window exists.
            // It does not replace `RootCoordinator.applyAppAppearance()`, which
            // is what reaches UIKit and the accent colour; see the note there.
            .preferredColorScheme(.dark)
            // Cinema: the TV's QR, https://accounts.davideghiotto.it/cinema/device?user_code=…
            .onOpenURL { url in accounts.handle(url: url) }
            // Cinema: a QR scanned with the Camera arrives as a browsing-web activity, which
            // onOpenURL alone missed (seen in Memories on iOS 27).
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { accounts.handle(url: url) }
            }
            .sheet(item: $accounts.approval) { approval in
                AccountsDeviceApprovalView(code: approval.code)
                    .preferredColorScheme(.dark)
            }
        }
    }
}

extension UINavigationController {

    // Remove back button text
    override open func viewWillLayoutSubviews() {
        navigationBar.topItem?.backButtonDisplayMode = .minimal
    }
}
