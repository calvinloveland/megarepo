use std::slice;

pub fn binary_ink_iou(observed: &[u8], rendered: &[u8]) -> f64 {
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

pub fn score_compare_candidates(observed: &[u8], candidates: &[&[u8]]) -> (usize, f64) {
    let mut best_index = 0usize;
    let mut best_score = -1.0f64;
    for (index, candidate) in candidates.iter().enumerate() {
        let score = binary_ink_iou(observed, candidate);
        if score > best_score {
            best_index = index;
            best_score = score;
        }
    }
    (best_index, best_score)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn full_auto_de_pdf_best_iou_score_u8(
    observed_ptr: *const u8,
    image_len: usize,
    candidate_ptr: *const u8,
    candidate_count: usize,
    best_index_out: *mut usize,
    best_score_out: *mut f64,
) -> i32 {
    if observed_ptr.is_null()
        || candidate_ptr.is_null()
        || best_index_out.is_null()
        || best_score_out.is_null()
        || image_len == 0
        || candidate_count == 0
    {
        return 1;
    }
    let observed = unsafe { slice::from_raw_parts(observed_ptr, image_len) };
    let candidates_blob = unsafe { slice::from_raw_parts(candidate_ptr, image_len * candidate_count) };
    let candidates: Vec<&[u8]> = candidates_blob.chunks_exact(image_len).collect();
    if candidates.len() != candidate_count {
        return 2;
    }
    let (best_index, best_score) = score_compare_candidates(observed, &candidates);
    unsafe {
        *best_index_out = best_index;
        *best_score_out = best_score;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::{binary_ink_iou, score_compare_candidates};

    #[test]
    fn binary_ink_iou_matches_expected_overlap() {
        let observed = [0u8, 255, 0, 255];
        let rendered = [0u8, 0, 255, 255];
        let score = binary_ink_iou(&observed, &rendered);
        assert!((score - (1.0 / 3.0)).abs() < 1e-12);
    }

    #[test]
    fn score_compare_candidates_picks_best_index() {
        let observed = [0u8, 255, 0, 255];
        let candidates = [&[0u8, 255, 255, 255][..], &[0u8, 255, 0, 255][..]];
        let (best_index, best_score) = score_compare_candidates(&observed, &candidates);
        assert_eq!(best_index, 1);
        assert!((best_score - 1.0).abs() < 1e-12);
    }
}
