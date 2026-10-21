package com.builduseful.soundscape.core

import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.testing.readShared
import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogTest {
    // The generated catalog is what the app ships; shared/catalog.json is what
    // every platform agreed. A stale build or a broken generator shows here.
    @Test
    fun matchesTheSharedCatalog() {
        val shared = (readShared("catalog.json") as Map<*, *>)["tracks"] as List<*>
        val expected = shared.map { entry ->
            entry as Map<*, *>
            Track(entry["id"] as String, entry["title"] as String)
        }
        assertEquals(expected, catalogTracks)
    }

    // An id names a saved preference and a file, so two tracks sharing one would
    // silently play, and remember, the wrong soundscape.
    @Test
    fun idsAreUnique() {
        assertEquals(catalogTracks.size, catalogTracks.map { it.id }.toSet().size)
    }
}
