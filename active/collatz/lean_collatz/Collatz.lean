import Init

open Nat

/-- 2-adic valuation -/
def v2 : Nat → Nat
| 0 => 0
| n + 1 => if (n + 1) % 2 = 0 then 1 + v2 ((n + 1) / 2) else 0

/-- v2 of an odd number is 0 -/
theorem v2_eq_zero_of_odd {n : Nat} (hn : n % 2 = 1) : v2 n = 0 := by
  cases n with
  | zero => omega
  | succ n =>
      simp [v2]
      omega

/-- odd part -/
def oddPart (n : Nat) : Nat := n / (2 ^ v2 n)

/-- Syracuse map -/
def syracuse (n : Nat) : Nat := oddPart (3 * n + 1)

/-- 4^m ≡ 1 (mod 3) -/
theorem four_pow_mod_three (m : Nat) : (4 ^ m) % 3 = 1 := by
  induction m with
  | zero => decide
  | succ m ih =>
      rw [Nat.pow_succ, Nat.mul_mod, ih]

/-- 4^m = 3*(4^m/3) + 1 -/
theorem four_pow_decomp (m : Nat) : 3 * (4 ^ m / 3) + 1 = 4 ^ m := by
  have hdm := Nat.div_add_mod (4 ^ m) 3
  rw [four_pow_mod_three] at hdm
  exact hdm

/-- 3 divides 4^m - 1 -/
theorem three_dvd_four_pow_sub (m : Nat) : 3 ∣ 4 ^ m - 1 := by
  have hsub : 4 ^ m - 1 = 3 * (4 ^ m / 3) := by
    exact Nat.sub_eq_of_eq_add (four_pow_decomp m).symm
  exact ⟨4 ^ m / 3, hsub⟩

/-- ALTERNATING FAMILY IDENTITY -/
theorem alternating_identity (m : Nat) : 3 * ((4 ^ m - 1) / 3) + 1 = 4 ^ m := by
  have hdiv : 3 ∣ 4 ^ m - 1 := three_dvd_four_pow_sub m
  have hmdc : 3 * ((4 ^ m - 1) / 3) = 4 ^ m - 1 := Nat.mul_div_cancel' hdiv
  rw [hmdc]
  have hle : 1 ≤ 4 ^ m := by
    exact Nat.one_le_pow m 4 (by decide)
  exact Nat.sub_add_cancel hle

/-- 4^m = 2^(2m) -/
theorem four_pow_eq (m : Nat) : 4 ^ m = 2 ^ (2 * m) := by
  rw [show 4 = 2 ^ 2 by decide]
  rw [← Nat.pow_mul]

/-- v2(2 * (n+1)) = 1 + v2(n+1) -/
theorem v2_two_mul_succ (n : Nat) : v2 (2 * (n + 1)) = 1 + v2 (n + 1) := by
  have hsucc : 2 * (n + 1) = Nat.succ (2 * n + 1) := by omega
  rw [hsucc]
  have hcond : Nat.succ (2 * n + 1) % 2 = 0 := by omega
  simp [v2, hcond]
  have hdiv : Nat.succ (2 * n + 1) / 2 = n + 1 := by omega
  rw [hdiv]
  simp [v2]

/-- v2(2 * n) = 1 + v2(n) for n ≠ 0 -/
theorem v2_two_mul (n : Nat) (hn : n ≠ 0) : v2 (2 * n) = 1 + v2 n := by
  cases n with
  | zero => contradiction
  | succ n =>
      -- 2 * (n+1) = 2*(n+1)
      exact v2_two_mul_succ n

/-- v2 of a power of two: v2(2^k) = k -/
theorem v2_pow_two (k : Nat) : v2 (2 ^ k) = k := by
  induction k with
  | zero => simp [v2]
  | succ k ih =>
      have hpow : 2 ^ (k + 1) = 2 * 2 ^ k := by
        rw [Nat.pow_succ]
        omega
      rw [hpow]
      rw [v2_two_mul (2 ^ k) (Nat.ne_of_gt (Nat.pow_pos (by decide : 0 < 2)))]
      rw [ih]
      omega

/-- ALTERNATING FAMILY: (4^m-1)/3 reaches 1 in one step -/
theorem alternating_family (m : Nat) : syracuse ((4 ^ m - 1) / 3) = 1 := by
  unfold syracuse oddPart
  rw [alternating_identity]
  rw [four_pow_eq]
  rw [v2_pow_two]
  exact Nat.div_self (Nat.pow_pos (by decide))

/-- CLEAN GROWTH: the Syracuse step preserves the pattern
   3^j * 2^(k-j) - 1  ->  3^(j+1) * 2^(k-j-1) - 1  (when j+1 < k)
   This is the core of the all-1s reduction: 2^k - 1 climbs via
   clean (×3/2) steps for k steps. -/
theorem clean_growth_step (j k : Nat) (h : j + 1 < k) :
    syracuse (3 ^ j * 2 ^ (k - j) - 1) = 3 ^ (j + 1) * 2 ^ (k - j - 1) - 1 := by
  unfold syracuse oddPart
  -- Key algebraic identity
  have hx : 3 * (3 ^ j * 2 ^ (k - j) - 1) + 1 = 2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) := by
    have hmul3 : 3 * 3 ^ j = 3 ^ (j + 1) := by
      rw [Nat.pow_succ]
      omega
    have hpow2 : 2 ^ (k - j) = 2 * 2 ^ (k - j - 1) := by
      have : k - j = (k - j - 1) + 1 := by omega
      rw [this]
      rw [Nat.pow_succ]
      omega
    rw [Nat.mul_sub_left_distrib]
    rw [hmul3]
    rw [hpow2]
    omega
  -- The factor 3^(j+1)*2^(k-j-1) - 1 is odd
  have hodd : (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) % 2 = 1 := by
    have heven : 2 ∣ 3 ^ (j + 1) * 2 ^ (k - j - 1) := by
      use 3 ^ (j + 1) * 2 ^ (k - j - 1 - 1)
      -- 2 * (3^(j+1) * 2^(k-j-2)) = 3^(j+1) * 2^(k-j-1)
      have : k - j - 1 = (k - j - 1 - 1) + 1 := by omega
      rw [this]
      rw [Nat.pow_succ]
      omega
    omega
  rw [hx]
  -- v2(2 * odd) = 1
  have hv2 : v2 (2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1)) = 1 := by
    have hne : 3 ^ (j + 1) * 2 ^ (k - j - 1) - 1 ≠ 0 := by
      omega
    rw [v2_two_mul _ hne]
    rw [v2_eq_zero_of_odd hodd]
    omega
  rw [hv2]
  -- (2 * odd) / 2 = odd
  simp
  omega
