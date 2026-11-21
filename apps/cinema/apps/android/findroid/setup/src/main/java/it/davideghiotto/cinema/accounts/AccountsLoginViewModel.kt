package it.davideghiotto.cinema.accounts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.jdtech.jellyfin.api.JellyfinApi
import dev.jdtech.jellyfin.settings.domain.AppPreferences
import dev.jdtech.jellyfin.setup.domain.SetupRepository
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import timber.log.Timber

data class AccountsLoginState(
    val userCode: String? = null,
    val approveUrl: String? = null,
    val phase: Phase = Phase.Starting,
    val error: String? = null,
) {
    enum class Phase {
        Starting,
        Waiting,
        SigningIn,
        Failed,
    }
}

/**
 * The TV half of the device sign-in (RFC 8628 via accounts): show a code and a QR, poll until a
 * phone approves it, swap the session for a Jellyfin token, then carry on as if Quick Connect had
 * just succeeded. A code that expires or is denied is quietly replaced with a fresh one.
 */
@HiltViewModel
class AccountsLoginViewModel
@Inject
constructor(
    private val repository: SetupRepository,
    private val appPreferences: AppPreferences,
    private val jellyfinApi: JellyfinApi,
) : ViewModel() {
    private val _state = MutableStateFlow(AccountsLoginState())
    val state = _state.asStateFlow()

    private val eventsChannel = Channel<Unit>()
    val success = eventsChannel.receiveAsFlow()

    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = viewModelScope.launch { run() }
    }

    fun stop() {
        job?.cancel()
    }

    private suspend fun run() {
        _state.value = AccountsLoginState()
        try {
            while (true) {
                val code = AccountsClient.requestDeviceCode()
                _state.value =
                    AccountsLoginState(
                        userCode = code.userCode,
                        approveUrl = code.approveUrl,
                        phase = AccountsLoginState.Phase.Waiting,
                    )
                val session = waitForApproval(code) ?: continue
                _state.value = _state.value.copy(phase = AccountsLoginState.Phase.SigningIn)
                signIn(session)
                eventsChannel.send(Unit)
                return
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "accounts sign-in failed")
            _state.value =
                _state.value.copy(
                    phase = AccountsLoginState.Phase.Failed,
                    error =
                        when (e) {
                            is AccountsClient.AccountsException -> e.message
                            else -> "Can't reach accounts.davideghiotto.it"
                        },
                )
        }
    }

    /** The session token once a phone approves; null when the code ran out or was denied. */
    private suspend fun waitForApproval(code: AccountsClient.DeviceCode): String? {
        var interval = code.intervalSeconds.coerceAtLeast(1) * 1000
        val deadline = System.currentTimeMillis() + code.expiresInSeconds * 1000
        while (System.currentTimeMillis() < deadline) {
            delay(interval)
            when (val r = AccountsClient.poll(code.deviceCode)) {
                is AccountsClient.Poll.Granted -> return r.sessionToken
                AccountsClient.Poll.Pending -> Unit
                AccountsClient.Poll.SlowDown -> interval += 5000
                AccountsClient.Poll.Denied,
                AccountsClient.Poll.Expired -> return null
            }
        }
        return null
    }

    private suspend fun signIn(sessionToken: String) {
        val api = jellyfinApi.api
        val device = api.deviceInfo
        val grant =
            AccountsClient.jellyfinToken(
                sessionToken = sessionToken,
                deviceId = device.id,
                deviceName = device.name,
                client = api.clientInfo.name,
                version = api.clientInfo.version,
            )
        val server = repository.addServer(grant.serverUrl)
        appPreferences.setValue(appPreferences.currentServer, server.id)
        repository.loginWithToken(grant.accessToken)
    }
}
