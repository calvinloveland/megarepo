use std::env;
use std::error::Error;
use std::io::{self, Read};
use std::time::Instant;

use rust_iou_mvp::{binary_ink_iou, score_compare_candidates};

struct ComparePayload<'a> {
    observed: &'a [u8],
    candidates: Vec<&'a [u8]>,
}

struct RotateCandidate<'a> {
    rotation_degrees: f64,
    image: &'a [u8],
}

struct RotatePayload<'a> {
    width: usize,
    height: usize,
    observed: &'a [u8],
    candidates: Vec<RotateCandidate<'a>>,
}

enum Mode {
    Compare,
    RotateCompare,
}

fn parse_u32(bytes: &[u8]) -> Result<u32, Box<dyn Error>> {
    let array: [u8; 4] = bytes.try_into()?;
    Ok(u32::from_le_bytes(array))
}

fn parse_f64(bytes: &[u8]) -> Result<f64, Box<dyn Error>> {
    let array: [u8; 8] = bytes.try_into()?;
    Ok(f64::from_le_bytes(array))
}

fn parse_compare_payload(buffer: &[u8]) -> Result<ComparePayload<'_>, Box<dyn Error>> {
    if buffer.len() < 16 {
        return Err("payload was too short".into());
    }
    let image_len = parse_u32(&buffer[8..12])? as usize;
    let candidate_count = parse_u32(&buffer[12..16])? as usize;
    let expected_len = 16 + image_len.saturating_mul(candidate_count + 1);
    if buffer.len() != expected_len {
        return Err("payload length did not match header".into());
    }
    let observed_start = 16;
    let observed_end = observed_start + image_len;
    let observed = &buffer[observed_start..observed_end];
    let mut candidates = Vec::with_capacity(candidate_count);
    let mut offset = observed_end;
    for _ in 0..candidate_count {
        let end = offset + image_len;
        candidates.push(&buffer[offset..end]);
        offset = end;
    }
    Ok(ComparePayload {
        observed,
        candidates,
    })
}

fn parse_rotate_payload(buffer: &[u8]) -> Result<RotatePayload<'_>, Box<dyn Error>> {
    if buffer.len() < 16 {
        return Err("payload was too short".into());
    }
    let width = parse_u32(&buffer[0..4])? as usize;
    let height = parse_u32(&buffer[4..8])? as usize;
    let image_len = parse_u32(&buffer[8..12])? as usize;
    let candidate_count = parse_u32(&buffer[12..16])? as usize;
    let per_candidate_len = 8usize + image_len;
    let expected_len = 16 + image_len + per_candidate_len.saturating_mul(candidate_count);
    if buffer.len() != expected_len {
        return Err("payload length did not match header".into());
    }
    let observed_start = 16;
    let observed_end = observed_start + image_len;
    let observed = &buffer[observed_start..observed_end];
    let mut candidates = Vec::with_capacity(candidate_count);
    let mut offset = observed_end;
    for _ in 0..candidate_count {
        let rotation = parse_f64(&buffer[offset..offset + 8])?;
        offset += 8;
        let end = offset + image_len;
        candidates.push(RotateCandidate {
            rotation_degrees: rotation,
            image: &buffer[offset..end],
        });
        offset = end;
    }
    Ok(RotatePayload {
        width,
        height,
        observed,
        candidates,
    })
}

fn rotate_image_into(
    input: &[u8],
    output: &mut [u8],
    width: usize,
    height: usize,
    rotation_degrees: f64,
) {
    output.fill(255);
    let angle = rotation_degrees.to_radians();
    let cos_angle = angle.cos();
    let sin_angle = angle.sin();
    let center_x = (width as f64 - 1.0) / 2.0;
    let center_y = (height as f64 - 1.0) / 2.0;

    for y_out in 0..height {
        let y_rel = y_out as f64 - center_y;
        for x_out in 0..width {
            let x_rel = x_out as f64 - center_x;
            let src_x = cos_angle * x_rel + sin_angle * y_rel + center_x;
            let src_y = -sin_angle * x_rel + cos_angle * y_rel + center_y;
            let src_x_rounded = src_x.round() as isize;
            let src_y_rounded = src_y.round() as isize;
            if src_x_rounded < 0
                || src_y_rounded < 0
                || src_x_rounded >= width as isize
                || src_y_rounded >= height as isize
            {
                continue;
            }
            let src_index = src_y_rounded as usize * width + src_x_rounded as usize;
            let dst_index = y_out * width + x_out;
            output[dst_index] = input[src_index];
        }
    }
}

fn score_rotate_candidates(payload: &RotatePayload<'_>) -> (usize, f64) {
    let mut best_index = 0usize;
    let mut best_score = -1.0f64;
    let mut rotated = vec![255u8; payload.width * payload.height];
    for (index, candidate) in payload.candidates.iter().enumerate() {
        let score = if candidate.rotation_degrees.abs() < 1e-9 {
            binary_ink_iou(payload.observed, candidate.image)
        } else {
            rotate_image_into(
                candidate.image,
                &mut rotated,
                payload.width,
                payload.height,
                candidate.rotation_degrees,
            );
            binary_ink_iou(payload.observed, &rotated)
        };
        if score > best_score {
            best_index = index;
            best_score = score;
        }
    }
    (best_index, best_score)
}

fn parse_args(args: &[String]) -> Result<(Mode, usize), Box<dyn Error>> {
    match args {
        [] => Ok((Mode::Compare, 1)),
        [flag, count] if flag == "--repeat" => Ok((Mode::Compare, count.parse()?)),
        [mode] if mode == "rotate-compare" => Ok((Mode::RotateCompare, 1)),
        [mode, flag, count] if mode == "rotate-compare" && flag == "--repeat" => {
            Ok((Mode::RotateCompare, count.parse()?))
        }
        _ => Err("usage: rust_iou_mvp [--repeat N] | rust_iou_mvp rotate-compare [--repeat N]".into()),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let (mode, repeats) = parse_args(&args)?;
    let mut buffer = Vec::new();
    io::stdin().read_to_end(&mut buffer)?;
    let started = Instant::now();
    let mut best_index = 0usize;
    let mut best_score = -1.0f64;
    match mode {
        Mode::Compare => {
            let payload = parse_compare_payload(&buffer)?;
            for _ in 0..repeats {
                (best_index, best_score) = score_compare_candidates(payload.observed, &payload.candidates);
            }
        }
        Mode::RotateCompare => {
            let payload = parse_rotate_payload(&buffer)?;
            for _ in 0..repeats {
                (best_index, best_score) = score_rotate_candidates(&payload);
            }
        }
    }
    let elapsed_ns = started.elapsed().as_nanos();
    println!("{best_index}\t{best_score:.12}\t{elapsed_ns}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        binary_ink_iou, parse_compare_payload, parse_rotate_payload, rotate_image_into, score_compare_candidates,
        score_rotate_candidates,
    };

    #[test]
    fn binary_ink_iou_matches_expected_overlap() {
        let observed = [0u8, 255, 0, 255];
        let rendered = [0u8, 0, 255, 255];
        let score = binary_ink_iou(&observed, &rendered);
        assert!((score - (1.0 / 3.0)).abs() < 1e-12);
    }

    #[test]
    fn score_compare_candidates_picks_best_index() {
        let payload_bytes = [
            2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0, 255, 0, 255,
        ];
        let payload = parse_compare_payload(&payload_bytes).expect("payload should parse");
        let (best_index, best_score) = score_compare_candidates(payload.observed, &payload.candidates);
        assert_eq!(best_index, 1);
        assert!((best_score - 1.0).abs() < 1e-12);
    }

    #[test]
    fn rotate_image_into_keeps_zero_rotation_identical() {
        let input = [0u8, 255, 0, 255];
        let mut output = [255u8; 4];
        rotate_image_into(&input, &mut output, 2, 2, 0.0);
        assert_eq!(input, output);
    }

    #[test]
    fn score_rotate_candidates_handles_zero_rotation() {
        let mut payload_bytes = vec![
            2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, 255, 0, 255,
        ];
        payload_bytes.extend_from_slice(&0.0f64.to_le_bytes());
        payload_bytes.extend_from_slice(&[255, 255, 255, 255]);
        payload_bytes.extend_from_slice(&0.0f64.to_le_bytes());
        payload_bytes.extend_from_slice(&[0, 255, 0, 255]);
        let payload = parse_rotate_payload(&payload_bytes).expect("rotate payload should parse");
        let (best_index, best_score) = score_rotate_candidates(&payload);
        assert_eq!(best_index, 1);
        assert!((best_score - 1.0).abs() < 1e-12);
    }
}
