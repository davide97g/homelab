import Foundation
import Synchronization
import UIKit

final class RemoteMediaService: MediaService {
    let api: APIClient
    var isMock: Bool { false }
    /// False once the public URL answered 404 for sentence search (no memories-search there).
    private let sentenceSearch = Mutex(true)

    init(api: APIClient) { self.api = api }

    func currentUser() async throws -> UserSummary {
        let me: UserAdminResponseDto = try await api.get("users/me")
        return UserSummary(id: me.id, name: me.name, email: me.email)
    }

    // MARK: Timeline

    func timelineBuckets(_ query: TimelineQuery) async throws -> [TimeBucketsResponseDto] {
        try await api.get("timeline/buckets", query: query.queryItems)
    }

    func timelineBucket(_ query: TimelineQuery, bucket: String) async throws -> [Asset] {
        let dto: TimeBucketAssetResponseDto = try await api.get(
            "timeline/bucket", query: query.queryItems + [URLQueryItem(name: "timeBucket", value: bucket)])
        return Asset.rows(from: dto)
    }

    func assetDetail(id: String) async throws -> AssetDetail {
        let dto: AssetResponseDto = try await api.get("assets/\(id)")
        return AssetDetail(
            asset: Asset(dto: dto),
            fileName: dto.originalFileName,
            mimeType: dto.originalMimeType,
            exif: dto.exifInfo,
            people: (dto.people ?? []).filter { !$0.isHidden && !$0.name.isEmpty }
                .map { Person(id: $0.id, name: $0.name, isFavorite: $0.isFavorite ?? false) })
    }

    // MARK: Collections

    func albums() async throws -> [Album] {
        let dtos: [AlbumResponseDto] = try await api.get("albums")
        return dtos.map {
            Album(id: $0.id, name: $0.albumName, thumbnailAssetId: $0.albumThumbnailAssetId,
                  assetCount: $0.assetCount, shared: $0.shared,
                  startDate: $0.startDate.flatMap(DateParsing.date))
        }
        .sorted { ($0.startDate ?? .distantPast) > ($1.startDate ?? .distantPast) }
    }

    func people() async throws -> [Person] {
        let dto: PeopleResponseDto = try await api.get("people", query: [.init(name: "size", value: "500")])
        return dto.people.filter { !$0.isHidden }.map {
            Person(id: $0.id, name: $0.name, isFavorite: $0.isFavorite ?? false)
        }
    }

    func memories(on day: Date) async throws -> [Memory] {
        let dtos: [MemoryResponseDto] = try await api.get("memories", query: [.init(name: "for", value: DateParsing.day(day))])
        return dtos.compactMap { m in
            let assets = m.assets.map(Asset.init(dto:))
            guard !assets.isEmpty else { return nil }
            let title = if m.type == "birthday", let name = m.data.personName {
                "\(name)'s Birthday"
            } else {
                "On This Day"
            }
            return Memory(id: m.id, year: m.data.year, title: title, assets: assets)
        }
    }

    func mapMarkers() async throws -> [MapMarker] {
        let dtos: [MapMarkerResponseDto] = try await api.get("map/markers")
        return dtos.map { MapMarker(id: $0.id, latitude: $0.lat, longitude: $0.lon, city: $0.city) }
    }

    func places() async throws -> [Place] {
        let explore: [SearchExploreResponseDto] = try await api.get("search/explore")
        let cities = explore.first { $0.fieldName == "exifInfo.city" }?.items ?? []
        return cities.map { Place(name: $0.value, asset: Asset(dto: $0.data)) }
    }

    // MARK: Search

    /// Sentence search through memories-search when the server has it, else Immich's own smart
    /// search. Always via the public URL: the LAN address is Immich itself, without it.
    func smartSearch(_ text: String, page: Int) async throws -> SearchPage {
        if sentenceSearch.withLock({ $0 }), let base = api.endpoints.current.publicAPI {
            var req = URLRequest(url: base.appending(path: "memories/search"))
            req.httpMethod = "POST"
            for (k, v) in api.authHeaders { req.setValue(v, forHTTPHeaderField: k) }
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.httpBody = try APIClient.encoder.encode(SentenceSearchRequestDto(query: text, page: page))
            req.timeoutInterval = 40
            do {
                let data = try await api.perform(req)
                let res = try JSONDecoder().decode(SentenceSearchResponseDto.self, from: data)
                let info = res.memories.map {
                    SearchInterpretation(
                        people: $0.people ?? [], missingPeople: $0.missingPeople ?? [], visual: $0.visual ?? "",
                        place: $0.place?.last, when: $0.when ?? "", media: $0.media ?? "any",
                        favorite: $0.favorite ?? false, fallback: $0.fallback ?? false)
                }
                return SearchPage(assets: res.assets.items.map(Asset.init(dto:)),
                                  nextPage: res.assets.nextPage.flatMap(Int.init), interpretation: info)
            } catch APIError.unauthorized {
                throw APIError.unauthorized
            } catch APIError.http(404, _) {
                sentenceSearch.withLock { $0 = false }
            } catch {
                // Public URL unreachable or the service is down: Immich's own search below.
            }
        }
        let dto = SmartSearchDto(query: text, size: 100, page: page, withExif: false)
        let res: SearchResponseDto = try await api.send("POST", "search/smart", body: dto)
        return SearchPage(assets: res.assets.items.map(Asset.init(dto:)), nextPage: res.assets.nextPage.flatMap(Int.init))
    }

    func metadataSearch(_ query: MetadataQuery, page: Int) async throws -> SearchPage {
        var dto = MetadataSearchDto(size: 250, page: page)
        switch query {
        case .videos: dto.type = .video; dto.visibility = "timeline"
        case .livePhotos: dto.isMotion = true; dto.visibility = "timeline"
        case .recentlyAdded: dto.visibility = "timeline"; dto.order = "desc"
        }
        let res: SearchResponseDto = try await api.send("POST", "search/metadata", body: dto)
        return SearchPage(assets: res.assets.items.map(Asset.init(dto:)), nextPage: res.assets.nextPage.flatMap(Int.init))
    }

    // MARK: Mutations

    func updatePerson(_ id: String, name: String?, isHidden: Bool?, isFavorite: Bool?) async throws {
        let _: PersonResponseDto = try await api.send("PUT", "people/\(id)",
                                                     body: PersonUpdateDto(name: name, isHidden: isHidden, isFavorite: isFavorite))
    }

    func mergePeople(into target: String, from sources: [String]) async throws {
        let res: [BulkIdResponseDto] = try await api.send("POST", "people/\(target)/merge", body: MergePersonDto(ids: sources))
        if let failed = res.first(where: { !$0.success }) {
            throw APIError.http(400, "Couldn't merge: \(failed.error ?? "unknown error")")
        }
    }

    func setFavorite(_ ids: [String], _ value: Bool) async throws {
        try await api.sendNoContent("PUT", "assets", body: AssetBulkUpdateDto(ids: ids, isFavorite: value))
    }

    func trash(_ ids: [String]) async throws {
        try await api.sendNoContent("DELETE", "assets", body: AssetBulkDeleteDto(ids: ids, force: false))
    }

    func restore(_ ids: [String]) async throws {
        let _: TrashResponseDto = try await api.send("POST", "trash/restore/assets", body: BulkIdsDto(ids: ids))
    }

    // MARK: Media

    func image(_ request: ImageRequest) async throws -> ImagePayload {
        let path: String
        var query: [URLQueryItem] = []
        switch request.kind {
        case .person:
            path = "people/\(request.id)/thumbnail"
        case .thumbnail, .preview, .fullsize:
            path = "assets/\(request.id)/thumbnail"
            query.append(.init(name: "size", value: request.kind.rawValue))
            if let c = request.thumbhash { query.append(.init(name: "c", value: c)) }
        }
        return .data(try await api.data(path, query: query))
    }

    func playback(for assetId: String) -> PlaybackSource? {
        guard let url = try? api.url("assets/\(assetId)/video/playback") else { return nil }
        return PlaybackSource(url: url, headers: api.authHeaders)
    }

    func downloadOriginal(_ asset: Asset) async throws -> URL {
        let detail = try await assetDetail(id: asset.id)
        let req = try api.request("GET", "assets/\(asset.id)/original")
        let (tmp, resp) = try await api.session.download(for: req)
        try api.check(resp, Data())
        let dir = FileManager.default.temporaryDirectory.appending(path: "share/\(asset.id)", directoryHint: .isDirectory)
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appending(path: detail.fileName)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }
}
