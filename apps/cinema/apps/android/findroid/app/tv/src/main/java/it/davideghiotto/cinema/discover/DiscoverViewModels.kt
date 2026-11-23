package it.davideghiotto.cinema.discover

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber

@HiltViewModel
class DiscoverViewModel @Inject constructor(private val client: DiscoverClient) : ViewModel() {
    data class State(
        val requests: List<DiscoverResult> = emptyList(),
        val rows: List<Pair<DiscoverRow, List<DiscoverResult>>> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state = _state.asStateFlow()

    /** Called on every visit, so a request made a minute ago shows up; old rows stay meanwhile. */
    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            // The first call answers for all of them: no Seerr, no Discover.
            val trending =
                try {
                    client.row(DiscoverRow.TRENDING)
                } catch (e: Exception) {
                    Timber.w(e, "Discover unavailable")
                    _state.update { it.copy(isLoading = false, error = explain(e)) }
                    return@launch
                }
            val (requests, others) =
                coroutineScope {
                    val requests = async { myRequests() }
                    val others =
                        DiscoverRow.entries
                            .drop(1)
                            .map { row ->
                                async {
                                    row to runCatching { client.row(row) }.getOrDefault(emptyList())
                                }
                            }
                            .awaitAll()
                    requests.await() to others
                }
            _state.value =
                State(
                    requests = requests,
                    rows = listOf(DiscoverRow.TRENDING to trending) + others,
                    isLoading = false,
                )
        }
    }

    /** Seerr's request list has no titles or art: each one asks for its own details. */
    private suspend fun myRequests(): List<DiscoverResult> = coroutineScope {
        runCatching { client.myRequests() }
            .getOrDefault(emptyList())
            .mapNotNull { r -> r.media?.tmdbId?.let { r.type to it } }
            .distinct()
            .map { (type, id) ->
                async { runCatching { client.details(type, id).asResult(type) }.getOrNull() }
            }
            .awaitAll()
            .filterNotNull()
    }
}

@HiltViewModel
class DiscoverItemViewModel @Inject constructor(private val client: DiscoverClient) : ViewModel() {
    data class State(
        val details: DiscoverDetails? = null,
        val related: List<DiscoverResult> = emptyList(),
        val me: DiscoverMe? = null,
        val picked: Set<Int> = emptySet(),
        val isBusy: Boolean = false,
        val message: String? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state = _state.asStateFlow()

    private var type = "movie"
    private var id = 0

    fun load(type: String, id: Int) {
        if (this.id == id && this.type == type && _state.value.details != null) return
        this.type = type
        this.id = id
        viewModelScope.launch {
            try {
                coroutineScope {
                    val me = async { runCatching { client.me() }.getOrNull() }
                    val related = async {
                        runCatching { client.recommendations(type, id) }.getOrDefault(emptyList())
                    }
                    val details = client.details(type, id)
                    _state.update {
                        it.copy(
                            details = details,
                            picked = requestable(details),
                            me = me.await(),
                            related = related.await(),
                        )
                    }
                }
            } catch (e: Exception) {
                Timber.w(e, "Discover details failed")
                _state.update { it.copy(error = explain(e)) }
            }
        }
    }

    fun toggle(season: Int) {
        _state.update {
            it.copy(picked = if (season in it.picked) it.picked - season else it.picked + season)
        }
    }

    fun request() {
        val s = _state.value
        val details = s.details ?: return
        val seasons = if (type == "tv") s.picked.sorted() else null
        if (seasons != null && seasons.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isBusy = true, message = null) }
            val message =
                try {
                    client.request(type, id, seasons)
                    "${details.displayTitle} requested. " +
                        if (s.me?.autoApproved(type) == true) {
                            "It will show up in your library once it has downloaded."
                        } else {
                            "It is waiting for an admin to approve it."
                        }
                } catch (e: Exception) {
                    "Request failed: ${e.message}"
                }
            refresh(message)
        }
    }

    fun withdraw(requestId: Int) {
        viewModelScope.launch {
            _state.update { it.copy(isBusy = true, message = null) }
            val message =
                try {
                    client.cancel(requestId)
                    "Request withdrawn."
                } catch (e: Exception) {
                    "Could not withdraw it: ${e.message}"
                }
            refresh(message)
        }
    }

    private suspend fun refresh(message: String) {
        val details = runCatching { client.details(type, id) }.getOrNull()
        _state.update {
            it.copy(
                details = details ?: it.details,
                picked = details?.let(::requestable) ?: it.picked,
                isBusy = false,
                message = message,
            )
        }
    }
}

/** Seasons nobody has asked for yet: what a fresh season choice starts with. */
fun requestable(details: DiscoverDetails): Set<Int> {
    val taken = seasonStandings(details.mediaInfo)
    return details.realSeasons.map { it.seasonNumber }.filter { it !in taken }.toSet()
}

private fun explain(e: Exception): String =
    when ((e as? DiscoverClient.DiscoverException)?.status) {
        401 -> "Your session expired. Sign out and back in."
        503 -> "The server has not been connected to Seerr yet."
        else -> e.message ?: "Discover is not available right now."
    }
