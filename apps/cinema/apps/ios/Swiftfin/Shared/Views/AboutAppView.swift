//
// Swiftfin is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, you can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Jellyfin & Jellyfin Contributors
//

import JellyfinAPI
import SwiftUI

struct AboutAppView: View {

    @Router
    private var router

    var body: some View {
        // Cinema: the mark and the name are ours. Upstream's credit moved
        // down to the licence section, where MPL-2.0 wants it.
        Form {

            #if os(iOS)
            Section {
                VStack(alignment: .center, spacing: 16) {

                    CinemaMark(size: 120)

                    Text(verbatim: L10n.cinema)
                        .fontWeight(.semibold)
                        .font(.title2)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            #endif

            Section {
                LabeledContent(
                    L10n.version,
                    value: "\(UIApplication.appVersion ?? .emptyDash) (\(UIApplication.bundleVersion ?? .emptyDash))"
                )

                #if os(iOS)
                ChevronButton(
                    L10n.permissions,
                    systemName: "hand.raised.fill"
                ) {
                    router.route(to: .appPermissions)
                }
                #endif

                ChevronButton(
                    L10n.settings,
                    systemName: "gearshape.fill",
                    external: true
                ) {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            }

            Section {

                // tvOS cannot open generic web links
                #if !os(tvOS)
                ChevronButton(
                    L10n.sourceCode,
                    image: .logoGithub,
                    external: true
                ) {
                    UIApplication.shared.open(.cinemaGithub)
                }

                ChevronButton(
                    L10n.license,
                    content: L10n.mlp2,
                    systemName: "text.document",
                    external: true
                ) {
                    UIApplication.shared.open(.cinemaGithubLicense)
                }

                ChevronButton(
                    L10n.bugsAndFeatures,
                    systemName: "plus.circle.fill",
                    external: true
                ) {
                    UIApplication.shared.open(.cinemaGithubIssues)
                }
                .symbolRenderingMode(.monochrome)

                ChevronButton(
                    L10n.basedOnSwiftfin,
                    systemName: "arrow.triangle.branch",
                    external: true
                ) {
                    UIApplication.shared.open(.swiftfinGithub)
                }
                #endif
            }
        } image: {
            CinemaMark(size: 300)
        }
        .navigationTitle(L10n.aboutApp)
    }
}
