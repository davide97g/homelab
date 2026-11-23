//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// Discover talks to accounts, not to Seerr: accounts checks the Jellyfin token this iPhone
// already holds, maps it to the same person's Seerr user and asks Seerr on their behalf
// (apps/accounts, /api/discover). No Seerr sign-in, no Seerr key on the device.
//

import FactoryKit
import Foundation

struct DiscoverClient: Sendable {

    struct Failure: LocalizedError {
        let status: Int
        let message: String

        var errorDescription: String? {
            switch status {
            case 401: "Your session expired. Sign out and back in."
            case 503: "The server has not been connected to Seerr yet."
            default: message.isEmpty ? "Discover answered \(status)." : message
            }
        }
    }

    let base: URL
    let token: String

    /// The signed-in Jellyfin user's token, against the same accounts the sign-in uses.
    @MainActor
    static var current: DiscoverClient? {
        guard let token = Container.shared.currentUserSession()?.user.accessToken else { return nil }
        return DiscoverClient(base: CinemaAccounts.shared.client.base, token: token)
    }

    func me() async throws -> DiscoverMe {
        try await get("me")
    }

    func row(_ row: DiscoverRow) async throws -> [DiscoverResult] {
        let page: DiscoverPage<DiscoverResult> = try await get("discover/\(row.rawValue)", ["page": "1"])
        return onlyTitles(page.results, fallback: row.mediaType)
    }

    func search(_ term: String) async throws -> [DiscoverResult] {
        let page: DiscoverPage<DiscoverResult> = try await get("search", ["query": term, "page": "1"])
        return onlyTitles(page.results, fallback: nil)
    }

    func details(type: String, id: Int) async throws -> DiscoverDetails {
        try await get("\(type)/\(id)")
    }

    func recommendations(type: String, id: Int) async throws -> [DiscoverResult] {
        let page: DiscoverPage<DiscoverResult> = try await get("\(type)/\(id)/recommendations", ["page": "1"])
        return onlyTitles(page.results, fallback: type)
    }

    /// accounts pins this list to the caller: it is always "my requests".
    func myRequests() async throws -> [DiscoverRequest] {
        let page: DiscoverPage<DiscoverRequest> = try await get(
            "request",
            ["take": "20", "skip": "0", "sort": "added", "filter": "all"]
        )
        return page.results
    }

    /// Download and NAS-copy progress for these `type:tmdbId` keys; titles with none are absent.
    func progress(keys: [String]) async throws -> [String: TitleProgress] {
        let reply: ProgressReply = try await get("progress", ["keys": keys.sorted().joined(separator: ",")])
        return reply.titles ?? [:]
    }

    func request(type: String, id: Int, seasons: [Int]?) async throws {
        struct Body: Encodable {
            let mediaType: String
            let mediaId: Int
            let seasons: [Int]?
        }
        _ = try await send("POST", "request", body: JSONEncoder().encode(Body(mediaType: type, mediaId: id, seasons: seasons)))
    }

    func cancel(requestID: Int) async throws {
        _ = try await send("DELETE", "request/\(requestID)")
    }

    // MARK: Plumbing

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = plain.date(from: raw) ?? fractional.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(raw)"))
        }
        return d
    }()

    /// RFC 3986's unreserved set, ASCII only.
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private func get<T: Decodable>(_ path: String, _ query: [String: String] = [:]) async throws -> T {
        try await Self.decoder.decode(T.self, from: send("GET", path, query: query))
    }

    private func send(_ method: String, _ path: String, query: [String: String] = [:], body: Data? = nil) async throws -> Data {
        var url = base.appending(path: "api/discover").appending(path: path)
        if !query.isEmpty {
            // Percent-encode by hand: Seerr's validator rejects a "+" for a space.
            var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            parts.percentEncodedQueryItems = query.sorted { $0.key < $1.key }.map {
                URLQueryItem(name: $0.key, value: $0.value.addingPercentEncoding(withAllowedCharacters: Self.unreserved))
            }
            url = parts.url!
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await AccountsClient.cookieless.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw Failure(status: status, message: obj?["error"] as? String ?? "")
        }
        return data
    }
}

/// Seerr's rows don't always say what they hold; the path does. People are not titles.
private func onlyTitles(_ results: [DiscoverResult], fallback: String?) -> [DiscoverResult] {
    results
        .map { r in
            var r = r
            if r.mediaType == nil { r.mediaType = fallback }
            return r
        }
        .filter { $0.mediaType == "movie" || $0.mediaType == "tv" }
}
