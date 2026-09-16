//! Test driver for the *same* native transport used by the Tauri commands.
//! It is an example target, not an application/installer binary.
use chronoeon_lib::{attachments, sync};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::{self, BufRead, Cursor, Write}, path::PathBuf};
#[derive(Deserialize)]
struct Request {
    op: String, cache: PathBuf, images: PathBuf,
    #[serde(default)] config: sync::TransportConfig,
    #[serde(default)] known: BTreeMap<String,String>,
    publication: Option<sync::Publication>,
}
fn handle(request: Request) -> Result<Value,String> {
    match request.op.as_str() {
        "fetch" => serde_json::to_value(sync::fetch_files(&request.config,&request.cache,&request.images,&request.known)?).map_err(|error|error.to_string()),
        "publish" => serde_json::to_value(sync::publish_files(&request.config,&request.cache,&request.images,request.publication.ok_or("missing publication")?)?).map_err(|error|error.to_string()),
        "photo" => {
            let picture=image::DynamicImage::ImageRgb8(image::ImageBuffer::from_fn(720,480,|x,y|image::Rgb([(x%256)as u8,(y%256)as u8,((x+y)%128)as u8])));
            let mut png=Cursor::new(Vec::new());picture.write_to(&mut png,image::ImageFormat::Png).map_err(|error|error.to_string())?;
            let photo=attachments::compress(png.get_ref(),Some("Screenshot.png"))?;
            serde_json::to_value(attachments::store(&request.images,photo)?).map_err(|error|error.to_string())
        },
        _ => Err("unknown operation".into()),
    }
}
fn main() {
    for line in io::stdin().lock().lines() {
        let result=line.map_err(|error|error.to_string()).and_then(|line|serde_json::from_str::<Request>(&line).map_err(|error|error.to_string())).and_then(handle);
        let output=match result {Ok(value)=>json!({"ok":true,"value":value}),Err(error)=>json!({"ok":false,"error":error})};
        println!("{output}");io::stdout().flush().unwrap();
    }
}
