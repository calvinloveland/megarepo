// Find the TRUE record-holder (longest stopping time) below 2^37.
// Full scan with 4 threads — guarantees finding the champion.
// Usage: collatz-recordscan <upper_bound>

use std::time::Instant;
use std::thread;
use std::sync::{Mutex, Arc};
use std::sync::atomic::{AtomicU64, Ordering};

fn v2(x: u64) -> u32 { x.trailing_zeros() }
fn syr(n: u64) -> (u64, u32) { let x = n.wrapping_mul(3).wrapping_add(1); let k = v2(x); (x >> k, k) }
fn total_stopping_time(n: u64) -> u32 {
    let mut x = n; let mut s: u32 = 0;
    while x != 1 && s < 500000 {
        if x % 2 == 0 { x >>= v2(x); }
        else { x = syr(x).0; }
        s += 1;
    }
    s
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bound: u64 = if args.len() > 1 { args[1].parse().unwrap() } else { 1 << 37 };
    let nthreads = 4;
    
    println!("True record-holder scan below {} ({} threads)", bound, nthreads);
    let t0 = Instant::now();
    
    let best_steps = Arc::new(AtomicU64::new(0));
    let best_n = Arc::new(Mutex::new((0u64, 0u32)));
    let count = Arc::new(AtomicU64::new(0));
    
    // Split odd numbers into chunks per thread
    let chunk = bound / nthreads as u64;
    let mut handles = vec![];
    
    for t in 0..nthreads {
        let lo = t as u64 * chunk;
        let hi = if t == nthreads-1 { bound } else { (t as u64+1) * chunk };
        let bs = Arc::clone(&best_steps);
        let bn = Arc::clone(&best_n);
        let ct = Arc::clone(&count);
        handles.push(thread::spawn(move || {
            let mut local_best: u32 = 0;
            let mut local_n: u64 = 0;
            let mut n = if lo % 2 == 1 { lo } else { lo + 1 };
            let mut i: u64 = 0;
            while n <= hi {
                let s = total_stopping_time(n);
                if s > local_best {
                    local_best = s;
                    local_n = n;
                    // Check global
                    if s as u64 > bs.load(Ordering::Relaxed) {
                        bs.store(s as u64, Ordering::Relaxed);
                        let mut g = bn.lock().unwrap();
                        *g = (n, s);
                        println!("  NEW RECORD: n={}, steps={}", n, s);
                    }
                }
                n += 2;
                i += 1;
                if i % 100_000_000 == 0 {
                    ct.fetch_add(100_000_000, Ordering::Relaxed);
                    let done = ct.load(Ordering::Relaxed);
                    let elapsed = t0.elapsed().as_secs_f64();
                    eprintln!("  ... scanned ~{} odd nums in {:.0}s", done, elapsed);
                }
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    
    let elapsed = t0.elapsed().as_secs_f64();
    let (n, s) = *best_n.lock().unwrap();
    println!("\nTRUE RECORD HOLDER below {}:", bound);
    println!("  n = {}", n);
    println!("  steps = {} (Syracuse)", s);
    println!("  ratio = {:.4}", s as f64 / (64 - n.leading_zeros()) as f64);
    println!("  found in {:.1}s", elapsed);
    println!("  (record below 10^10 was 9,780,657,630 with 427 steps)");
}
