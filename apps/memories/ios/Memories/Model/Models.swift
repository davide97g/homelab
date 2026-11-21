import Foundation
import CoreLocation

/// One asset as the grid and viewer see it. Built from a timeline-bucket column, or from a
/// full `AssetResponseDto` (search, memories, explore).
struct Asset: Identifiable, Hashable, Sendable {
    let id: String
    var ratio: Double
    var thumbhash: String?
    var isImage: Bool
    /// Milliseconds; nil for stills.
    var durationMs: Int?
    var isFavorite: Bool
    var isTrashed: Bool = false
    var livePhotoVideoId: String?
    /// UTC instant.
    var fileCreatedAt: Date
    /// Hours east of UTC at capture time.
    var localOffsetHours: Double
    var city: String?
    var country: String?
    var latitude: Double?
    var longitude: Double?

    var isVideo: Bool { !isImage }
    var isLivePhoto: Bool { isImage && livePhotoVideoId != nil }

    /// Wall-clock capture time encoded as a GMT date; format it with `DateFormatting` (GMT).
    var localDate: Date { fileCreatedAt.addingTimeInterval(localOffsetHours * 3600) }

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var place: String? {
        switch (city, country) {
        case let (c?, k?): return "\(c), \(k)"
        case let (c?, nil): return c
        case let (nil, k?): return k
        default: return nil
        }
    }

    var durationText: String? {
        guard let durationMs, durationMs > 0 else { return nil }
        let total = Int((Double(durationMs) / 1000).rounded())
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

extension Asset {
    init(dto: AssetResponseDto) {
        let created = DateParsing.date(dto.fileCreatedAt) ?? .distantPast
        let local = DateParsing.date(dto.localDateTime) ?? created
        let w = Double(dto.exifInfo?.exifImageWidth ?? dto.width ?? 1)
        let h = Double(dto.exifInfo?.exifImageHeight ?? dto.height ?? 1)
        self.init(
            id: dto.id,
            ratio: h > 0 ? max(0.1, w / h) : 1,
            thumbhash: dto.thumbhash,
            isImage: dto.type != .video,
            durationMs: dto.duration,
            isFavorite: dto.isFavorite,
            isTrashed: dto.isTrashed,
            livePhotoVideoId: dto.livePhotoVideoId,
            fileCreatedAt: created,
            localOffsetHours: local.timeIntervalSince(created) / 3600,
            city: dto.exifInfo?.city,
            country: dto.exifInfo?.country,
            latitude: dto.exifInfo?.latitude,
            longitude: dto.exifInfo?.longitude)
    }

    /// Expands a columnar bucket into rows. Columns shorter than `id` are treated as nil.
    static func rows(from b: TimeBucketAssetResponseDto) -> [Asset] {
        func at<T>(_ a: [T?]?, _ i: Int) -> T? { guard let a, i < a.count else { return nil }; return a[i] }
        func at<T>(_ a: [T], _ i: Int, _ d: T) -> T { i < a.count ? a[i] : d }
        return b.id.indices.map { i in
            Asset(
                id: b.id[i],
                ratio: at(b.ratio, i, 1),
                thumbhash: at(b.thumbhash, i),
                isImage: at(b.isImage, i, true),
                durationMs: at(b.duration, i),
                isFavorite: at(b.isFavorite, i, false),
                isTrashed: at(b.isTrashed, i, false),
                livePhotoVideoId: at(b.livePhotoVideoId, i),
                fileCreatedAt: DateParsing.date(at(b.fileCreatedAt, i, "")) ?? .distantPast,
                localOffsetHours: at(b.localOffsetHours, i, 0),
                city: at(b.city, i),
                country: at(b.country, i),
                latitude: at(b.latitude, i),
                longitude: at(b.longitude, i))
        }
    }
}

/// Detail for the info sheet.
struct AssetDetail: Sendable, Hashable {
    var asset: Asset
    var fileName: String
    var mimeType: String?
    var exif: ExifResponseDto?
    var people: [Person]
    var description: String? { exif?.description.flatMap { $0.isEmpty ? nil : $0 } }
}

struct Album: Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var thumbnailAssetId: String?
    var assetCount: Int
    var shared: Bool
    var startDate: Date?
}

struct Person: Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var isFavorite: Bool = false
}

struct Memory: Identifiable, Hashable, Sendable {
    let id: String
    var year: Int
    var title: String
    var assets: [Asset]
}

struct MapMarker: Identifiable, Hashable, Sendable {
    let id: String
    var latitude: Double
    var longitude: Double
    var city: String?
    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
}

struct Place: Identifiable, Hashable, Sendable {
    var id: String { name }
    var name: String
    var asset: Asset
}

struct UserSummary: Sendable, Hashable {
    var id: String
    var name: String
    var email: String
}

/// Which slice of the library a timeline shows.
enum TimelineQuery: Hashable, Sendable {
    case library
    case favorites
    case album(id: String)
    case person(id: String)
    case trash
    case archive

    var queryItems: [URLQueryItem] {
        var items = [URLQueryItem(name: "order", value: "asc")]
        switch self {
        case .library:
            items += [.init(name: "visibility", value: "timeline"), .init(name: "withStacked", value: "true")]
        case .favorites:
            items += [.init(name: "visibility", value: "timeline"), .init(name: "isFavorite", value: "true")]
        case .album(let id):
            items += [.init(name: "albumId", value: id)]
        case .person(let id):
            items += [.init(name: "visibility", value: "timeline"), .init(name: "personId", value: id)]
        case .trash:
            items += [.init(name: "isTrashed", value: "true")]
        case .archive:
            items += [.init(name: "visibility", value: "archive")]
        }
        return items
    }
}

/// Searches that are not timelines (media types, recently added).
enum MetadataQuery: Hashable, Sendable {
    case videos
    case livePhotos
    case recentlyAdded

    var title: String {
        switch self {
        case .videos: "Videos"
        case .livePhotos: "Live Photos"
        case .recentlyAdded: "Recently Saved"
        }
    }
}

struct SearchPage: Sendable {
    var assets: [Asset]
    var nextPage: Int?
}

enum DateParsing {
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    nonisolated(unsafe) private static let dayOnly: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
    private static let lock = NSLock()

    static func date(_ s: String) -> Date? {
        lock.lock(); defer { lock.unlock() }
        return fractional.date(from: s) ?? plain.date(from: s) ?? dayOnly.date(from: String(s.prefix(10)))
    }

    static func string(_ d: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return fractional.string(from: d)
    }

    static func day(_ d: Date) -> String {
        lock.lock(); defer { lock.unlock() }
        return dayOnly.string(from: d)
    }
}

/// Formatters that read `Asset.localDate` (wall clock stored as GMT).
enum DateFormatting {
    static var gmtCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "GMT")!
        return c
    }

    static func monthYear(_ d: Date) -> String {
        d.formatted(.dateTime.month(.wide).year().locale(.current).inTimeZone(.gmt))
    }

    static func year(_ d: Date) -> String {
        d.formatted(.dateTime.year().inTimeZone(.gmt))
    }

    static func dayMonthYear(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.wide).year().inTimeZone(.gmt))
    }

    static func time(_ d: Date) -> String {
        d.formatted(.dateTime.hour().minute().inTimeZone(.gmt))
    }

    static func weekdayDate(_ d: Date) -> String {
        d.formatted(.dateTime.weekday(.wide).day().month(.wide).year().inTimeZone(.gmt))
    }
}

extension Date.FormatStyle {
    func inTimeZone(_ tz: TimeZone) -> Date.FormatStyle {
        var s = self
        s.timeZone = tz
        return s
    }
}
