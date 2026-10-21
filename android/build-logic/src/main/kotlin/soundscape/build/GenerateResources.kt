package soundscape.build

import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * The Android resources the contract has to reach before any code runs:
 * shared/copy.json as strings.xml; the page colour, which the window shows
 * while the app starts, per theme; and the catalog's app shortcuts, which the
 * launcher reads from XML.
 *
 * A copy key becomes its snake_case name (`previousTrack` → `previous_track`)
 * and `{title}` becomes `%1$s`.
 */
@CacheableTask
abstract class GenerateResources : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val copy: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val tokens: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val catalog: RegularFileProperty

    /** Where a shortcut sends its intent: the application id, the activity, and the action and extra it reads. */
    @get:Input
    abstract val shortcutPackage: Property<String>

    @get:Input
    abstract val shortcutActivity: Property<String>

    @get:Input
    abstract val shortcutAction: Property<String>

    @get:Input
    abstract val shortcutTrackExtra: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val root = outputDir.get().asFile
        root.deleteRecursively()

        val strings = json(copy).entries.joinToString("\n") { (key, value) ->
            "    <string name=\"${snakeCase(key.toString())}\">${escape(value.toString())}</string>"
        }
        write(root.resolve("values/strings.xml"), "shared/copy.json", strings)

        val page = (json(tokens).require("color") as Map<*, *>).require("page") as Map<*, *>
        write(root.resolve("values/colors.xml"), "shared/design-tokens.json", colour(page["light"]))
        write(root.resolve("values-night/colors.xml"), "shared/design-tokens.json", colour(page["dark"]))

        shortcuts(root)
    }

    private fun shortcuts(root: java.io.File) {
        val catalog = json(catalog)
        val titles = (catalog.require("tracks") as List<*>).associate { entry ->
            val track = entry as Map<*, *>
            track["id"].toString() to track["title"].toString()
        }
        val ids = (catalog.require("shortcuts") as List<*>).map { it.toString() }
        ids.forEach { require(it in titles) { "Shortcut \"$it\" is not a track in shared/catalog.json" } }

        val label = { id: String -> "shortcut_" + id.replace('-', '_') }
        write(
            root.resolve("values/shortcuts.xml"),
            "shared/catalog.json",
            ids.joinToString("\n") { "    <string name=\"${label(it)}\">${escape(titles.getValue(it))}</string>" },
        )

        val entries = ids.joinToString("\n") { id ->
            """
            |    <shortcut
            |        android:shortcutId="$id"
            |        android:icon="@mipmap/ic_launcher"
            |        android:shortcutShortLabel="@string/${label(id)}"
            |        android:shortcutLongLabel="@string/${label(id)}">
            |        <intent
            |            android:action="${shortcutAction.get()}"
            |            android:targetPackage="${shortcutPackage.get()}"
            |            android:targetClass="${shortcutActivity.get()}">
            |            <extra android:name="${shortcutTrackExtra.get()}" android:value="$id" />
            |        </intent>
            |    </shortcut>
            """.trimMargin()
        }
        write(
            root.resolve("xml/shortcuts.xml"),
            "shared/catalog.json",
            entries,
            element = "shortcuts xmlns:android=\"http://schemas.android.com/apk/res/android\"",
        )
    }

    private fun colour(value: Any?) = "    <color name=\"page\">${value.toString().lowercase()}</color>"

    private fun write(file: java.io.File, source: String, body: String, element: String = "resources") {
        file.parentFile.mkdirs()
        file.writeText(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                "<!-- Generated from $source by build-logic. Do not edit. -->\n" +
                "<$element>\n$body\n</${element.substringBefore(' ')}>\n",
        )
    }
}

internal fun snakeCase(name: String) = name.replace(Regex("[A-Z]")) { "_" + it.value.lowercase() }

private fun escape(text: String): String {
    val placeholders = Regex("\\{(\\w+)\\}").findAll(text).map { it.groupValues[1] }.distinct().toList()
    require(placeholders.size <= 1) { "\"$text\": more than one placeholder needs positional names" }

    return text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\"", "\\\"")
        .replace("@", "\\@")
        .replace("?", "\\?")
        // Only a string read with format arguments un-doubles a %.
        .let { if (placeholders.isEmpty()) it else it.replace("%", "%%") }
        .replace(Regex("\\{\\w+\\}"), "%1\\\$s")
}
