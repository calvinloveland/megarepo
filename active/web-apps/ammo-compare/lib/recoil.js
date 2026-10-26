/**
 * Free recoil, derived instead of rated.
 *
 * The table used to store a hand-typed 1-5 "recoil" rating. That put .380 ACP
 * and 9mm Luger both at 2/5, and 28 of the 64 pistol loads at the same score,
 * which made the one criterion buyers weigh most the coarsest column in the
 * table. Recoil is physics, so it is computed here like everything else:
 *
 *   impulse (lbf·s) = bullet grains × fps / 7000
 *   energy  (ft·lb) = impulse² / (2 × gun mass in lb × g)
 *
 * A cartridge does not have a recoil; a cartridge *in a gun* does. The stored
 * value is therefore the free recoil energy in a reference gun for the load's
 * class, so rows stay comparable, and `recoilInGun()` scales it for any other
 * mass — halve the gun's weight and the energy doubles.
 *
 * Two deliberate simplifications, both stated on the page:
 *
 * - Propellant gas momentum is ignored. For pistol loads that is a few percent;
 *   for shotgun and magnum rifle loads it understates recoil by roughly a fifth
 *   to a third, because the powder charge leaves the muzzle fast.
 * - The reference gun is one typical mass per class, the same compromise the
 *   table already makes with barrel length. A .500 S&W is not fired from the
 *   same 2 lb pistol as a .25 ACP; the row detail says so.
 */

const GRAINS_PER_POUND = 7000;
const STANDARD_GRAVITY = 32.174;

/** Reference (empty, ready-to-fire) gun mass in pounds, per load class. */
export const REFERENCE_GUNS = {
  rimfire: { lb: 5, label: 'a 5 lb rimfire rifle' },
  pistol: { lb: 2, label: 'a 2 lb pistol' },
  rifle: { lb: 8, label: 'an 8 lb rifle' },
  shotgun: { lb: 7.5, label: 'a 7.5 lb shotgun' },
};

/**
 * Upper bounds in ft·lb for the five qualitative levels, matching the dot scale
 * the table has always shown. Fixed numbers rather than dataset quantiles, so a
 * dot keeps its meaning when rows are added.
 */
export const RECOIL_LEVELS = [0.5, 2, 5, 12];

export const FT_LB_TO_J = 1.3558179483314004;

/** Bullet momentum in lbf·s — the impulse the shoulder or hand has to absorb. */
export function recoilImpulse(load) {
  return (load.bulletGr * load.velocityFps) / GRAINS_PER_POUND;
}

/** Free recoil energy in ft·lb for this load fired from a gun of `gunLb`. */
export function recoilInGun(load, gunLb) {
  const impulse = recoilImpulse(load);
  return (impulse * impulse) / (2 * gunLb * STANDARD_GRAVITY);
}

/** 1-5 qualitative level for a recoil energy, for the dot scale. */
export function recoilLevel(energyFtLb) {
  let level = 1;
  for (const bound of RECOIL_LEVELS) {
    if (energyFtLb >= bound) level += 1;
  }
  return level;
}

/** Everything the table needs about a load's recoil. */
export function recoilProfile(load) {
  const gun = REFERENCE_GUNS[load.category] ?? REFERENCE_GUNS.rifle;
  const energyFtLb = recoilInGun(load, gun.lb);
  return {
    recoilFtLb: energyFtLb,
    recoilJoules: energyFtLb * FT_LB_TO_J,
    recoilImpulseLbfS: recoilImpulse(load),
    recoilGunLb: gun.lb,
    recoilGunLabel: gun.label,
    recoilLevel: recoilLevel(energyFtLb),
  };
}
