package app.chronoeon.desktop

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/** Android's system HTTPS stack supplies its DNS, VPN and certificate integration. */
object AiModelsClient {
    fun fetch(endpoint: String, headers: Map<String, String>, timeoutMs: Int): JSONArray {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            // Credentials must never be forwarded to a different host by a redirect.
            connection.instanceFollowRedirects = false
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            val status = connection.responseCode
            require(status in 200..299) { "AI endpoint returned HTTP $status" }
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 2 * 1024 * 1024) { "AI response exceeded the 2 MB safety limit" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            val payload = JSONObject(String(bytes, Charsets.UTF_8))
            val items = payload.optJSONArray("data") ?: payload.optJSONArray("models")
                ?: error("AI endpoint returned no model list")
            val ids = linkedSetOf<String>()
            for (index in 0 until items.length()) {
                val item = items.get(index)
                val id = if (item is JSONObject) item.optString("id").ifBlank { item.optString("name") } else item as? String ?: ""
                if (id.isNotBlank()) ids.add(id)
            }
            return JSONArray().apply { ids.forEach { put(JSONObject().put("id", it)) } }
        } finally { connection.disconnect() }
    }
}
