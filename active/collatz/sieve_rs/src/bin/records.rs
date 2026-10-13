// Optimized record-holder search: flat array cache for small values + HashMap for large.
// Usage: collatz-records <upper_bound>

use std::time::Instant;
use std::env;
use std::collections::HashMap;

const CACHE_SIZE: usize = 1 << 26;  // 67M entries × 4 bytes = 268MB

#[inline(always)]
fn v2(x: u64) -> u32 { x.trailing_zeros() }

#[inline(always)]
fn syracuse_step(n: u64) -> (u64, u32) {
    let x = n.wrapping_mul(3).wrapping_add(1);
    let k = v2(x);
    (x >> k, k)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let bound: u64 = if args.len() > 1 {
        args[1].parse().unwrap_or(10_000_000_000)
    } else {
        10_000_000_000
    };
    
    println!("Collatz record-holders (longest chain) up to {}", bound);
    println!("Units: Syracuse (odd-to-odd) steps");
    println!();
    println!("  {:>14}  {:>6}  {:>8}  {:>10}", "n", "bits", "steps", "ratio");
    println!("  {}", "-".repeat(50));
    
    let t0 = Instant::now();
    
    // Flat array cache for small values
    let mut arr: Vec<u32> = vec![0; CACHE_SIZE];
    // HashMap for larger values
    let mut map: HashMap<u64, u32> = HashMap::new();
    
    // Iterative stopping time with explicit stack
    let mut best: u32 = 0;
    let mut count = 0;
    
    println!("  {:>14}  {:>6}  {:>8}  {:>10.4}", 1, 1, 0, 0.0);
    count += 1;
    
    for n in (3u64..=bound).step_by(2) {
        // Compute stopping time iteratively with path stack
        let mut x = n;
        let mut path: Vec<u64> = Vec::new();
        let mut steps: u32 = 0;
        
        while x != 1 {
            if x < CACHE_SIZE as u64 && arr[x as usize] > 0 {
                steps += arr[x as usize];
                break;
            }
            if let Some(&s) = map.get(&x) {
                steps += s;
                break;
            }
            path.push(x);
            if x % 2 == 0 { x >>= v2(x); }
            else { x = syracuse_step(x).0; }
        }
        
        // Fill cache for path values
        let mut s = steps;
        for &p in path.iter().rev() {
            s += 1;
            if p < CACHE_SIZE as u64 {
                arr[p as usize] = s;
            } else {
                map.insert(p, s);
            }
        }
        
        if s > best {
            best = s;
            count += 1;
            let bits = 64 - n.leading_zeros();
            let ratio = s as f64 / bits as f64;
            println!("  {:>14}  {:>6}  {:>8}  {:>10.4}", n, bits, s, ratio);
        }
        
        if n % 1_000_000_000 == 1 {
            let elapsed = t0.elapsed().as_secs_f64();
            eprintln!("  ... scanned to {} ({} records) in {:.0}s", n, count, elapsed);
        }
    }
    
    let elapsed = t0.elapsed().as_secs_f64();
    println!();
    println!("Found {} record-holders up to {} in {:.1}s", count, bound, elapsed);
}
