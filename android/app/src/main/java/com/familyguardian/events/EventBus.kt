package com.familyguardian.events

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

object EventBus {
    private val _events = MutableSharedFlow<GuardianEvent>(
        replay = 0,
        extraBufferCapacity = 128,
    )
    val events: SharedFlow<GuardianEvent> = _events.asSharedFlow()

    private val _wsState = MutableStateFlow(EventStreamClient.ConnectionState.DISCONNECTED)
    val wsState: StateFlow<EventStreamClient.ConnectionState> = _wsState.asStateFlow()

    fun emit(event: GuardianEvent) {
        _events.tryEmit(event)
    }

    fun updateWsState(state: EventStreamClient.ConnectionState) {
        _wsState.value = state
    }
}
