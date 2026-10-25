package soundscape.build

import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Each catalog track's master, copied as it is to `soundscapes/<id>.wav`: the
 * masters are finished loops, so the app plays them byte for byte. A track with
 * no master fails the build rather than shipping silent.
 */
@CacheableTask
abstract class BundleLoops : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val catalog: RegularFileProperty

    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val masters: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun bundle() {
        val root = outputDir.get().asFile
        root.deleteRecursively()
        val target = root.resolve("soundscapes")
        target.mkdirs()
        (json(catalog).require("tracks") as List<*>).forEach { entry ->
            val id = (entry as Map<*, *>)["id"].toString()
            val master = masters.file("$id.wav").get().asFile
            require(master.isFile) { "No master for \"$id\": masters/$id.wav is missing" }
            master.copyTo(target.resolve("$id.wav"))
        }
    }
}
