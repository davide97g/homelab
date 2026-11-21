import SwiftUI
import UIKit

/// One photo page: UIScrollView zoom (pinch + double-tap), single tap toggles chrome,
/// long-press reports live-photo playback. Shows the cached grid thumbnail instantly, then the
/// preview-size rendition.
struct ZoomableImageView: UIViewRepresentable {
    let asset: Asset
    let pipeline: ImagePipeline
    let isCurrent: Bool
    var onTap: () -> Void
    var onZoomChange: (Bool) -> Void
    var onLongPress: (Bool) -> Void

    func makeUIView(context: Context) -> ZoomingScrollView {
        let v = ZoomingScrollView()
        v.onTap = onTap
        v.onZoomChange = onZoomChange
        v.onLongPress = onLongPress
        v.show(asset: asset, pipeline: pipeline)
        return v
    }

    func updateUIView(_ v: ZoomingScrollView, context: Context) {
        v.onTap = onTap
        v.onZoomChange = onZoomChange
        v.onLongPress = onLongPress
        if v.assetID != asset.id { v.show(asset: asset, pipeline: pipeline) }
        if !isCurrent, v.zoomScale != v.minimumZoomScale { v.setZoomScale(v.minimumZoomScale, animated: false) }
    }

    static func dismantleUIView(_ v: ZoomingScrollView, coordinator: ()) { v.cancel() }
}

final class ZoomingScrollView: UIScrollView, UIScrollViewDelegate {
    let imageView = UIImageView()
    var onTap: () -> Void = {}
    var onZoomChange: (Bool) -> Void = { _ in }
    var onLongPress: (Bool) -> Void = { _ in }
    private(set) var assetID: String?
    private var task: Task<Void, Never>?
    private var imageSize: CGSize = .zero
    private var wasZoomed = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        decelerationRate = .fast
        contentInsetAdjustmentBehavior = .never
        bouncesZoom = true
        minimumZoomScale = 1
        maximumZoomScale = 4
        backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        addSubview(imageView)

        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        double.numberOfTapsRequired = 2
        addGestureRecognizer(double)
        let single = UITapGestureRecognizer(target: self, action: #selector(singleTap))
        single.require(toFail: double)
        addGestureRecognizer(single)
        let long = UILongPressGestureRecognizer(target: self, action: #selector(longPress(_:)))
        long.minimumPressDuration = 0.25
        addGestureRecognizer(long)
    }

    required init?(coder: NSCoder) { fatalError() }

    func cancel() { task?.cancel() }

    func show(asset: Asset, pipeline: ImagePipeline) {
        task?.cancel()
        assetID = asset.id
        zoomScale = 1
        let thumb = ImageRequest(id: asset.id, kind: .thumbnail, thumbhash: asset.thumbhash)
        let preview = ImageRequest(id: asset.id, kind: .preview, thumbhash: asset.thumbhash)
        imageSize = CGSize(width: 1000 * asset.ratio, height: 1000)
        setImage(pipeline.cached(preview) ?? pipeline.cached(thumb) ?? pipeline.placeholder(thumbhash: asset.thumbhash))
        guard pipeline.cached(preview) == nil else { return }
        let id = asset.id
        task = Task { [weak self] in
            if pipeline.cached(thumb) == nil, let t = await pipeline.image(thumb), self?.assetID == id,
               self?.imageView.image?.size.width ?? 0 < t.size.width {
                self?.setImage(t)
            }
            guard let full = await pipeline.image(preview), !Task.isCancelled, self?.assetID == id else { return }
            self?.setImage(full)
        }
    }

    private func setImage(_ image: UIImage?) {
        imageView.image = image
        layoutImage()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if zoomScale == minimumZoomScale { layoutImage() }
    }

    private func layoutImage() {
        guard bounds.width > 0, bounds.height > 0 else { return }
        let size = imageSize.width > 0 ? imageSize : (imageView.image?.size ?? bounds.size)
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let fitted = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let z = zoomScale
        if z == 1 {
            imageView.frame = CGRect(origin: .zero, size: fitted)
            contentSize = fitted
        }
        center()
    }

    private func center() {
        let w = imageView.frame.width, h = imageView.frame.height
        let insetX = max(0, (bounds.width - w) / 2)
        let insetY = max(0, (bounds.height - h) / 2)
        contentInset = UIEdgeInsets(top: insetY, left: insetX, bottom: insetY, right: insetX)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        center()
        let zoomed = zoomScale > minimumZoomScale + 0.01
        if zoomed != wasZoomed {
            wasZoomed = zoomed
            onZoomChange(zoomed)
        }
    }

    @objc private func singleTap() { onTap() }

    @objc private func doubleTap(_ g: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale {
            setZoomScale(minimumZoomScale, animated: true)
        } else {
            let p = g.location(in: imageView)
            let target: CGFloat = 2.5
            let size = CGSize(width: bounds.width / target, height: bounds.height / target)
            zoom(to: CGRect(x: p.x - size.width / 2, y: p.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }

    @objc private func longPress(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began: onLongPress(true)
        case .ended, .cancelled, .failed: onLongPress(false)
        default: break
        }
    }
}
