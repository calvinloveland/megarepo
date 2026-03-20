use std::env;
use std::error::Error;
use std::io::{self, Read};
use std::time::Instant;

struct Payload<'a> {
    observed: &'a [u8],
    candidates: Vec<&'a [u8]>,
}

fn parse_u32(bytes: &[u8]) -> Result<u32, Box<dyn Error>> {
    let array: [u8; 4] = bytes.try_into()?;
    Ok(u32::from_le_bytes(array))
}

fn parse_payload(buffer: &[u8]) -> Result<Payload<'_>, Box<dyn Error>> {
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
    Ok(Payload {
        observed,
        candidates,
    })
}

fn binary_ink_iou(observed: &[u8], rendered: &[u8]) -> f64 {
    let mut overlap: u64 = 0;
    let mut union: u64 = 0;
    for (observed_pixel, rendered_pixel) in observed.iter().zip(rendered.iter()) {
        let observed_ink = *observed_pixel == 0;
        let rendered_ink = *rendered_pixel == 0;
        if observed_ink || rendered_ink {
            union += 1;
            if observed_ink && rendered_ink {
                overlap += 1;
            }
        }
    }
    if union == 0 {
        0.0
    } else {
        overlap as f64 / union as f64
    }
}

fn score_candidates(payload: &Payload<'_>) -> (usize, f64) {
    let mut best_index = 0usize;
    let mut best_score = -1.0f64;
    for (index, candidate) in payload.candidates.iter().enumerate() {
        let score = binary_ink_iou(payload.observed, candidate);
        if score > best_score {
            best_index = index;
            best_score = score;
        }
    }
    (best_index, best_score)
}

fn parse_repeat(args: &[String]) -> Result<usize, Box<dyn Error>> {
    match args {
        [] => Ok(1),
        [flag, count] if flag == "--repeat" => Ok(count.parse()?),
        _ => Err("usage: rust_iou_mvp [--repeat N]".into()),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let repeats = parse_repeat(&args)?;
    let mut buffer = Vec::new();
    io::stdin().read_to_end(&mut buffer)?;
    let payload = parse_payload(&buffer)?;
    let started = Instant::now();
    let mut best_index = 0usize;
    let mut best_score = -1.0f64;
    for _ in 0..repeats {
        (best_index, best_score) = score_candidates(&payload);
    }
    let elapsed_ns = started.elapsed().as_nanos();
    println!("{best_index}\t{best_score:.12}\t{elapsed_ns}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{binary_ink_iou, parse_payload, score_candidates};

    #[test]
    fn binary_ink_iou_matches_expected_overlap() {
        let observed = [0u8, 255, 0, 255];
        let rendered = [0u8, 0, 255, 255];
        let score = binary_ink_iou(&observed, &rendered);
        assert!((score - (1.0 / 3.0)).abs() < 1e-12);
    }

    #[test]
    fn score_candidates_picks_best_index() {
        let payload_bytes = [
            2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0, 255, 0, 255,
        ];
        let payload = parse_payload(&payload_bytes).expect("payload should parse");
        let (best_index, best_score) = score_candidates(&payload);
        assert_eq!(best_index, 1);
        assert!((best_score - 1.0).abs() < 1e-12);
    }
}
