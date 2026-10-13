import Init
open Nat

def v2 : Nat → Nat
| 0 => 0
| n + 1 => if (n + 1) % 2 = 0 then 1 + v2 ((n + 1) / 2) else 0

theorem v2_eq_zero_of_odd {n : Nat} (hn : n % 2 = 1) : v2 n = 0 := by
  cases n with
  | zero => omega
  | succ n => simp [v2]; omega

def oddPart (n : Nat) : Nat := n / (2 ^ v2 n)
def syracuse (n : Nat) : Nat := oddPart (3 * n + 1)

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

theorem two_mul_assoc (a b : Nat) : 2 * (a * b) = a * (2 * b) := by
  rw [← Nat.mul_assoc]
  rw [Nat.mul_comm 2 a]
  rw [Nat.mul_assoc]

theorem one_le_mul' (a b : Nat) (ha : 1 ≤ a) (hb : 1 ≤ b) : 1 ≤ a * b := by
  have h11 : 1 * 1 ≤ a * b := Nat.mul_le_mul ha hb
  simpa using h11

theorem three_mul_sub (a : Nat) (ha : 1 ≤ a) : 3 * (a - 1) + 1 = 3 * a - 2 := by
  rw [Nat.mul_sub_left_distrib]
  have h3 : 3 * 1 = 3 := by omega
  rw [h3]
  have h3le : 3 ≤ 3 * a := by omega
  have hdecomp : 3 * a = (3 * a - 3) + 3 := (Nat.sub_add_cancel h3le).symm
  have : 3 * a - 2 = (3 * a - 3) + 1 := by omega
  omega

theorem two_mul_sub (a : Nat) : 2 * (a - 1) = 2 * a - 2 := by
  rw [Nat.mul_sub_left_distrib]

theorem clean_growth_big (j k : Nat) (h : j + 1 < k) :
    2 ≤ 3 ^ (j + 1) * 2 ^ (k - j - 1) := by
  have h31 : 2 ≤ 3 ^ (j + 1) := by
    rw [Nat.pow_succ]
    have h1 : 1 ≤ 3 ^ j := Nat.one_le_pow j 3 (by decide)
    have hm : 3 * 1 ≤ 3 * 3 ^ j := Nat.mul_le_mul (by omega : 3 ≤ 3) h1
    have h32 : 2 ≤ 3 * 1 := by decide
    have hm2 : 3 * 1 ≤ 3 * 3 ^ j := by simpa using hm
    omega
  have h2pow : 1 ≤ 2 ^ (k - j - 1) := Nat.one_le_pow (k - j - 1) 2 (by decide)
  have hm : 2 * 1 ≤ 3 ^ (j + 1) * 2 ^ (k - j - 1) := Nat.mul_le_mul h31 h2pow
  simpa using hm

-- The key algebraic identity
theorem clean_growth_id (j k : Nat) (h : j + 1 < k) :
    3 * (3 ^ j * 2 ^ (k - j) - 1) + 1 = 2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) := by
  have hmul3 : 3 * 3 ^ j = 3 ^ (j + 1) := by
    rw [Nat.pow_succ]
    omega
  have hpow2 : 2 ^ (k - j) = 2 * 2 ^ (k - j - 1) := by
    calc
      2 ^ (k - j) = 2 ^ ((k - j - 1) + 1) := by congr 1; omega
      _ = 2 ^ (k - j - 1) * 2 := by rw [Nat.pow_succ]
      _ = 2 * 2 ^ (k - j - 1) := by rw [Nat.mul_comm]
  have ha : 1 ≤ 3 ^ j * 2 ^ (k - j) := by
    exact one_le_mul' (3 ^ j) (2 ^ (k - j))
      (Nat.one_le_pow j 3 (by decide)) (Nat.one_le_pow (k - j) 2 (by decide))
  have hL : 3 * (3 ^ j * 2 ^ (k - j) - 1) + 1 = 3 ^ (j + 1) * 2 ^ (k - j) - 2 := by
    calc
      3 * (3 ^ j * 2 ^ (k - j) - 1) + 1 = 3 * (3 ^ j * 2 ^ (k - j)) - 2 := three_mul_sub _ ha
      _ = 3 ^ (j + 1) * 2 ^ (k - j) - 2 := by
        congr 1
        rw [← Nat.mul_assoc, hmul3]
  have hR : 2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) = 3 ^ (j + 1) * 2 ^ (k - j) - 2 := by
    calc
      2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) = 2 * (3 ^ (j + 1) * 2 ^ (k - j - 1)) - 2 := two_mul_sub _
      _ = 3 ^ (j + 1) * 2 ^ (k - j) - 2 := by
        congr 1
        calc
          2 * (3 ^ (j + 1) * 2 ^ (k - j - 1)) = 3 ^ (j + 1) * (2 * 2 ^ (k - j - 1)) := two_mul_assoc _ _
          _ = 3 ^ (j + 1) * 2 ^ (k - j) := by
            congr 1
            exact hpow2.symm
  rw [hL, hR]

-- The odd factor
theorem clean_growth_odd (j k : Nat) (h : j + 1 < k) :
    (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1) % 2 = 1 := by
  have h2 : 2 ∣ 2 ^ (k - j - 1) := by
    have : k - j - 1 = (k - j - 2) + 1 := by omega
    rw [this, Nat.pow_succ]
    exact ⟨2 ^ (k - j - 2), by rw [Nat.mul_comm]⟩
  have heven : 2 ∣ 3 ^ (j + 1) * 2 ^ (k - j - 1) := by
    rcases h2 with ⟨c, hc⟩
    refine ⟨3 ^ (j + 1) * c, ?_⟩
    rw [hc]
    exact (two_mul_assoc (3 ^ (j + 1)) c).symm
  rcases heven with ⟨c, hc⟩
  have hc1 : 1 ≤ c := by
    have hbig := clean_growth_big j k h
    rw [hc] at hbig
    omega
  have hdecomp : 3 ^ (j + 1) * 2 ^ (k - j - 1) - 1 = 2 * (c - 1) + 1 := by
    rw [hc]
    omega
  rw [hdecomp]
  have hdvd : 2 ∣ 2 * (c - 1) := ⟨c - 1, by omega⟩
  have hz : (2 * (c - 1)) % 2 = 0 := Nat.mod_eq_zero_of_dvd hdvd
  rw [← Nat.mod_add_mod (2 * (c - 1)) 2 1]
  rw [hz]

-- CLEAN GROWTH THEOREM
theorem clean_growth_step (j k : Nat) (h : j + 1 < k) :
    syracuse (3 ^ j * 2 ^ (k - j) - 1) = 3 ^ (j + 1) * 2 ^ (k - j - 1) - 1 := by
  unfold syracuse oddPart
  rw [clean_growth_id j k h]
  have hv2 : v2 (2 * (3 ^ (j + 1) * 2 ^ (k - j - 1) - 1)) = 1 := by
    have hne : 3 ^ (j + 1) * 2 ^ (k - j - 1) - 1 ≠ 0 := by
      have hbig := clean_growth_big j k h
      omega
    rw [v2_two_mul _ hne]
    rw [v2_eq_zero_of_odd (clean_growth_odd j k h)]
  rw [hv2]
  omega

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

/-- v2 of a power of two -/
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
