package app.chronoeon.desktop

import java.net.ServerSocket
import org.junit.Assert.*
import org.junit.Test

class AiModelsClientTest {
    private fun rejection(status: Int): Pair<String, String> {
        ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { server ->
            var received = ""
            val worker = Thread {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    val lines = mutableListOf<String>()
                    while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break; lines.add(line) }
                    received = lines.joinToString("\n")
                    socket.getOutputStream().write("HTTP/1.1 $status Test\r\nContent-Length: 0\r\nLocation: http://127.0.0.1:1/other\r\nConnection: close\r\n\r\n".toByteArray())
                }
            }.apply { isDaemon = true; start() }
            val error = try {
                AiModelsClient.fetch("http://127.0.0.1:${server.localPort}/v1/models", mapOf("Authorization" to "Bearer test-only"), 2000)
                fail("Expected HTTP rejection"); ""
            } catch (error: IllegalArgumentException) { error.message ?: "" }
            worker.join(3000)
            return error to received
        }
    }

    @Test fun unauthorizedResponseRetainsStatusWithoutCredential() {
        val (error, request) = rejection(401)
        assertEquals("AI endpoint returned HTTP 401", error)
        assertTrue(request.contains("Authorization: Bearer test-only"))
        assertFalse(error.contains("test-only"))
    }

    @Test fun redirectsNeverForwardCredentialsToAnotherDestination() {
        val (error, _) = rejection(302)
        assertEquals("AI endpoint returned HTTP 302", error)
    }
}
