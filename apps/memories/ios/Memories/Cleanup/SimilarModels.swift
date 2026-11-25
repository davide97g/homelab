import Foundation

/// One photo in a set of similar ones.
struct SimilarItem: Identifiable, Hashable, Sendable {
    let asset: Asset
    let bytes: Int64?
    let width: Int?
    let height: Int?
    /// Immich's suggestion of which to keep (bigger file, richer EXIF).
    let isSuggested: Bool
    var id: String { asset.id }
}

/// A set Immich's duplicate detection grouped together. `items` starts with the suggested keepers.
struct SimilarGroup: Identifiable, Hashable, Sendable {
    let id: String
    var items: [SimilarItem]

    var newest: Date { items.map(\.asset.fileCreatedAt).max() ?? .distantPast }
}

extension SimilarGroup {
    /// nil for a group that no longer has two live assets (one was deleted elsewhere).
    init?(dto: DuplicateResponseDto) {
        let suggested = Set(dto.suggestedKeepAssetIds ?? [])
        let items = dto.assets
            .filter { !$0.isTrashed }
            .map { a in
                SimilarItem(asset: Asset(dto: a), bytes: a.exifInfo?.fileSizeInByte,
                            width: a.exifInfo?.exifImageWidth ?? a.width,
                            height: a.exifInfo?.exifImageHeight ?? a.height,
                            isSuggested: suggested.contains(a.id))
            }
            .sorted { l, r in
                if l.isSuggested != r.isSuggested { return l.isSuggested }
                if (l.bytes ?? 0) != (r.bytes ?? 0) { return (l.bytes ?? 0) > (r.bytes ?? 0) }
                return l.asset.fileCreatedAt < r.asset.fileCreatedAt
            }
        guard items.count >= 2 else { return nil }
        self.init(id: dto.duplicateId, items: items)
    }
}
