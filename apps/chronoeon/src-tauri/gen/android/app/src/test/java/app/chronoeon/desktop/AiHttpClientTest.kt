package app.chronoeon.desktop

import java.net.ServerSocket
import org.junit.Assert.*
import org.junit.Test

class AiHttpClientTest {
    @Test fun doneCompletesBeforeTheServerClosesTheConnection() {
        ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { server ->
            val release = java.util.concurrent.CountDownLatch(1)
            val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
            val worker = Thread {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    var size = 0
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        if (line.startsWith("Content-Length:", true)) size = line.substringAfter(':').trim().toInt()
                    }
                    repeat(size) { reader.read() }
                    val output = socket.getOutputStream()
                    output.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n" +
                        "data: {\"choices\":[{\"delta\":{\"content\":\"Done\"},\"finish_reason\":\"stop\"}]}\n\n" +
                        "data: {\"choices\":[],\"usage\":{\"completion_tokens\":1}}\n\ndata: [DONE]\n\n").toByteArray())
                    output.flush()
                    release.await(5, java.util.concurrent.TimeUnit.SECONDS)
                }
            }.apply { isDaemon = true; start() }
            try {
                val events = mutableListOf<String>()
                val result = executor.submit<org.json.JSONObject> {
                    AiHttpClient.complete("http://127.0.0.1:${server.localPort}/", emptyMap(), 4000, "{}") { events.add(it) }
                }.get(2, java.util.concurrent.TimeUnit.SECONDS)
                assertTrue(result.getBoolean("streaming"))
                assertEquals("[DONE]", events.last())
                assertTrue(events[1].contains("completion_tokens"))
            } finally { release.countDown(); worker.join(5000); executor.shutdownNow() }
        }
    }
    private fun response(status: Int, type: String, payload: String, chunked: Boolean = false, verify: (org.json.JSONObject, List<String>, String) -> Unit) {
        ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { server ->
            var request = ""
            val worker = Thread {
                server.accept().use { socket ->
                    val input = socket.getInputStream()
                    val header = java.io.ByteArrayOutputStream()
                    while (!header.toString("UTF-8").endsWith("\r\n\r\n")) { val b = input.read(); if (b < 0) break; header.write(b) }
                    request = header.toString("UTF-8")
                    val size = Regex("(?i)Content-Length: (\\d+)").find(request)?.groupValues?.get(1)?.toInt() ?: 0
                    val body = ByteArray(size); var read = 0
                    while (read < size) { val n = input.read(body, read, size - read); if (n < 0) break; read += n }
                    request += String(body, Charsets.UTF_8)
                    val bytes = payload.toByteArray(Charsets.UTF_8)
                    val output = socket.getOutputStream()
                    output.write("HTTP/1.1 $status Test\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nLocation: http://127.0.0.1:1/other\r\nConnection: close\r\n\r\n".toByteArray())
                    if (chunked) bytes.forEach { output.write(byteArrayOf(it)); output.flush() } else output.write(bytes)
                }
            }.apply { isDaemon = true; start() }
            val events = mutableListOf<String>()
            val result = AiHttpClient.complete("http://127.0.0.1:${server.localPort}/v1/chat/completions", mapOf("Authorization" to "Bearer test-only"), 2000, "{\"model\":\"test\"}") { events.add(it) }
            worker.join(3000)
            verify(result, events, request)
        }
    }

    @Test fun postsAuthenticatedJsonAndReadsUnicode() = response(200, "application/json", "{\"choices\":[{\"message\":{\"content\":\"你好\"}}]}") { result, events, request ->
        assertEquals("你好", result.getJSONObject("payload").getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content"))
        assertTrue(request.startsWith("POST /v1/chat/completions"))
        assertTrue(request.contains("Authorization: Bearer test-only"))
        assertTrue(request.endsWith("{\"model\":\"test\"}"))
        assertTrue(events.isEmpty())
    }

    @Test fun streamsFragmentedUnicodeAndIgnoresComments() = response(200, "text/event-stream", ": heartbeat\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\n\n", true) { result, events, _ ->
        assertTrue(result.getBoolean("streaming")); assertEquals(2, events.size)
        assertTrue(events[0].contains("你好")); assertEquals("[DONE]", events[1])
    }

    @Test fun redirectsAreNotFollowedAndCredentialsAreNotReturned() = response(302, "text/plain", "private-error") { result, events, _ ->
        assertEquals(302, result.getInt("status")); assertFalse(result.toString().contains("private-error")); assertTrue(events.isEmpty())
    }

    @Test fun preservesSchemaRejectionForTheCaller() = response(422, "application/json", "{}") { result, _, _ ->
        assertEquals(422, result.getInt("status"))
    }
}
