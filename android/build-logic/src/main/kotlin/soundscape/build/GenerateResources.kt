package soundscape.build

import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * The Android resources the contract has to reach before any code runs:
 * shared/copy.json as strings.xml, and the page colour, which the window shows
 * while the app starts, per theme.
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

    }

    private fun colour(value: Any?) = "    <color name=\"page\">${value.toString().lowercase()}</color>"

    private fun write(file: java.io.File, source: String, body: String) {
        file.parentFile.mkdirs()
        file.writeText(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                "<!-- Generated from $source by build-logic. Do not edit. -->\n" +
                "<resources>\n$body\n</resources>\n",
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
