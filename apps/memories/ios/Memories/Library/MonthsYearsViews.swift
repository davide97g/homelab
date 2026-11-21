import SwiftUI

/// One card per month, newest at the bottom. Tapping jumps into All at that month.
struct MonthsView: View {
    let store: TimelineStore
    var onSelect: (Int) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                ForEach(Array(store.buckets.enumerated()), id: \.element.id) { i, bucket in
                    Button { onSelect(i) } label: {
                        MonthCard(store: store, index: i, bucket: bucket)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 64)
            .padding(.bottom, 80)
        }
        .defaultScrollAnchor(.bottom)
        .scrollIndicators(.hidden)
    }
}

private struct MonthCard: View {
    let store: TimelineStore
    let index: Int
    let bucket: TimelineStore.Bucket

    var body: some View {
        let key = store.keyAsset(ofBucket: index)
        AssetImage(key, kind: .preview)
            .frame(height: 230)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(DateFormatting.monthYear(bucket.date))
                        .font(.title2.weight(.bold))
                    Text(store.topPlace(ofBucket: index) ?? "\(bucket.count) items")
                        .font(.subheadline.weight(.semibold))
                        .opacity(0.9)
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 6, y: 1)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(alignment: .top) {
                    LinearGradient(colors: [.black.opacity(0.45), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 110)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Text("\(bucket.count)")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .glassEffect(.regular, in: .capsule)
                    .padding(10)
            }
            .clipShape(.rect(cornerRadius: Theme.Radius.card))
            .contentShape(.rect(cornerRadius: Theme.Radius.card))
            .onAppear { store.loadBucket(index) }
            .accessibilityElement(children: .combine)
    }
}

/// One card per year (key art from its newest loaded month).
struct YearsView: View {
    let store: TimelineStore
    var onSelect: (Int) -> Void

    private struct YearGroup: Identifiable {
        let year: Int
        let bucketIndexes: [Int]
        let count: Int
        var id: Int { year }
    }

    private var groups: [YearGroup] {
        let cal = DateFormatting.gmtCalendar
        var order: [Int] = []
        var map: [Int: [Int]] = [:]
        for (i, b) in store.buckets.enumerated() {
            let y = cal.component(.year, from: b.date)
            if map[y] == nil { order.append(y) }
            map[y, default: []].append(i)
        }
        return order.map { y in
            YearGroup(year: y, bucketIndexes: map[y]!, count: map[y]!.reduce(0) { $0 + store.buckets[$1].count })
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(groups) { g in
                    Button { onSelect(g.year) } label: { card(g) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 64)
            .padding(.bottom, 80)
        }
        .defaultScrollAnchor(.bottom)
        .scrollIndicators(.hidden)
    }

    private func card(_ g: YearGroup) -> some View {
        // The month with the most items stands in for the year.
        let featured = g.bucketIndexes.max { store.buckets[$0].count < store.buckets[$1].count } ?? g.bucketIndexes.last!
        return AssetImage(store.keyAsset(ofBucket: featured), kind: .preview)
            .frame(height: 340)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(String(g.year))
                        .font(.system(size: 40, weight: .heavy))
                    Text("\(g.count.formatted()) items")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.5), radius: 8, y: 1)
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(alignment: .top) {
                    LinearGradient(colors: [.black.opacity(0.5), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 140)
                }
            }
            .clipShape(.rect(cornerRadius: Theme.Radius.card))
            .onAppear { store.loadBucket(featured) }
    }
}
