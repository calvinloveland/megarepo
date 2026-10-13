import Mathlib
open Nat

def v2 : Nat → Nat
| 0 => 0
| n + 1 => if (n + 1) % 2 = 0 then 1 + v2 ((n + 1) / 2) else 0

def oddPart (n : Nat) : Nat := n / (2 ^ v2 n)

def syracuse (n : Nat) : Nat := oddPart (3 * n + 1)

def syrIter (n : Nat) : Nat → Nat
| 0 => n
| m + 1 => syracuse (syrIter n m)

theorem v2_eq_zero_of_odd {n : Nat} (hn : n % 2 = 1) : v2 n = 0 := by
  cases n with
  | zero => omega
  | succ n =>
      by_cases h2 : (n + 1) % 2 = 0
      · rw [h2] at hn
        omega
      · simp [v2, h2]

theorem v2_two_mul_succ (n : Nat) : v2 (2 * (n + 1)) = 1 + v2 (n + 1) := by
  have hsucc : 2 * (n + 1) = Nat.succ (2 * n + 1) := by omega
  rw [hsucc]
  have hcond : Nat.succ (2 * n + 1) % 2 = 0 := by omega
  simp [v2, hcond]
  have hdiv : Nat.succ (2 * n + 1) / 2 = n + 1 := by omega
  rw [hdiv]
  simp [v2]

theorem v2_two_mul (n : Nat) (hn : n ≠ 0) : v2 (2 * n) = 1 + v2 n := by
  cases n with
  | zero => contradiction
  | succ n => exact v2_two_mul_succ n

theorem one_le_mul' (a b : Nat) (ha : 1 ≤ a) (hb : 1 ≤ b) : 1 ≤ a * b := by
  have h11 : 1 * 1 ≤ a * b := Nat.mul_le_mul ha hb
  simpa using h11

theorem three_mul_sub (a : Nat) (ha : 1 ≤ a) : 3 * (a - 1) + 1 = 3 * a - 2 := by
  rw [Nat.mul_sub_left_distrib]
  have h3 : 3 * 1 = 3 := by omega
  rw [h3]
  have h3le : 3 ≤ 3 * a := by omega
  have hdecomp : 3 * a = (3 * a - 3) + 3 := (Nat.sub_add_cancel h3le).symm
  omega

theorem two_mul_sub (a : Nat) : 2 * (a - 1) = 2 * a - 2 := by
  rw [Nat.mul_sub_left_distrib]

theorem odd_two_mul_sub_one (c : Nat) (hc : 1 ≤ c) :
    (2 * c - 1) % 2 = 1 := by
  have hdecomp : 2 * c - 1 = 2 * (c - 1) + 1 := by omega
  rw [hdecomp]
  rw [← Nat.mod_add_mod (2 * (c - 1)) 2 1]
  have hdvd : 2 ∣ 2 * (c - 1) := ⟨c - 1, by omega⟩
  rw [Nat.mod_eq_zero_of_dvd hdvd]

/-- GENERAL CLEAN GROWTH STEP (a ≥ 1, b ≥ 1) -/
theorem clean_step_general (a b : Nat) (ha : 1 ≤ a) (hb : 2 ≤ b) :
    syracuse (a * 2 ^ b - 1) = 3 * a * 2 ^ (b - 1) - 1 := by
  unfold syracuse oddPart
  have hpow : 2 ^ b = 2 * 2 ^ (b - 1) := by
    calc
      2 ^ b = 2 ^ ((b - 1) + 1) := by congr 1; omega
      _ = 2 ^ (b - 1) * 2 := by rw [pow_succ]
      _ = 2 * 2 ^ (b - 1) := by rw [Nat.mul_comm]
  have ha2 : 1 ≤ a * 2 ^ b := by
    exact one_le_mul' a (2 ^ b) ha (Nat.one_le_pow b 2 (by decide))
  have hL : 3 * (a * 2 ^ b - 1) + 1 = 3 * (a * 2 ^ b) - 2 := three_mul_sub _ ha2
  have hR : 2 * (3 * a * 2 ^ (b - 1) - 1) = 2 * (3 * a * 2 ^ (b - 1)) - 2 := two_mul_sub _
  have hmain : 3 * (a * 2 ^ b) = 2 * (3 * a * 2 ^ (b - 1)) := by
    rw [hpow]
    ring
  rw [hL]
  have hx2 : 3 * (a * 2 ^ b) - 2 = 2 * (3 * a * 2 ^ (b - 1) - 1) := by
    rw [hmain]
    rw [two_mul_sub]
  rw [hx2]
  have hodd : (3 * a * 2 ^ (b - 1) - 1) % 2 = 1 := by
    have hpos : 0 < 3 * a * 2 ^ (b - 1) := by positivity
    rcases (Nat.exists_eq_succ_of_ne_zero (by omega : b - 1 ≠ 0)) with ⟨c0, hc0⟩
    have hpow2 : 2 ^ (b - 1) = 2 * 2 ^ c0 := by
      rw [hc0, pow_succ]
      rw [Nat.mul_comm]
    have heven : 2 ∣ 3 * a * 2 ^ (b - 1) := by
      rw [hpow2]
      exact ⟨3 * a * 2 ^ c0, by ring⟩
    rcases heven with ⟨c, hc⟩
    have hc1 : 1 ≤ c := by
      rw [hc] at hpos
      omega
    have hdecomp : 3 * a * 2 ^ (b - 1) - 1 = 2 * c - 1 := by
      rw [hc]
    rw [hdecomp]
    exact odd_two_mul_sub_one c hc1
  have hv2 : v2 (2 * (3 * a * 2 ^ (b - 1) - 1)) = 1 := by
    rw [v2_two_mul _ (by omega : 3 * a * 2 ^ (b - 1) - 1 ≠ 0)]
    rw [v2_eq_zero_of_odd hodd]
  rw [hv2]
  norm_num
/-- GENERAL CLEAN GROWTH: syrIter(q·2^m − 1, j) = 3^j·q·2^(m−j) − 1 -/
theorem clean_growth_general (q m j : Nat) (hq : 1 ≤ q) (hj : j ≤ m - 1) :
    syrIter (q * 2 ^ m - 1) j = 3 ^ j * q * 2 ^ (m - j) - 1 := by
  induction j with
  | zero => simp [syrIter]
  | succ j ih =>
      have hj0 : j ≤ m - 1 := by omega
      have hb : 2 ≤ m - j := by omega
      have hq' : 1 ≤ 3 ^ j * q := by
        exact Nat.mul_le_mul (Nat.one_le_pow j 3 (by decide)) hq
      have hs := clean_step_general (3 ^ j * q) (m - j) hq' hb
      unfold syrIter
      rw [ih hj0]
      have h3 : 3 * (3 ^ j * q) = 3 ^ (j + 1) * q := by
        rw [pow_succ]
        ring
      have h2 : 2 ^ (m - j - 1) = 2 ^ (m - (j + 1)) := by
        congr 1
      calc
        syracuse (3 ^ j * q * 2 ^ (m - j) - 1) = syracuse ((3 ^ j * q) * 2 ^ (m - j) - 1) := by congr 1
        _ = 3 * (3 ^ j * q) * 2 ^ (m - j - 1) - 1 := hs
        _ = 3 ^ (j + 1) * q * 2 ^ (m - (j + 1)) - 1 := by
          rw [h3, h2]

/-- UNIVERSAL REDUCTION: after m clean steps, q·2^m − 1 reaches odd(3^m·q − 1) -/
theorem universal_reduction (q m : Nat) (hq : 1 ≤ q) (hm : 1 ≤ m) :
    syrIter (q * 2 ^ m - 1) m = oddPart (3 ^ m * q - 1) := by
  have hprev : syrIter (q * 2 ^ m - 1) (m - 1) = 3 ^ (m - 1) * q * 2 - 1 := by
    have hg := clean_growth_general q m (m - 1) hq (by omega)
    have hmm : m - (m - 1) = 1 := by omega
    rw [hmm] at hg
    exact hg
  have hrec : syrIter (q * 2 ^ m - 1) m = syracuse (syrIter (q * 2 ^ m - 1) (m - 1)) := by
    cases m with
    | zero => omega
    | succ m => simp [syrIter]
  rw [hrec]
  rw [hprev]
  have hpow : 3 * 3 ^ (m - 1) = 3 ^ m := by
    calc
      3 * 3 ^ (m - 1) = 3 ^ (m - 1) * 3 := by rw [Nat.mul_comm]
      _ = 3 ^ ((m - 1) + 1) := by rw [pow_succ]
      _ = 3 ^ m := by congr 1; omega
  have hx : 3 * (3 ^ (m - 1) * q * 2 - 1) + 1 = 2 * (3 ^ m * q - 1) := by
    have hL : 3 * ((3 ^ (m - 1) * q) * 2 - 1) + 1 = 3 * ((3 ^ (m - 1) * q) * 2) - 2 := by
      apply three_mul_sub
      exact one_le_mul' (3 ^ (m - 1) * q) 2
        (one_le_mul' (3 ^ (m - 1)) q (Nat.one_le_pow (m - 1) 3 (by decide)) hq) (by decide)
    have hR : 2 * (3 ^ m * q - 1) = 2 * (3 ^ m * q) - 2 := two_mul_sub _
    have hmain : 3 * ((3 ^ (m - 1) * q) * 2) = 2 * (3 ^ m * q) := by
      calc
        3 * ((3 ^ (m - 1) * q) * 2) = (3 * 3 ^ (m - 1)) * q * 2 := by ring
        _ = 3 ^ m * q * 2 := by rw [hpow]
        _ = 2 * (3 ^ m * q) := by ring
    rw [hL, hR, hmain]
  unfold syracuse oddPart
  rw [hx]
  have hv2 : v2 (2 * (3 ^ m * q - 1)) = 1 + v2 (3 ^ m * q - 1) := by
    rw [v2_two_mul _ (by omega : 3 ^ m * q - 1 ≠ 0)]
  rw [hv2]
  have hpow2 : 2 ^ (1 + v2 (3 ^ m * q - 1)) = 2 * 2 ^ v2 (3 ^ m * q - 1) := by
    rw [show 1 + v2 (3 ^ m * q - 1) = Nat.succ (v2 (3 ^ m * q - 1)) by omega]
    rw [pow_succ]
    rw [Nat.mul_comm]
  rw [hpow2]
  have hdiv : (2 * (3 ^ m * q - 1)) / (2 * 2 ^ v2 (3 ^ m * q - 1)) =
              (3 ^ m * q - 1) / 2 ^ v2 (3 ^ m * q - 1) := by
    rw [Nat.mul_div_mul_left]
    omega
  rw [hdiv]
