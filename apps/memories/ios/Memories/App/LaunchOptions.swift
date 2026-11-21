import Foundation

enum AppTab: String, Hashable {
    case library, collections, search
}

enum LibraryMode: String, CaseIterable, Hashable {
    case years, months, all

    var title: String {
        switch self {
        case .years: "Years"
        case .months: "Months"
        case .all: "All"
        }
    }
}

/// Launch arguments for the simulator and UI checks:
///
///     -mock                     fixture library, no server or credentials
///     -mockCount 50000          size of the fixture library (default 2400)
///     -initialTab collections   library | collections | search
///     -libraryMode months       years | months | all
///     -columns 3                3 | 5 | 7 | 13
///     -openViewer               open the newest item in the viewer
///     -openInfo                 ...and its info sheet
///     -openSettings             open Settings & Backup
///     -openMemory               play the first memory
///     -searchQuery sunset       run a search on the Search tab
///     -selectMode               start the Library in select mode
///     -accountsURL http://…     a local accounts service instead of accounts.davideghiotto.it
///     -approveCode ABCD-EFGH    open the TV approval sheet, as a /memories/device link would
struct LaunchOptions: Sendable {
    var mock = false
    var mockCount = 2_400
    var initialTab: AppTab = .library
    var libraryMode: LibraryMode = .all
    var columns: Int?
    var openViewer = false
    var openInfo = false
    var openSettings = false
    var openMemory = false
    var searchQuery: String?
    var selectMode = false
    var accountsURL: URL?
    var approveCode: String?

    static let current = LaunchOptions(arguments: ProcessInfo.processInfo.arguments)

    init(arguments: [String]) {
        func value(_ flag: String) -> String? {
            guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
            let v = arguments[i + 1]
            return v.hasPrefix("-") ? nil : v
        }
        mock = arguments.contains("-mock")
        if let n = value("-mockCount").flatMap(Int.init) { mockCount = max(1, n) }
        if let t = value("-initialTab").flatMap(AppTab.init(rawValue:)) { initialTab = t }
        if let m = value("-libraryMode").flatMap(LibraryMode.init(rawValue:)) { libraryMode = m }
        if let c = value("-columns").flatMap(Int.init), [3, 5, 7, 13].contains(c) { columns = c }
        openViewer = arguments.contains("-openViewer")
        openInfo = arguments.contains("-openInfo")
        if openInfo { openViewer = true }
        openSettings = arguments.contains("-openSettings")
        openMemory = arguments.contains("-openMemory")
        searchQuery = value("-searchQuery")
        selectMode = arguments.contains("-selectMode")
        accountsURL = value("-accountsURL").flatMap(URL.init(string:))
        approveCode = value("-approveCode")
    }
}
