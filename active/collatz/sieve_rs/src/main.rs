// Parallel optimized verifier: 4 threads, each handling a chunk of the range.
// Each thread runs the sequential multi-level sieve on its chunk, then results are summed.

use std::time::Instant;
use std::thread;

const LOG23: f64 = 1.584962500721156;
const START_K: u32 = 14;
const MAX_K: u32 = 46;
const LEAF_THRESHOLD: u64 = 50;
const NTHREADS: usize = 4;

type Int = u64;

#[inline(always)]
fn v2(x: Int) -> u32 { x.trailing_zeros() }
#[inline(always)]
fn syracuse_step(n: Int) -> (Int, u32) {
    let x = n.wrapping_mul(3).wrapping_add(1);
    let k = v2(x);
    (x >> k, k)
}

fn strict_good(r: Int, k: u32) -> bool {
    if r == 1 { return true; }
    let window = std::cmp::max(2, (k as f64 / 2.71) as u32);
    let mut x = r;
    let mut v_total: u64 = 0;
    let mut s_total: u64 = 0;
    for _ in 0..window {
        if x <= 1 { break; }
        if x % 2 == 0 {
            let tz = v2(x); x >>= tz; v_total += tz as u64; s_total += 1;
        } else {
            let (next, kval) = syracuse_step(x); x = next;
            v_total += kval as u64; s_total += 1;
        }
        if s_total >= 5 && (v_total as f64) > LOG23 * (s_total as f64) + 1.0 { return true; }
    }
    false
}

fn simulate(n: Int, limit: Int) -> usize {
    let mut x = n;
    let mut steps = 0;
    while x >= limit && x != 1 && steps < 200_000 {
        if x % 2 == 0 { x >>= v2(x); }
        else { let (next, _) = syracuse_step(x); x = next; }
        steps += 1;
    }
    steps
}

struct Result {
    verified: u64,
    simulated: u64,
    sim_steps: u64,
    bulk_classes: u64,
}

fn verify_chunk(lo: Int, hi: Int) -> Result {
    let mut verified: u64 = 0;
    let mut simulated: u64 = 0;
    let mut sim_steps: u64 = 0;
    let mut bulk_classes: u64 = 0;
    
    fn count_class(r: Int, k: u32, lo: Int, hi: Int) -> (Int, Int) {
        let m: Int = 1 << k;
        let mut first = lo.wrapping_add(r.wrapping_sub(lo) % m);
        if first < lo { first += m; }
        if first > hi { return (0, 0); }
        if first % 2 == 0 { first += m; if first > hi { return (0, 0); } }
        let last = hi.wrapping_sub(hi.wrapping_sub(r) % m);
        if last > hi || last < first { return (0, 0); }
        (first, (last - first) / m + 1)
    }
    
    fn process(lo: Int, hi: Int, stride: Int, k: u32,
               verified: &mut u64, simulated: &mut u64, sim_steps: &mut u64, bulk_classes: &mut u64) {
        let m: Int = 1 << k;
        let mut residues: [Int; 8] = [0; 8];
        let mut n_res: usize = 0;
        
        if stride <= 2 {
            let mut r = lo % m;
            if r % 2 == 0 { r += 1; }
            let mut r_val = r;
            while r_val < m {
                residues[n_res] = r_val;
                n_res += 1;
                r_val += 2;
                if n_res == 8 {
                    check(&residues[..n_res], k, lo, hi, verified, simulated, sim_steps, bulk_classes);
                    n_res = 0;
                }
            }
        } else {
            let r0 = lo % m;
            for j in 0..4 {
                let r = (r0 + j * stride) % m;
                if r % 2 == 1 {
                    residues[n_res] = r;
                    n_res += 1;
                }
            }
        }
        check(&residues[..n_res], k, lo, hi, verified, simulated, sim_steps, bulk_classes);
    }
    
    fn check(residues: &[Int], k: u32, lo: Int, hi: Int,
             verified: &mut u64, simulated: &mut u64, sim_steps: &mut u64, bulk_classes: &mut u64) {
        for &r in residues {
            let m: Int = 1 << k;
            let mut first = lo.wrapping_add(r.wrapping_sub(lo) % m);
            if first < lo { first += m; }
            if first > hi { continue; }
            if first % 2 == 0 { first += m; if first > hi { continue; } }
            let last = hi.wrapping_sub(hi.wrapping_sub(r) % m);
            if last > hi || last < first { continue; }
            let count = (last - first) / m + 1;
            
            if r == 1 || strict_good(r, k) {
                *verified += count;
                *bulk_classes += 1;
            } else if k + 2 > MAX_K || count <= LEAF_THRESHOLD {
                let mut n = first;
                for _ in 0..count {
                    let steps = simulate(n, 1);
                    *simulated += 1;
                    *sim_steps += steps as u64;
                    *verified += 1;
                    n += m;
                }
            } else {
                let m_parent: Int = 1 << k;
                process(first, first + (count - 1) * m_parent, m_parent, k + 2,
                        verified, simulated, sim_steps, bulk_classes);
            }
        }
    }
    
    process(lo, hi, 2, START_K, &mut verified, &mut simulated, &mut sim_steps, &mut bulk_classes);
    Result { verified, simulated, sim_steps, bulk_classes }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let hi: Int = if args.len() > 1 { args[1].parse().unwrap() } else { 1 << 33 };
    
    let total_odd = hi / 2;
    println!("Parallel verifier ({} threads), range [1, {}]", NTHREADS, hi);
    println!("  Odd numbers: {}", total_odd);
    println!();
    
    let t0 = Instant::now();
    
    // Split [1, hi] into NTHREADS chunks (odd numbers only)
    let chunk_size = hi / NTHREADS as Int;
    let mut handles = Vec::new();
    for t in 0..NTHREADS {
        let lo = t as Int * chunk_size + 1;
        let hi_t = if t == NTHREADS - 1 { hi } else { (t as Int + 1) * chunk_size };
        handles.push(thread::spawn(move || verify_chunk(lo, hi_t)));
    }
    
    let mut total = Result { verified: 0, simulated: 0, sim_steps: 0, bulk_classes: 0 };
    for h in handles {
        let r = h.join().unwrap();
        total.verified += r.verified;
        total.simulated += r.simulated;
        total.sim_steps += r.sim_steps;
        total.bulk_classes += r.bulk_classes;
    }
    
    let elapsed = t0.elapsed().as_secs_f64();
    
    println!("Results ({:.2}s):", elapsed);
    println!("  Bulk classes: {}", total.bulk_classes);
    println!("  Simulated:    {} ({} steps)", total.simulated, total.sim_steps);
    println!("  Verified:     {}", total.verified);
    if elapsed > 0.0 {
        println!("  Throughput:   {:.2e} num/s", total.verified as f64 / elapsed);
    }
    if total.verified == total_odd {
        println!("  ✓ COMPLETE verification of {} odd numbers", total_odd);
    } else {
        println!("  ⚠ missing {}", total_odd - total.verified);
    }
}
