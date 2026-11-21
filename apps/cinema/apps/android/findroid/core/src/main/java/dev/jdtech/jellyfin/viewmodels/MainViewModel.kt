package dev.jdtech.jellyfin.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.jdtech.jellyfin.api.JellyfinApi
import dev.jdtech.jellyfin.database.ServerDatabaseDao
import dev.jdtech.jellyfin.models.Server
import dev.jdtech.jellyfin.models.User
import dev.jdtech.jellyfin.settings.domain.AppPreferences
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.jellyfin.sdk.api.client.exception.InvalidStatusException
import timber.log.Timber

@HiltViewModel
class MainViewModel
@Inject
constructor(
    private val appPreferences: AppPreferences,
    private val database: ServerDatabaseDao,
    private val jellyfinApi: JellyfinApi,
) : ViewModel() {
    private val _state = MutableStateFlow(MainState())
    val state = _state.asStateFlow()

    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState = _uiState.asStateFlow()

    sealed class UiState {
        data class Normal(val server: Server?, val user: User?) : UiState()

        data object Loading : UiState()
    }

    init {
        check()
    }

    private fun check() {
        viewModelScope.launch {
            _state.emit(MainState(isLoading = true))
            forgetRevokedUser()
            val mainState =
                MainState(
                    isLoading = false,
                    isDynamicColors = checkIsDynamicColors(),
                    hasServers = checkHasServers(),
                    hasCurrentServer = checkHasCurrentServer(),
                    hasCurrentUser = checkHasCurrentUser(),
                    isOfflineMode = checkIsOfflineMode(),
                )
            _state.emit(mainState)
        }
    }

    fun loadServerAndUser() {
        viewModelScope.launch {
            val serverId = appPreferences.getValue(appPreferences.currentServer)
            serverId?.let { id ->
                database.getServerWithAddressAndUser(id)?.let { data ->
                    _uiState.emit(UiState.Normal(data.server, data.user))
                }
            }
        }
    }

    private suspend fun checkHasServers(): Boolean {
        val nServers = database.getServersCount()
        return nServers > 0
    }

    private suspend fun checkHasCurrentServer(): Boolean {
        return appPreferences.getValue(appPreferences.currentServer)?.let {
            database.getServer(it) != null
        } == true
    }

    private suspend fun checkHasCurrentUser(): Boolean {
        return appPreferences.getValue(appPreferences.currentServer)?.let {
            database.getServerCurrentUser(it) != null
        } == true
    }

    /**
     * Cinema: a token revoked from accounts.davideghiotto.it (or a reset password) sends the app
     * back to sign-in, instead of an empty home that silently gets 401s. Only a 401 counts: offline
     * or an unreachable server keeps the user.
     */
    private suspend fun forgetRevokedUser() {
        if (checkIsOfflineMode()) return
        val serverId = appPreferences.getValue(appPreferences.currentServer) ?: return
        val user = database.getServerCurrentUser(serverId) ?: return
        try {
            withTimeout(5000) {
                withContext(Dispatchers.IO) { jellyfinApi.userApi.getCurrentUser() }
            }
        } catch (e: InvalidStatusException) {
            if (e.status == 401) {
                Timber.i("token for ${user.name} was revoked, signing out")
                database.deleteUser(user.id)
            }
        } catch (_: Exception) {}
    }

    private fun checkIsDynamicColors(): Boolean {
        return appPreferences.getValue(appPreferences.dynamicColors)
    }

    private fun checkIsOfflineMode(): Boolean {
        return appPreferences.getValue(appPreferences.offlineMode)
    }
}

data class MainState(
    val isLoading: Boolean = true,
    val isDynamicColors: Boolean = true,
    val hasServers: Boolean = false,
    val hasCurrentServer: Boolean = false,
    val hasCurrentUser: Boolean = false,
    val isOfflineMode: Boolean = false,
)
