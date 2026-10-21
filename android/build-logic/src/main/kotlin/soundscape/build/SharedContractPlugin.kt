package soundscape.build

import org.gradle.api.Plugin
import org.gradle.api.Project

/**
 * Puts the shared-contract generator tasks on a module's build classpath.
 * Each module registers the task it needs; see core/ and app/build.gradle.kts.
 */
class SharedContractPlugin : Plugin<Project> {
    override fun apply(project: Project) = Unit
}
