import Foundation
import Testing
@testable import Memories

/// Payload shapes follow apps/memories/spec/immich-openapi-v3.4.0.json.
struct DTODecodingTests {
    func decode<T: Decodable>(_ t: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test func serverVersion() throws {
        // Real response from the public server (unauthenticated endpoint).
        let v = try decode(ServerVersionResponseDto.self, #"{"major":3,"minor":4,"patch":0,"prerelease":null,"featureLevel":2}"#)
        #expect(v == ServerVersionResponseDto(major: 3, minor: 4, patch: 0, prerelease: nil, featureLevel: 2))
    }

    @Test func wellKnown() throws {
        let wk = try decode(WellKnownDto.self, #"{"api":{"endpoint":"/api"}}"#)
        let server = URL(string: "https://memories.davideghiotto.it/immich")!
        #expect(ServerEndpoints.resolve(endpoint: wk.api.endpoint, against: server).absoluteString
                == "https://memories.davideghiotto.it/immich/api")
    }

    @Test func columnarBucket() throws {
        let json = """
        {"id":["a","b"],"ownerId":["o","o"],"ratio":[1.3333,0.75],"thumbhash":["HAkOHZxwd3dweHiIiHiHeHRwCPd4",null],
         "fileCreatedAt":["2024-05-12T16:42:00.000Z","2024-05-13T08:00:00.000Z"],"createdAt":["2024-05-12T16:42:00.000Z","2024-05-13T08:00:00.000Z"],
         "localOffsetHours":[2,-5.5],"isImage":[true,false],"duration":[null,12500],"isFavorite":[false,true],"isTrashed":[false,false],
         "livePhotoVideoId":["v1",null],"city":["Milan",null],"country":["Italy",null],"latitude":[45.46,null],"longitude":[9.19,null],
         "projectionType":[null,null],"stack":[null,["s1","3"]],"visibility":["timeline","timeline"]}
        """
        let dto = try decode(TimeBucketAssetResponseDto.self, json)
        let rows = Asset.rows(from: dto)
        #expect(rows.count == 2)
        #expect(rows[0].isLivePhoto)
        #expect(rows[0].place == "Milan, Italy")
        #expect(rows[1].isVideo)
        #expect(rows[1].durationText == "0:13")
        #expect(rows[1].localOffsetHours == -5.5)
        let cal = DateFormatting.gmtCalendar
        #expect(cal.component(.hour, from: rows[0].localDate) == 18)
    }

    @Test func columnarBucketWithoutOptionalColumns() throws {
        let json = """
        {"id":["a"],"ownerId":["o"],"ratio":[1],"thumbhash":[null],"fileCreatedAt":["2024-05-12T16:42:00Z"],"createdAt":["2024-05-12T16:42:00Z"],
         "localOffsetHours":[0],"isImage":[true],"duration":[null],"isFavorite":[false],"isTrashed":[false],"livePhotoVideoId":[null],
         "projectionType":[null],"visibility":["timeline"]}
        """
        let rows = Asset.rows(from: try decode(TimeBucketAssetResponseDto.self, json))
        #expect(rows.first?.city == nil)
        #expect(rows.first?.fileCreatedAt != .distantPast)
    }

    @Test func buckets() throws {
        let b = try decode([TimeBucketsResponseDto].self, #"[{"timeBucket":"2024-05-01","count":42}]"#)
        #expect(b == [TimeBucketsResponseDto(count: 42, timeBucket: "2024-05-01")])
        #expect(DateParsing.date("2024-05-01") != nil)
    }

    static let assetJSON = """
    {"id":"x","type":"VIDEO","originalFileName":"IMG_1.MOV","originalMimeType":"video/quicktime","originalPath":"/p",
     "fileCreatedAt":"2023-08-01T10:00:00.000Z","fileModifiedAt":"2023-08-01T10:00:00.000Z","localDateTime":"2023-08-01T12:00:00.000Z",
     "createdAt":"2023-08-01T10:00:00.000Z","updatedAt":"2023-08-01T10:00:00.000Z","ownerId":"o","checksum":"abc=",
     "isFavorite":true,"isTrashed":false,"isArchived":false,"isOffline":false,"isEdited":false,"hasMetadata":true,"visibility":"timeline",
     "thumbhash":null,"duration":61000,"width":1920,"height":1080,"livePhotoVideoId":null,
     "exifInfo":{"city":"Camogli","country":"Italy","make":"Apple","model":"iPhone","fNumber":1.8,"iso":100,"exifImageWidth":1920,"exifImageHeight":1080,"latitude":44.3,"longitude":9.1},
     "people":[{"id":"p","name":"Giulia","birthDate":null,"isHidden":false,"thumbnailPath":"/t","otherPeople":[],"sharedBy":[],"sharedWith":[]}]}
    """

    @Test func assetResponse() throws {
        let dto = try decode(AssetResponseDto.self, Self.assetJSON)
        let a = Asset(dto: dto)
        #expect(a.isVideo)
        #expect(a.durationText == "1:01")
        #expect(abs(a.ratio - 16.0 / 9.0) < 0.001)
        #expect(a.localOffsetHours == 2)
        #expect(dto.people?.first?.name == "Giulia")
    }

    @Test func smartSearchResponse() throws {
        let json = #"{"albums":{"count":0,"total":0,"items":[],"facets":[]},"assets":{"count":1,"total":1,"items":[\#(Self.assetJSON)],"facets":[],"nextPage":"2","nextCursor":null}}"#
        let res = try decode(SearchResponseDto.self, json)
        #expect(res.assets.items.count == 1)
        #expect(res.assets.nextPage == "2")
    }

    @Test func memories() throws {
        let json = #"[{"id":"m","type":"on_this_day","data":{"year":2021},"assets":[\#(Self.assetJSON)],"memoryAt":"2021-11-10T00:00:00.000Z","isSaved":false,"createdAt":"x","updatedAt":"x","ownerId":"o"}]"#
        let res = try decode([MemoryResponseDto].self, json)
        #expect(res.first?.data.year == 2021)
    }

    /// memories-search: Immich's response plus `memories` (null fields from a fallback too).
    @Test func sentenceSearch() throws {
        let json = #"{"assets":{"count":0,"total":0,"items":[],"nextPage":"2","nextCursor":null},"memories":{"query":"q","model":"qwen3:4b","seconds":3.1,"fallback":false,"people":["marci"],"personIds":["p1"],"missingPeople":[],"visual":"eating","place":["city","Rome"],"media":"any","favorite":false,"when":"06/2022","takenAfter":"2022-06-01T00:00:00.000Z","takenBefore":null,"endpoint":"smart"}}"#
        let res = try JSONDecoder().decode(SentenceSearchResponseDto.self, from: Data(json.utf8))
        #expect(res.assets.nextPage == "2")
        #expect(res.memories?.people == ["marci"])
        #expect(res.memories?.place?.last == "Rome")
        let plain = try JSONDecoder().decode(SentenceSearchResponseDto.self, from: Data(#"{"assets":{"count":0,"total":0,"items":[],"nextPage":null,"nextCursor":null}}"#.utf8))
        #expect(plain.memories == nil)
    }

    @Test func uploadCheck() throws {
        let json = #"{"results":[{"id":"L|single","action":"reject","reason":"duplicate","assetId":"srv","isTrashed":false},{"id":"M|single","action":"accept"}]}"#
        let res = try decode(AssetBulkUploadCheckResponseDto.self, json)
        #expect(res.results[0].assetId == "srv")
        #expect(res.results[1].reason == nil)
    }

    @Test func loginAndUser() throws {
        let login = try decode(LoginResponseDto.self, #"{"accessToken":"t","isAdmin":false,"isOnboarded":true,"name":"D","profileImagePath":"","shouldChangePassword":false,"userEmail":"d@x","userId":"u"}"#)
        #expect(login.accessToken == "t")
    }

    @Test func errorMessages() {
        #expect(APIClient.message(from: Data(#"{"message":["email must be an email"],"error":"Bad Request","statusCode":400}"#.utf8)) == "email must be an email")
        #expect(APIClient.message(from: Data(#"{"message":"Incorrect email or password","statusCode":401}"#.utf8)) == "Incorrect email or password")
    }
}
