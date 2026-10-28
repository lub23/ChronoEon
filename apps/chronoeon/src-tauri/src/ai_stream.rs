use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{json, Value};

#[derive(Default)]
struct Completion { content: String, reasoning: String, model: Option<String>, usage: Value, complete: bool }
impl Completion {
    fn push(&mut self, data: &str) -> Result<(), String> {
        if data == "[DONE]" { self.complete = true; return Ok(()); }
        let chunk: Value = serde_json::from_str(data).map_err(|error| format!("Invalid AI stream JSON: {error}"))?;
        if chunk.get("error").is_some() { return Err("AI stream provider error".into()); }
        if let Some(model) = chunk["model"].as_str() { self.model = Some(model.to_owned()); }
        if let Some(usage) = chunk.get("usage") { self.usage = usage.clone(); }
        let choice = &chunk["choices"][0];
        if let Some(content) = choice["delta"]["content"].as_str() { self.content.push_str(content); }
        if let Some(reasoning) = choice["delta"]["reasoning_content"].as_str() { self.reasoning.push_str(reasoning); }
        if self.content.len() + self.reasoning.len() > super::MAX_AI_RESPONSE_BYTES { return Err("AI response exceeded the 2 MB safety limit".into()); }
        if choice["finish_reason"].as_str() == Some("length") { return Err(if self.content.is_empty() && !self.reasoning.is_empty() { "AI endpoint returned an empty message (reasoning only)" } else { "AI response exceeded output token budget" }.into()); }
        if choice["finish_reason"].is_string() { self.complete = true; }
        Ok(())
    }
    fn finish(self) -> Result<Value, String> {
        if !self.complete { return Err("AI request failed: stream ended before completion".into()); }
        Ok(json!({"model":self.model,"usage":self.usage,"choices":[{"message":{"content":self.content,"reasoning_content":self.reasoning}}]}))
    }
}

#[cfg(test)]
pub async fn read(response: reqwest::Response) -> Result<Value, String> { read_with_progress(response, None).await }

pub async fn read_with_progress(response: reqwest::Response, progress: Option<tauri::ipc::Channel<Value>>) -> Result<Value, String> {
    let mut size = 0usize;
    let bytes = response.bytes_stream().map(move |chunk| {
        let bytes = chunk.map_err(std::io::Error::other)?;
        size += bytes.len();
        if size > 8 * super::MAX_AI_RESPONSE_BYTES { return Err(std::io::Error::other("AI stream exceeded the 16 MB transport limit")); }
        Ok(bytes)
    });
    let mut events = bytes.eventsource();
    let mut completion = Completion::default();
    while let Some(event) = events.next().await {
        let event = event.map_err(|error| format!("AI request failed: stream read: {error}"))?;
        completion.push(&event.data)?;
        if let Some(channel) = &progress {
            channel.send(json!({"content": completion.content, "reasoning": completion.reasoning}))
                .map_err(|_| "AI stream consumer disconnected".to_string())?;
        }
    }
    completion.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assembles_unicode_reasoning_and_usage_separately() {
        let mut completion = Completion::default();
        for data in [r#"{"model":"test","choices":[{"delta":{"reasoning_content":"思考"}}]}"#,
            r#"{"choices":[{"delta":{"content":"饮食"}}]}"#,
            r#"{"choices":[{"delta":{"content":"分析"},"finish_reason":"stop"}]}"#,
            r#"{"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":4}}"#,"[DONE]"] { completion.push(data).unwrap(); }
        let result = completion.finish().unwrap();
        assert_eq!(result["choices"][0]["message"]["content"], "饮食分析");
        assert_eq!(result["choices"][0]["message"]["reasoning_content"], "思考");
        assert_eq!(result["usage"]["prompt_tokens"], 42);
    }
    #[test]
    fn reads_real_http_sse_without_losing_unicode() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            let mut request = [0u8; 4096]; let _ = socket.read(&mut request).unwrap();
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"饮食分析\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            for chunk in body.as_bytes().chunks(3) { socket.write_all(chunk).unwrap(); }
        });
        let result = tauri::async_runtime::block_on(async {
            let response = reqwest::get(format!("http://{address}")).await.unwrap();
            read(response).await.unwrap()
        });
        worker.join().unwrap();
        assert_eq!(result["choices"][0]["message"]["content"], "饮食分析");
    }
    #[test]
    fn rejects_partial_and_truncated_answers() {
        let mut completion = Completion::default();
        completion.push(r#"{"choices":[{"delta":{"content":"半截"}}]}"#).unwrap();
        assert!(completion.finish().is_err());
        assert!(Completion::default().push(r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#).is_err());
    }
}
