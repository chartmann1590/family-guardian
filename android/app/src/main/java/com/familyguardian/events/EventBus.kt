package com.familyguardian.events

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Process-wide hot stream of GuardianEvents. The [LocationService] writes into
 * this; any Composable can collect it. Buffer is bounded so a paused subscriber
 * (e.g. a backgrounded chat screen) drops the oldest events rather than blocking.
 */
object EventBus {
    private val _events = MutableSharedFlow<GuardianEvent>(
        replay = 0,
        extraBufferCapacity = 128,
    )
    val events: SharedFlow<GuardianEvent> = _events.asSharedFlow()

    fun emit(event: GuardianEvent) {
        _events.tryEmit(event)
    }
}
