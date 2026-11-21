package it.davideghiotto.memoriestv.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.key.Keyer
import coil3.request.Options
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.random.Random
import kotlinx.coroutines.delay

/** A generated picture: no bundled images, drawn per seed (like the iOS app's MockArt). */
data class MockImage(val seed: Int, val ratio: Float, val longSide: Int)

/**
 * A fake library for the emulator and screenshots: `adb shell am start -n
 * it.davideghiotto.memoriestv/.MainActivity --ez mock true`. ~1,800 items over three years.
 */
class MockService(count: Int = 1800) : MediaService {
    override val isMock = true

    private val cities = listOf("Venezia" to "Italia", "Lisboa" to "Portugal", "Milano" to "Italia", "Cortina" to "Italia",
        "Paris" to "France", null to null, "Trento" to "Italia", "Barcelona" to "España")

    private val all: List<Asset> = run {
        val rnd = Random(7)
        val now = Instant.now()
        var t = now
        List(count) { i ->
            t = t.minus((rnd.nextLong(20, 60 * 60 * 14)), ChronoUnit.SECONDS)
            val video = rnd.nextInt(12) == 0
            val c = cities[(i / 40) % cities.size]
            Asset(
                id = "mock-$i",
                ratio = listOf(0.75f, 1.333f, 1.333f, 1.777f, 0.5625f, 1f)[rnd.nextInt(6)],
                thumbhash = null,
                isImage = !video,
                durationMs = if (video) rnd.nextLong(3_000, 180_000) else null,
                isFavorite = rnd.nextInt(15) == 0,
                livePhotoVideoId = if (!video && rnd.nextInt(5) == 0) "mock-live-$i" else null,
                createdAt = t,
                offsetHours = 1.0,
                city = c.first,
                country = c.second,
            )
        }
    }
    private val byId = all.associateBy { it.id }

    private fun monthKey(a: Asset) = a.local.toLocalDate().withDayOfMonth(1).toString()

    override suspend fun me() = User("mock", "Sample Library", "sample@memories")

    override suspend fun buckets(q: TimelineQuery): List<Bucket> {
        delay(250)
        return filter(q).groupBy(::monthKey).map { (k, v) -> Bucket(k, v.size) }
    }

    override suspend fun bucket(q: TimelineQuery, key: String): List<Asset> {
        delay(150)
        return filter(q).filter { monthKey(it) == key }
    }

    private fun filter(q: TimelineQuery): List<Asset> = when (q) {
        TimelineQuery.Library -> all
        TimelineQuery.Favorites -> all.filter { it.isFavorite }
        is TimelineQuery.Album -> all.filterIndexed { i, _ -> i % (q.id.hashCode().mod(5) + 3) == 0 }.take(120)
        is TimelineQuery.Person -> all.filterIndexed { i, _ -> i % (q.id.hashCode().mod(7) + 4) == 1 }.take(200)
    }

    override suspend fun detail(id: String): AssetDetail {
        delay(120)
        val a = byId[id] ?: all.first()
        return AssetDetail(a, "IMG_${id.removePrefix("mock-").padStart(4, '0')}.HEIC", if (a.isVideo) "video/quicktime" else "image/heic",
            null, "Apple", "iPhone 14", "iPhone 14 back dual wide camera 5.7mm f/1.5", 4032, 3024, 2_400_000,
            64, 5.7, 1.5, "1/120", people().take(2))
    }

    override suspend fun albums(): List<Album> = listOf(
        "Dolomiti 2026", "Lisbona", "Natale", "Matrimonio Giulia", "Cani", "Tramonti", "Carnevale", "Barcellona",
    ).mapIndexed { i, n -> Album("album-$i", n, all[i * 37].id, 40 + i * 13, i % 3 == 0, all[i * 37].createdAt) }

    override suspend fun people(): List<Person> =
        listOf("Davide", "Giulia", "Marco", "Nonna", "Luca", "Sara").mapIndexed { i, n -> Person("person-$i", n) }

    override suspend fun memories(): List<Memory> {
        val today = LocalDate.now()
        return (1..3).map { back ->
            val y = today.year - back
            Memory("memory-$back", y, "On This Day", all.filterIndexed { i, _ -> i % (back * 11 + 3) == 0 }.take(14))
        }
    }

    override suspend fun places(): List<Place> =
        cities.mapNotNull { it.first }.distinct().map { c -> Place(c, all.first { it.city == c }) }

    override suspend fun list(q: ListQuery, page: Int): Page {
        delay(300)
        val items = when (q) {
            is ListQuery.Smart -> all.filterIndexed { i, _ -> (i + q.text.length) % 9 == 0 }
            ListQuery.Videos -> all.filter { it.isVideo }
            ListQuery.RecentlyAdded -> all
            is ListQuery.City -> all.filter { it.city == q.name }
        }
        val size = 120
        val slice = items.drop((page - 1) * size).take(size)
        return Page(slice, if (page * size < items.size) page + 1 else null)
    }

    override suspend fun setFavorite(ids: List<String>, value: Boolean) = delay(150)

    private fun seed(id: String) = id.hashCode()

    override fun image(id: String, size: ImageSize, thumbhash: String?): Any {
        val ratio = byId[id]?.ratio ?: 1f
        return MockImage(seed(id), ratio, if (size == ImageSize.Thumbnail) 256 else 1280)
    }

    override fun personImage(id: String): Any = MockImage(seed(id) * 31, 1f, 256)

    override fun video(id: String): VideoSource? = null
}

/** Draws a [MockImage]: a sky gradient, a sun and two ridges in seeded colours. */
class MockFetcher(private val data: MockImage) : Fetcher {
    override suspend fun fetch(): FetchResult {
        val w = if (data.ratio >= 1) data.longSide else (data.longSide * data.ratio).toInt()
        val h = if (data.ratio >= 1) (data.longSide / data.ratio).toInt() else data.longSide
        val bmp = Bitmap.createBitmap(w.coerceAtLeast(8), h.coerceAtLeast(8), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val r = Random(data.seed)
        val hue = r.nextFloat() * 360
        fun hsv(h: Float, s: Float, v: Float) = android.graphics.Color.HSVToColor(floatArrayOf((h + 360) % 360, s, v))
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, bmp.height.toFloat(), hsv(hue, 0.45f, 0.95f), hsv(hue + 40, 0.65f, 0.75f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat(), p)
        p.shader = null
        p.color = hsv(hue + 60, 0.25f, 1f)
        val sun = bmp.width * (0.06f + r.nextFloat() * 0.06f)
        c.drawCircle(bmp.width * (0.2f + r.nextFloat() * 0.6f), bmp.height * (0.2f + r.nextFloat() * 0.25f), sun, p)
        for (layer in 0..1) {
            p.color = hsv(hue + 180 + layer * 20, 0.45f, 0.45f - layer * 0.18f)
            val path = Path()
            val base = bmp.height * (0.55f + layer * 0.15f)
            path.moveTo(0f, bmp.height.toFloat())
            path.lineTo(0f, base)
            var x = 0f
            while (x < bmp.width) {
                x += bmp.width * (0.15f + r.nextFloat() * 0.2f)
                path.lineTo(x, base - bmp.height * (r.nextFloat() * 0.25f))
            }
            path.lineTo(bmp.width.toFloat(), bmp.height.toFloat())
            path.close()
            c.drawPath(path, p)
        }
        return ImageFetchResult(bmp.asImage(), isSampled = false, dataSource = DataSource.MEMORY)
    }

    class Factory : Fetcher.Factory<MockImage> {
        override fun create(data: MockImage, options: Options, imageLoader: ImageLoader) = MockFetcher(data)
    }

    class Key : Keyer<MockImage> {
        override fun key(data: MockImage, options: Options) = "mock:${data.seed}:${data.longSide}"
    }
}
