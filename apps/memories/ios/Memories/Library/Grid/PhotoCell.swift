import UIKit

/// Grid cell: aspect-fill thumbnail over the placeholder color, thumbhash first, fade to the
/// real thumbnail. Badges: video duration (bottom-right), favorite heart (bottom-left),
/// selection check (bottom-right, replaces the duration while selecting).
final class PhotoCell: UICollectionViewCell {
    static let reuseID = "PhotoCell"

    let imageView = UIImageView()
    private let durationLabel = UILabel()
    private let heart = UIImageView(image: UIImage(systemName: "heart.fill"))
    private let check = UIImageView()
    private let dim = UIView()
    private var loadTask: Task<Void, Never>?
    private(set) var assetID: String?
    private var showsHeart = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = Theme.placeholderUIColor
        contentView.clipsToBounds = true

        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.frame = contentView.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        contentView.addSubview(imageView)

        dim.backgroundColor = UIColor.white.withAlphaComponent(0.25)
        dim.frame = contentView.bounds
        dim.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dim.isHidden = true
        contentView.addSubview(dim)

        durationLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        durationLabel.textColor = .white
        durationLabel.layer.shadowColor = UIColor.black.cgColor
        durationLabel.layer.shadowOpacity = 0.6
        durationLabel.layer.shadowRadius = 2
        durationLabel.layer.shadowOffset = .zero
        contentView.addSubview(durationLabel)

        heart.tintColor = .white
        heart.contentMode = .scaleAspectFit
        heart.layer.shadowColor = UIColor.black.cgColor
        heart.layer.shadowOpacity = 0.6
        heart.layer.shadowRadius = 2
        heart.layer.shadowOffset = .zero
        contentView.addSubview(heart)

        let config = UIImage.SymbolConfiguration(paletteColors: [.white, .systemBlue])
        check.image = UIImage(systemName: "checkmark.circle.fill", withConfiguration: config)
        check.layer.shadowColor = UIColor.black.cgColor
        check.layer.shadowOpacity = 0.3
        check.layer.shadowRadius = 2
        check.layer.shadowOffset = .zero
        contentView.addSubview(check)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let b = contentView.bounds
        let small = b.width < 44
        durationLabel.isHidden = durationLabel.text == nil || small || !check.isHidden
        heart.isHidden = !showsHeart || small
        durationLabel.sizeToFit()
        durationLabel.frame.origin = CGPoint(x: b.maxX - durationLabel.bounds.width - 5, y: b.maxY - durationLabel.bounds.height - 4)
        let hs: CGFloat = 12
        heart.frame = CGRect(x: 5, y: b.maxY - hs - 5, width: hs, height: hs)
        let cs: CGFloat = min(24, b.width * 0.3)
        check.frame = CGRect(x: b.maxX - cs - 4, y: b.maxY - cs - 4, width: cs, height: cs)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        loadTask?.cancel()
        loadTask = nil
        assetID = nil
        imageView.image = nil
        imageView.alpha = 1
    }

    func configure(asset: Asset?, pipeline: ImagePipeline, selecting: Bool, selected: Bool) {
        check.isHidden = !(selecting && selected)
        dim.isHidden = !(selecting && selected)
        guard let asset else {
            assetID = nil
            imageView.image = nil
            durationLabel.text = nil
            showsHeart = false
            setNeedsLayout()
            return
        }
        durationLabel.text = asset.isVideo ? (asset.durationText ?? "0:00") : nil
        showsHeart = asset.isFavorite
        setNeedsLayout()
        accessibilityLabel = asset.isVideo ? "Video" : "Photo"

        // Same asset re-configured (favorite toggled, selection): keep the image.
        if assetID == asset.id, imageView.image != nil, loadTask == nil { return }
        assetID = asset.id
        loadTask?.cancel()

        let request = ImageRequest(id: asset.id, kind: .thumbnail, thumbhash: asset.thumbhash)
        if let hit = pipeline.cached(request) {
            imageView.image = hit
            loadTask = nil
            return
        }
        imageView.image = pipeline.placeholder(thumbhash: asset.thumbhash)
        let id = asset.id
        loadTask = Task { [weak self] in
            let img = await pipeline.image(request)
            guard let self, !Task.isCancelled, self.assetID == id, let img else { return }
            UIView.transition(with: self.imageView, duration: 0.2, options: [.transitionCrossDissolve, .allowUserInteraction]) {
                self.imageView.image = img
            }
            self.loadTask = nil
        }
    }
}
