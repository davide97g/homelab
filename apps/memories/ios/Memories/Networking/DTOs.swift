import Foundation

// Codable mirrors of the Immich v3.4.0 OpenAPI schemas (apps/memories/spec/immich-openapi-v3.4.0.json).
// Only the fields the app reads are declared; optional where the spec says nullable or not required.

struct ServerVersionResponseDto: Codable, Sendable, Equatable {
    let major: Int
    let minor: Int
    let patch: Int
    let prerelease: Int?
    let featureLevel: Int?
}

struct WellKnownDto: Codable, Sendable {
    struct API: Codable, Sendable { let endpoint: String }
    let api: API
}

struct LoginCredentialDto: Codable, Sendable {
    let email: String
    let password: String
}

struct LoginResponseDto: Codable, Sendable {
    let accessToken: String
    let isAdmin: Bool
    let isOnboarded: Bool
    let name: String
    let profileImagePath: String
    let shouldChangePassword: Bool
    let userEmail: String
    let userId: String
}

struct UserAdminResponseDto: Codable, Sendable {
    let id: String
    let email: String
    let name: String
    let profileImagePath: String
    let avatarColor: String?
    let quotaSizeInBytes: Int64?
    let quotaUsageInBytes: Int64?
}

struct TimeBucketsResponseDto: Codable, Sendable, Equatable {
    let count: Int
    let timeBucket: String
}

/// `GET /timeline/bucket` is columnar in v3: one array per field, all the same length.
struct TimeBucketAssetResponseDto: Codable, Sendable {
    let id: [String]
    let ratio: [Double]
    let thumbhash: [String?]
    let fileCreatedAt: [String]
    let localOffsetHours: [Double]
    let isImage: [Bool]
    let duration: [Int?]
    let isFavorite: [Bool]
    let isTrashed: [Bool]
    let livePhotoVideoId: [String?]
    let city: [String?]?
    let country: [String?]?
    let latitude: [Double?]?
    let longitude: [Double?]?
    let stack: [[String]?]?
    let visibility: [String]
}

enum AssetTypeEnum: String, Codable, Sendable {
    case image = "IMAGE", video = "VIDEO", audio = "AUDIO", other = "OTHER"
}

struct ExifResponseDto: Codable, Sendable, Hashable {
    var city: String?
    var country: String?
    var state: String?
    var dateTimeOriginal: String?
    var description: String?
    var exifImageHeight: Int?
    var exifImageWidth: Int?
    var exposureTime: String?
    var fNumber: Double?
    var fileSizeInByte: Int64?
    var focalLength: Double?
    var iso: Int?
    var latitude: Double?
    var longitude: Double?
    var lensModel: String?
    var make: String?
    var model: String?
    var timeZone: String?
}

struct PersonResponseDto: Codable, Sendable, Hashable {
    let id: String
    let name: String
    let birthDate: String?
    let isHidden: Bool
    let isFavorite: Bool?
    let thumbnailPath: String
}

struct PeopleResponseDto: Codable, Sendable {
    let people: [PersonResponseDto]
    let total: Int
    let hidden: Int
    let hasNextPage: Bool?
}

struct AssetResponseDto: Codable, Sendable {
    let id: String
    let type: AssetTypeEnum
    let originalFileName: String
    let originalMimeType: String?
    let fileCreatedAt: String
    let fileModifiedAt: String
    let localDateTime: String
    let isFavorite: Bool
    let isTrashed: Bool
    let isArchived: Bool
    let thumbhash: String?
    let duration: Int?
    let width: Int?
    let height: Int?
    let livePhotoVideoId: String?
    let exifInfo: ExifResponseDto?
    let people: [PersonResponseDto]?
    let checksum: String
    /// External-library file missing on disk.
    var isOffline: Bool? = nil
}

struct AlbumResponseDto: Codable, Sendable {
    let id: String
    let albumName: String
    let albumThumbnailAssetId: String?
    let assetCount: Int
    let description: String?
    let shared: Bool
    let startDate: String?
    let endDate: String?
}

struct MemoryDataDto: Codable, Sendable {
    let year: Int
    let personId: String?
    let personName: String?
}

struct MemoryResponseDto: Codable, Sendable {
    let id: String
    let type: String
    let data: MemoryDataDto
    let assets: [AssetResponseDto]
    let memoryAt: String
    let isSaved: Bool
}

struct MapMarkerResponseDto: Codable, Sendable {
    let id: String
    let lat: Double
    let lon: Double
    let city: String?
    let country: String?
    let state: String?
}

struct SearchExploreItem: Codable, Sendable {
    let value: String
    let data: AssetResponseDto
}

struct SearchExploreResponseDto: Codable, Sendable {
    let fieldName: String
    let items: [SearchExploreItem]
}

struct SmartSearchDto: Codable, Sendable {
    var query: String
    var size: Int = 100
    var page: Int?
    var withExif: Bool = false
}

struct MetadataSearchDto: Codable, Sendable {
    var type: AssetTypeEnum?
    var isMotion: Bool?
    var isFavorite: Bool?
    var visibility: String?
    var withDeleted: Bool?
    var trashedAfter: String?
    var size: Int = 250
    var page: Int?
    var order: String?
}

struct SearchAssetResponseDto: Codable, Sendable {
    let count: Int
    let total: Int
    let items: [AssetResponseDto]
    let nextPage: String?
    let nextCursor: String?
}

struct SearchResponseDto: Codable, Sendable {
    let assets: SearchAssetResponseDto
}

struct AssetBulkUpdateDto: Codable, Sendable {
    let ids: [String]
    var isFavorite: Bool?
}

struct AssetBulkDeleteDto: Codable, Sendable {
    let ids: [String]
    var force: Bool = false
}

struct BulkIdsDto: Codable, Sendable {
    let ids: [String]
}

struct TrashResponseDto: Codable, Sendable {
    let count: Int
}

struct AssetBulkUploadCheckItem: Codable, Sendable, Equatable {
    /// Client-side id echoed back (we use the PhotoKit local identifier + part).
    let id: String
    /// Base64 or hex SHA-1.
    let checksum: String
}

struct AssetBulkUploadCheckDto: Codable, Sendable {
    let assets: [AssetBulkUploadCheckItem]
}

struct AssetBulkUploadCheckResult: Codable, Sendable, Equatable {
    /// `accept` / `reject`
    let action: String
    let id: String
    let assetId: String?
    let isTrashed: Bool?
    /// `duplicate` / `unsupported-format`
    let reason: String?
}

struct AssetBulkUploadCheckResponseDto: Codable, Sendable {
    let results: [AssetBulkUploadCheckResult]
}

struct AssetMediaResponseDto: Codable, Sendable, Equatable {
    let id: String
    /// `created` / `duplicate`
    let status: String
}

struct ErrorResponseDto: Codable, Sendable {
    let message: String?
    let error: String?
    let statusCode: Int?
}
