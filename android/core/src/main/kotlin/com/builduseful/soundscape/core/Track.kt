package com.builduseful.soundscape.core

/**
 * A soundscape. [id] is permanent — it names the saved preference and the audio
 * file — so it is never derived from [title], which may change freely.
 */
data class Track(val id: String, val title: String)
