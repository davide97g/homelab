package it.davideghiotto.memoriestv.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** What the viewer pages through: a timeline or a search result. */
interface AssetSource {
    val count: Int
    fun asset(index: Int): Asset?
    /** Starts loading whatever holds [index]. */
    fun ensure(index: Int)
    fun updateFavorite(id: String, value: Boolean)
}

/**
 * A timeline (library, album, person, favorites): every month's count is known up front from
 * `/timeline/buckets`, so the grid is sized for the whole library and months load as they
 * approach the screen. Same idea as the iOS `TimelineStore`.
 */
class TimelineStore(
    private val service: MediaService,
    val query: TimelineQuery,
    private val scope: CoroutineScope,
) : AssetSource {
    var buckets by mutableStateOf<List<Bucket>>(emptyList())
        private set
    var hasLoaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private val months = mutableStateMapOf<String, List<Asset>>()
    private val inflight = mutableSetOf<String>()
    private var starts = IntArray(0)

    override val count get() = buckets.sumOf { it.count }

    suspend fun load() {
        if (hasLoaded) return
        reload()
    }

    suspend fun reload() {
        try {
            val b = service.buckets(query)
            months.clear()
            inflight.clear()
            starts = IntArray(b.size).also { var acc = 0; b.forEachIndexed { i, x -> it[i] = acc; acc += x.count } }
            buckets = b
            error = null
        } catch (e: Exception) {
            error = e.message ?: "Can't load the library."
        }
        hasLoaded = true
    }

    fun monthAssets(key: String): List<Asset>? = months[key]

    /** Index in [buckets] of the month that holds global [index]. */
    fun bucketIndex(index: Int): Int {
        var lo = 0
        var hi = starts.size - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) / 2
            if (starts[mid] <= index) lo = mid else hi = mid - 1
        }
        return lo
    }

    fun startOf(bucket: Int): Int = starts.getOrElse(bucket) { 0 }

    override fun asset(index: Int): Asset? {
        if (buckets.isEmpty() || index !in 0 until count) return null
        val b = bucketIndex(index)
        return months[buckets[b].key]?.getOrNull(index - starts[b])
    }

    override fun ensure(index: Int) {
        if (buckets.isEmpty() || index !in 0 until count) return
        ensureMonth(buckets[bucketIndex(index)].key)
    }

    fun ensureMonth(key: String) {
        if (months.containsKey(key) || !inflight.add(key)) return
        scope.launch {
            try {
                months[key] = service.bucket(query, key)
            } catch (e: Exception) {
                error = e.message
            } finally {
                inflight.remove(key)
            }
        }
    }

    override fun updateFavorite(id: String, value: Boolean) {
        for ((k, list) in months) {
            val i = list.indexOfFirst { it.id == id }
            if (i >= 0) { months[k] = list.toMutableList().also { it[i] = it[i].copy(isFavorite = value) }; return }
        }
    }
}

/** A paged search (smart search, videos, a city). */
class ListStore(
    private val service: MediaService,
    val query: ListQuery,
    private val scope: CoroutineScope,
) : AssetSource {
    val items = mutableStateListOf<Asset>()
    var hasLoaded by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var next: Int? = 1
    private var loading = false

    override val count get() = items.size

    fun loadMore() {
        val page = next ?: return
        if (loading) return
        loading = true
        scope.launch {
            try {
                val p = service.list(query, page)
                items.addAll(p.assets)
                next = p.nextPage
                error = null
            } catch (e: Exception) {
                error = e.message ?: "Search failed."
                next = null
            } finally {
                loading = false
                hasLoaded = true
            }
        }
    }

    override fun asset(index: Int): Asset? = items.getOrNull(index)

    override fun ensure(index: Int) {
        if (index >= items.size - 30) loadMore()
    }

    override fun updateFavorite(id: String, value: Boolean) {
        val i = items.indexOfFirst { it.id == id }
        if (i >= 0) items[i] = items[i].copy(isFavorite = value)
    }
}

/** A fixed list (a memory, a place's handful). */
class FixedSource(private val list: List<Asset>) : AssetSource {
    private val items = mutableStateListOf<Asset>().also { it.addAll(list) }
    override val count get() = items.size
    override fun asset(index: Int) = items.getOrNull(index)
    override fun ensure(index: Int) {}
    override fun updateFavorite(id: String, value: Boolean) {
        val i = items.indexOfFirst { it.id == id }
        if (i >= 0) items[i] = items[i].copy(isFavorite = value)
    }
}
