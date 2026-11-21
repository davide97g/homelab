import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

/// ShareLink payload: the original file is downloaded only when the user picks a destination.
struct SharedOriginal: Transferable {
    let asset: Asset
    let service: any MediaService

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .movie) { item in
            SentTransferredFile(try await item.service.downloadOriginal(item.asset))
        }
        .exportingCondition { $0.asset.isVideo }
        FileRepresentation(exportedContentType: .image) { item in
            SentTransferredFile(try await item.service.downloadOriginal(item.asset))
        }
        .exportingCondition { $0.asset.isImage }
    }
}
