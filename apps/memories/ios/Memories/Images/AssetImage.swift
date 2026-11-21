import SwiftUI

/// SwiftUI image for cards, avatars and chips: thumbhash placeholder, then the requested size.
struct AssetImage: View {
    let request: ImageRequest?
    var contentMode: ContentMode = .fill
    @Environment(AppModel.self) private var app
    @State private var image: UIImage?
    @State private var loadedKey: String?

    init(_ asset: Asset?, kind: ImageRequest.Kind = .thumbnail, contentMode: ContentMode = .fill) {
        request = asset.map { ImageRequest(id: $0.id, kind: kind, thumbhash: $0.thumbhash) }
        self.contentMode = contentMode
    }

    init(assetID: String?, kind: ImageRequest.Kind = .thumbnail, contentMode: ContentMode = .fill) {
        request = assetID.map { ImageRequest(id: $0, kind: kind, thumbhash: nil) }
        self.contentMode = contentMode
    }

    init(personID: String) {
        request = ImageRequest(id: personID, kind: .person)
        contentMode = .fill
    }

    var body: some View {
        // Fills the proposed size and crops, like a grid cell.
        Color(Theme.placeholder)
            .overlay {
                if let shown = displayImage {
                    Image(uiImage: shown)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .transition(.opacity)
                }
            }
            .clipped()
            .task(id: request?.cacheKey) {
                guard let request else { return }
                if let hit = app.pipeline.cached(request) {
                    image = hit; loadedKey = request.cacheKey
                    return
                }
                if let img = await app.pipeline.image(request) {
                    withAnimation(.easeOut(duration: 0.2)) { image = img; loadedKey = request.cacheKey }
                }
            }
    }

    private var displayImage: UIImage? {
        if let image, loadedKey == request?.cacheKey { return image }
        if let request, let hit = app.pipeline.cached(request) { return hit }
        return app.pipeline.placeholder(thumbhash: request?.thumbhash)
    }
}
