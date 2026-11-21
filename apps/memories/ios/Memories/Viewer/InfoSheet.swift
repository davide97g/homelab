import MapKit
import SwiftUI

/// Swipe-up info: caption, date, camera/lens/exposure, people, mini map.
struct InfoSheet: View {
    let asset: Asset
    let model: ViewerModel

    var body: some View {
        let detail = model.detail(for: asset)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let caption = detail?.description {
                    Text(caption).font(.body)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(DateFormatting.weekdayDate(asset.localDate))
                        .font(.headline)
                    Text(DateFormatting.time(asset.localDate) + (detail.map { " · \($0.fileName)" } ?? ""))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                cameraCard(detail)

                storageRow

                if let people = detail?.people, !people.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("People").font(.headline)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 14) {
                                ForEach(people) { p in
                                    VStack(spacing: 4) {
                                        AssetImage(personID: p.id)
                                            .frame(width: 56, height: 56)
                                            .clipShape(.circle)
                                        Text(p.name).font(.caption).lineLimit(1)
                                    }
                                    .frame(width: 64)
                                }
                            }
                        }
                    }
                }

                if let coord = asset.coordinate {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(asset.place ?? "Location").font(.headline)
                        Map(initialPosition: .region(MKCoordinateRegion(center: coord, latitudinalMeters: 3000, longitudinalMeters: 3000))) {
                            Annotation("", coordinate: coord) {
                                AssetImage(asset)
                                    .frame(width: 44, height: 44)
                                    .clipShape(.rect(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white, lineWidth: 2))
                                    .shadow(radius: 3)
                            }
                        }
                        .mapStyle(.standard(pointsOfInterest: .excludingAll))
                        .frame(height: 190)
                        .clipShape(.rect(cornerRadius: Theme.Radius.card))
                        .allowsHitTesting(false)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: asset.id) { await model.loadDetail(for: asset) }
    }

    private var storageRow: some View {
        let app = model.app
        let onDevice = app.spaceSaver.isOnDevice(asset.id)
        let saving = app.spaceSaver.saving.contains(asset.id)
        return HStack(spacing: 12) {
            Image(systemName: onDevice ? "iphone" : "externaldrive.connected.to.line.below")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(onDevice ? "On This iPhone and the Server" : "On the Server Only")
                    .font(.subheadline.weight(.semibold))
                Text(onDevice ? "Shown from the iPhone's copy." : "Downloaded when opened, kept in the cache.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if saving {
                ProgressView()
            } else if !onDevice {
                Button("Save") { app.saveToDevice([asset]) }
                    .buttonStyle(.glass)
                    .font(.subheadline.weight(.semibold))
            }
        }
        .padding(12)
        .background(Theme.card.opacity(0.6), in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator, lineWidth: 0.5))
    }

    @ViewBuilder
    private func cameraCard(_ detail: AssetDetail?) -> some View {
        let exif = detail?.exif
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text([exif?.make, exif?.model].compactMap { $0 }.joined(separator: " ").nonEmpty ?? "Unknown camera")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if let mime = detail?.mimeType {
                    Text(mime.split(separator: "/").last.map { String($0).uppercased() } ?? "")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.secondary.opacity(0.2), in: .rect(cornerRadius: 4))
                }
            }
            .padding(12)
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                if let lens = exif?.lensModel { Text(lens).font(.footnote) }
                Text(resolutionLine(exif)).font(.footnote).foregroundStyle(.secondary)
            }
            .padding(12)
            Divider()
            HStack {
                exifCell(exif?.iso.map { "ISO \($0)" })
                exifCell(exif?.focalLength.map { String(format: "%g mm", $0) })
                exifCell(exif?.fNumber.map { String(format: "ƒ%g", $0) })
                exifCell(exif?.exposureTime.map { "\($0) s" })
            }
            .padding(.vertical, 10)
        }
        .background(Theme.card.opacity(0.6), in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.separator, lineWidth: 0.5))
        .redacted(reason: detail == nil ? .placeholder : [])
    }

    private func exifCell(_ text: String?) -> some View {
        Text(text ?? "—")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
    }

    private func resolutionLine(_ exif: ExifResponseDto?) -> String {
        var parts: [String] = []
        if let w = exif?.exifImageWidth, let h = exif?.exifImageHeight {
            parts.append(String(format: "%.0f MP · %d × %d", Double(w * h) / 1_000_000, w, h))
        }
        if let size = exif?.fileSizeInByte {
            parts.append(ByteCountFormatter.string(fromByteCount: size, countStyle: .file))
        }
        return parts.joined(separator: " · ").nonEmpty ?? " "
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
