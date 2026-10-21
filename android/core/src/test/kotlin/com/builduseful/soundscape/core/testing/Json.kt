package com.builduseful.soundscape.core.testing

import java.io.File

/** shared/, as passed in by core/build.gradle.kts. */
val sharedDir: File
    get() = File(requireNotNull(System.getProperty("soundscape.shared")) { "soundscape.shared is not set" })

fun readShared(path: String): Any? = Json(sharedDir.resolve(path).readText()).parse()

/**
 * Just enough JSON for the files in shared/: a test-only reader, so the
 * plain-JVM tests need no library. Objects become [Map], arrays [List],
 * numbers [Double].
 */
private class Json(private val text: String) {
    private var index = 0

    fun parse(): Any? = value().also {
        skipSpace()
        check(index == text.length) { "Trailing content at $index" }
    }

    private fun value(): Any? {
        skipSpace()
        val char = text[index]
        return when {
            char == '{' -> obj()
            char == '[' -> array()
            char == '"' -> string()
            char == 't' -> literal("true", true)
            char == 'f' -> literal("false", false)
            char == 'n' -> literal("null", null)
            char == '-' || char.isDigit() -> number()
            else -> error("Unexpected '$char' at $index")
        }
    }

    private fun obj(): Map<String, Any?> {
        val result = LinkedHashMap<String, Any?>()
        expect('{')
        skipSpace()
        if (text[index] == '}') return result.also { index++ }
        while (true) {
            skipSpace()
            val key = string()
            skipSpace()
            expect(':')
            result[key] = value()
            skipSpace()
            if (text[index] == '}') return result.also { index++ }
            expect(',')
        }
    }

    private fun array(): List<Any?> {
        val result = ArrayList<Any?>()
        expect('[')
        skipSpace()
        if (text[index] == ']') return result.also { index++ }
        while (true) {
            result += value()
            skipSpace()
            if (text[index] == ']') return result.also { index++ }
            expect(',')
        }
    }

    private fun string(): String {
        expect('"')
        val out = StringBuilder()
        while (true) {
            val char = text[index++]
            when {
                char == '"' -> return out.toString()
                char != '\\' -> out.append(char)
                else -> {
                    val escaped = text[index++]
                    when (escaped) {
                        'n' -> out.append('\n')
                        't' -> out.append('\t')
                        'r' -> out.append('\r')
                        'b' -> out.append('\b')
                        'f' -> out.append('\u000C')
                        'u' -> {
                            out.append(text.substring(index, index + 4).toInt(16).toChar())
                            index += 4
                        }
                        else -> out.append(escaped)
                    }
                }
            }
        }
    }

    private fun number(): Double {
        val start = index
        while (index < text.length && text[index] in "+-0123456789.eE") index++
        return text.substring(start, index).toDouble()
    }

    private fun literal(word: String, result: Any?): Any? {
        check(text.startsWith(word, index)) { "Expected $word at $index" }
        index += word.length
        return result
    }

    private fun expect(char: Char) {
        check(text[index] == char) { "Expected '$char' at $index" }
        index++
    }

    private fun skipSpace() {
        while (index < text.length && text[index].isWhitespace()) index++
    }
}
