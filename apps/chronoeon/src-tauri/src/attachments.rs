//! The only attachment representation accepted by sync: bounded, metadata-free
//! WebP addressed by the SHA-256 of its encoded bytes. Original inputs stay local.
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageDecoder, ImageFormat};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{io::Cursor, path::Path};

pub const MAX_BYTES: usize = 100_000;
pub const MAX_EDGE: u32 = 1280;
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompressedAttachment {
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
    pub mime: &'static str,
}
pub struct EncodedPhoto { pub bytes: Vec<u8>, pub width: u32, pub height: u32 }

pub fn compress(bytes: &[u8], file_name: Option<&str>) -> Result<EncodedPhoto, String> {
    if bytes.len() > 32 * 1024 * 1024 { return Err("PHOTO_INPUT_TOO_LARGE".into()); }
    let format = image::guess_format(bytes).map_err(|_| "PHOTO_UNSUPPORTED_FORMAT")?;
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|error| error.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(192 * 1024 * 1024);
    limits.max_image_width = Some(24000); limits.max_image_height = Some(24000);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| format!("PHOTO_DECODE: {error}"))?;
    let orientation = decoder.orientation().map_err(|error| format!("PHOTO_ORIENTATION: {error}"))?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| format!("PHOTO_DECODE: {error}"))?;
    image.apply_orientation(orientation);
    let name = file_name.unwrap_or("").to_lowercase();
    let text_image = format == ImageFormat::Png || name.contains("screenshot") || name.contains("截图") || name.contains("截屏");
    encode(&image, text_image)
}
fn encode(image: &DynamicImage, text_image: bool) -> Result<EncodedPhoto, String> {
    for edge in [1280, 1120, 960, 800, 640, 480, 320, 160] {
        let scaled = if image.width().max(image.height()) > edge { image.resize(edge, edge, FilterType::Lanczos3) } else { image.clone() };
        let (width, height) = scaled.dimensions();
        let rgba = scaled.to_rgba8(); let encoder = webp::Encoder::from_rgba(&rgba, width, height);
        // Screenshots/line art first try lossless at full resolution; photos do
        // not waste work or bandwidth on lossless encoding of sensor noise.
        if text_image {
            let encoded = encoder.encode_lossless().to_vec();
            if encoded.len() <= MAX_BYTES { return Ok(EncodedPhoto { bytes: encoded, width, height }); }
        }
        let qualities: &[f32] = if text_image { &[90.,85.,80.,75.,70.,65.,60.,55.,50.] } else { &[80.,75.,70.,65.,60.,55.,50.] };
        for quality in qualities {
            let encoded = encoder.encode(*quality).to_vec();
            if encoded.len() <= MAX_BYTES { return Ok(EncodedPhoto { bytes: encoded, width, height }); }
        }
    }
    Err("PHOTO_CANNOT_MEET_SIZE_LIMIT".into())
}
pub fn hash(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }
pub fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
/// Canonical references have one interpretation on every platform, never a
/// relative filesystem path to be concatenated twice or allowed to escape.
pub fn read(root: &Path, sha256: &str) -> Result<Vec<u8>, String> {
    if !valid_hash(sha256) { return Err("SYNC_INVALID_ATTACHMENT".into()); }
    let path = root.join(format!("{sha256}.webp"));
    let metadata = std::fs::metadata(&path).map_err(|_| "SYNC_ATTACHMENT_MISSING")?;
    if metadata.len() > MAX_BYTES as u64 { return Err("SYNC_INVALID_ATTACHMENT".into()); }
    let bytes = std::fs::read(&path).map_err(|_| "SYNC_ATTACHMENT_MISSING")?;
    validate(&bytes, sha256)?;
    Ok(bytes)
}

pub fn validate(bytes: &[u8], expected_hash: &str) -> Result<(u32, u32), String> {
    if !valid_hash(expected_hash) || bytes.len() > MAX_BYTES || bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" || hash(bytes) != expected_hash {
        return Err("SYNC_INVALID_ATTACHMENT".into());
    }
    if u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| "SYNC_INVALID_ATTACHMENT")?) as usize + 8 != bytes.len() { return Err("SYNC_INVALID_ATTACHMENT".into()); }
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let tag = &bytes[offset..offset + 4];
        if [b"EXIF".as_slice(), b"XMP ".as_slice(), b"ICCP".as_slice()].contains(&tag) { return Err("SYNC_ATTACHMENT_METADATA".into()); }
        let length = u32::from_le_bytes(bytes[offset+4..offset+8].try_into().map_err(|_| "SYNC_INVALID_ATTACHMENT")?) as usize;
        offset = offset.checked_add(8 + length + length % 2).ok_or("SYNC_INVALID_ATTACHMENT")?;
        if offset > bytes.len() { return Err("SYNC_INVALID_ATTACHMENT".into()); }
    }
    if offset != bytes.len() { return Err("SYNC_INVALID_ATTACHMENT".into()); }
    let reader = image::ImageReader::with_format(Cursor::new(bytes), ImageFormat::WebP);
    let (width, height) = reader.into_dimensions().map_err(|_| "SYNC_INVALID_ATTACHMENT")?;
    if width == 0 || height == 0 || width.max(height) > MAX_EDGE { return Err("SYNC_INVALID_ATTACHMENT_DIMENSIONS".into()); }
    Ok((width, height))
}
pub fn store(root: &Path, photo: EncodedPhoto) -> Result<CompressedAttachment, String> {
    let sha256 = hash(&photo.bytes); validate(&photo.bytes, &sha256)?;
    let path = root.join(format!("{sha256}.webp"));
    // Immutable content addressing makes repeated imports cheap and safe.
    if path.is_file() {
        let previous = std::fs::read(&path).map_err(|error| error.to_string())?;
        validate(&previous, &sha256)?;
    } else { super::write_bytes_atomic(&path, &photo.bytes)?; }
    Ok(CompressedAttachment { sha256,
        width: photo.width, height: photo.height, bytes: photo.bytes.len(), mime: "image/webp" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn photos_are_bounded_metadata_free_and_content_addressed() {
        let image = DynamicImage::ImageRgb8(image::ImageBuffer::from_fn(1600, 1400, |x, y| {
            let n = (x.wrapping_mul(1664525) ^ y.wrapping_mul(1013904223)).wrapping_mul(1103515245);
            image::Rgb([n as u8, (n >> 8) as u8, (n >> 16) as u8])
        }));
        let encoded = encode(&image, false).unwrap();
        assert!(encoded.bytes.len() <= MAX_BYTES); assert!(encoded.width.max(encoded.height) <= 1280);
        assert_eq!(validate(&encoded.bytes, &hash(&encoded.bytes)).unwrap(), (encoded.width, encoded.height));
        assert!(validate(&encoded.bytes, &"0".repeat(64)).is_err());
    }
    #[test]
    fn screenshots_preserve_small_text_losslessly_when_it_fits() {
        let image = DynamicImage::ImageRgba8(image::ImageBuffer::from_fn(640, 400, |x,y| {
            if x % 7 < 2 && y % 13 < 8 { image::Rgba([0,0,0,255]) } else { image::Rgba([255,255,255,255]) }
        }));
        let encoded = encode(&image, true).unwrap();
        let decoded = image::load_from_memory(&encoded.bytes).unwrap().to_rgba8();
        assert_eq!(decoded, image.to_rgba8()); assert_eq!((encoded.width,encoded.height),(640,400));
        assert!(encoded.bytes.len() <= MAX_BYTES);
    }
    #[test]
    fn undecodable_inputs_never_fall_back_to_a_raw_copy() {
        assert!(compress(b"not an image", None).is_err());
    }
    #[test]
    fn exif_orientation_is_applied_before_metadata_is_removed() {
        let image = DynamicImage::new_rgb8(20,12);
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg,80).encode_image(&image).unwrap();
        let mut exif = b"Exif\0\0II*\0\x08\0\0\0".to_vec();
        exif.extend_from_slice(&[1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
        let mut input=jpeg[..2].to_vec();input.extend_from_slice(&[0xff,0xe1]);
        input.extend_from_slice(&((exif.len()+2)as u16).to_be_bytes());input.extend(exif);input.extend_from_slice(&jpeg[2..]);
        let photo=compress(&input,Some("photo.jpg")).unwrap();
        assert_eq!((photo.width,photo.height),(12,20));
        assert_eq!(validate(&photo.bytes,&hash(&photo.bytes)).unwrap(),(12,20));
    }
    #[test]
    fn refuses_metadata_even_when_a_remote_object_has_a_matching_hash() {
        let mut bytes=encode(&DynamicImage::new_rgb8(12,12),true).unwrap().bytes;
        bytes.extend_from_slice(b"EXIF");bytes.extend_from_slice(&0u32.to_le_bytes());
        let len=(bytes.len()-8)as u32;bytes[4..8].copy_from_slice(&len.to_le_bytes());
        assert!(validate(&bytes,&hash(&bytes)).is_err());
        assert!(!valid_hash("../secret"));
    }

}
