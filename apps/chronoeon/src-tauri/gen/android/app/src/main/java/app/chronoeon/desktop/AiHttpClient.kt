package app.chronoeon.desktop

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Same system HTTPS trust/DNS/VPN path for catalog, probes, JSON and SSE. */
object AiHttpClient {
    fun complete(endpoint: String, headers: Map<String, String>, timeoutMs: Int, body: String, onEvent: (String) -> Unit): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = minOf(timeoutMs, 15000)
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.doOutput = true
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            connection.setRequestProperty("Content-Type", "application/json")
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            val result = JSONObject().put("status", status)
            if (status !in 200..299) return result
            val streaming = connection.contentType?.contains("text/event-stream", ignoreCase = true) == true
            result.put("streaming", streaming)
            connection.inputStream.use { input ->
                if (streaming) {
                    // Enforce the transport limit before decoding a potentially huge SSE line.
                    var count = 0
                    val bounded = object : java.io.FilterInputStream(input) {
                        override fun read(): Int { val value = super.read(); if (value >= 0) { count++; require(count <= 16 * 1024 * 1024) }; return value }
                        override fun read(b: ByteArray, off: Int, len: Int): Int { val n = super.read(b, off, len); if (n > 0) { count += n; require(count <= 16 * 1024 * 1024) }; return n }
                    }
                    val data = StringBuilder()
                    bounded.bufferedReader(Charsets.UTF_8).use { reader ->
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) {
                                if (data.isNotEmpty()) { onEvent(data.toString()); data.setLength(0) }
                            } else if (line.startsWith("data:")) {
                                if (data.isNotEmpty()) data.append('\n')
                                data.append(line.substring(5).removePrefix(" "))
                            }
                        }
                    }
                } else {
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        require(output.size() + n <= 2 * 1024 * 1024) { "AI response exceeded the 2 MB safety limit" }
                        output.write(buffer, 0, n)
                    }
                    result.put("payload", JSONObject(output.toString("UTF-8")))
                }
            }
            return result
        } finally { connection.disconnect() }
    }
}
