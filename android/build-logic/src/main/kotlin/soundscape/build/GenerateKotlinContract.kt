package soundscape.build

import groovy.json.JsonSlurper
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Turns shared/catalog.json and shared/design-tokens.json into Kotlin, so the
 * app reads the contract as typed constants and a change to it is a compile
 * error wherever it no longer fits. The supporting types are hand-written in
 * the target package; this writes only values.
 */
@CacheableTask
abstract class GenerateKotlinContract : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val catalog: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val tokens: RegularFileProperty

    @get:Input
    abstract val packageName: Property<String>

    /** The hand-written class each catalog entry is built as, fully qualified. */
    @get:Input
    abstract val trackClass: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val directory = outputDir.get().asFile.resolve(packageName.get().replace('.', '/'))
        directory.deleteRecursively()
        directory.mkdirs()

        directory.resolve("Catalog.kt").writeText(catalogSource())
        directory.resolve("DesignTokens.kt").writeText(tokensSource())
    }

    private fun header() = "// Generated from shared/ by build-logic. Do not edit.\npackage ${packageName.get()}\n\n"

    private fun catalogSource(): String {
        val root = json(catalog)
        val tracks = root.require("tracks") as List<*>
        val ids = tracks.map { (it as Map<*, *>)["id"].toString() }
        val entries = tracks.joinToString(",\n") { entry ->
            val track = entry as Map<*, *>
            "    Track(id = ${quote(track["id"])}, title = ${quote(track["title"])})"
        }
        val shortcuts = (root.require("shortcuts") as List<*>).joinToString(", ") { id ->
            require(id.toString() in ids) { "Shortcut \"$id\" is not a track in shared/catalog.json" }
            "catalogTracks[${ids.indexOf(id.toString())}]"
        }
        return header() + "import ${trackClass.get()}\n\n" +
            "/** shared/catalog.json: every soundscape, in display order. */\n" +
            "val catalogTracks: List<Track> = listOf(\n$entries,\n)\n\n" +
            "/** shared/catalog.json: the app shortcuts offered before any listening has ordered them. */\n" +
            "val catalogShortcuts: List<Track> = listOf($shortcuts)\n"
    }

    private fun tokensSource(): String {
        val root = json(tokens)
        val out = StringBuilder(header())
        out.appendLine("/** shared/design-tokens.json. Sizes in dp (type in sp), durations in ms. */")
        out.appendLine("object DesignTokens {")

        out.appendLine("    object Color {")
        map(root, "color").forEach { (name, value) ->
            val pair = value as Map<*, *>
            out.appendLine("        val $name = ThemedColor(light = ${argb(pair["light"])}, dark = ${argb(pair["dark"])})")
        }
        out.appendLine("    }\n")

        out.appendLine("    object Shadow {")
        map(root, "shadow").forEach { (name, value) ->
            val layers = (value as List<*>).joinToString(", ") { layer ->
                val l = layer as Map<*, *>
                "ShadowLayer(y = ${float(l["y"])}, blur = ${float(l["blur"])}, " +
                    "color = ThemedColor(light = ${argb(l["light"])}, dark = ${argb(l["dark"])}))"
            }
            out.appendLine("        val $name: List<ShadowLayer> = listOf($layers)")
        }
        out.appendLine("    }\n")

        out.appendLine("    object Size {")
        map(root, "size").forEach { (name, value) -> out.appendLine("        const val $name: Float = ${float(value)}") }
        out.appendLine("    }\n")

        out.appendLine("    object Type {")
        map(root, "type").forEach { (name, value) ->
            val style = value as Map<*, *>
            val weight = style["weight"]?.let { (it as Number).toInt() } ?: 400
            val lineHeight = style["lineHeight"]?.let { float(it) } ?: "null"
            val letterSpacing = float(style["letterSpacing"] ?: 0)
            val uppercase = style["uppercase"] == true
            out.appendLine(
                "        val $name = TypeToken(size = ${float(style["size"])}, weight = $weight, lineHeight = $lineHeight, " +
                    "letterSpacing = $letterSpacing, uppercase = $uppercase)",
            )
        }
        out.appendLine("    }\n")

        out.appendLine("    object Duration {")
        map(root, "duration").forEach { (name, value) -> out.appendLine("        const val $name: Long = ${(value as Number).toLong()}L") }
        out.appendLine("    }\n")

        out.appendLine("    object Volume {")
        map(root, "volume").forEach { (name, value) -> out.appendLine("        const val $name: Float = ${float(value)}") }
        out.appendLine("    }\n")

        out.appendLine("    object Motion {")
        map(root, "motion").forEach { (name, value) ->
            if (value is List<*>) {
                out.appendLine("        val $name = CubicBezier(${value.joinToString(", ") { float(it) }})")
            } else {
                out.appendLine("        const val $name: Float = ${float(value)}")
            }
        }
        out.appendLine("    }")
        out.appendLine("}")
        return out.toString()
    }
}

internal fun json(file: RegularFileProperty): Map<*, *> = JsonSlurper().parse(file.get().asFile) as Map<*, *>

private fun map(root: Map<*, *>, key: String): Map<*, *> = root.require(key) as Map<*, *>

internal fun Map<*, *>.require(key: String): Any = requireNotNull(this[key]) { "Missing \"$key\" in shared/" }

private fun quote(value: Any?): String =
    "\"" + value.toString().replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$") + "\""

private fun float(value: Any?): String {
    val number = (value as Number).toDouble()
    return if (number == Math.floor(number)) "${number.toLong()}f" else "${number}f"
}

/** `#rrggbb` or `rgba(r, g, b, a)` as a Kotlin ARGB `Long` literal. */
internal fun argb(value: Any?): String {
    val text = value.toString().trim()
    val (alpha, rgb) = when {
        text.startsWith("#") && text.length == 7 -> 0xFF to text.substring(1).toInt(16)
        text.startsWith("rgba(") -> {
            val parts = text.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
            val (r, g, b) = parts.take(3).map { it.toInt() }
            Math.round(parts[3].toDouble() * 255).toInt() to ((r shl 16) or (g shl 8) or b)
        }
        else -> error("Unsupported colour \"$text\" in shared/design-tokens.json")
    }
    return "0x%02X%06XL".format(alpha, rgb)
}
