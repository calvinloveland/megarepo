"""Generate a truly-random ranch-economy inspiration pack from dictionary.csv.

Indices are drawn from os.urandom (not hand-picked); numeric parameters are
derived by hashing the drawn words, so item stats feel tied to their names.
--seed N makes a draw reproducible.
"""
import hashlib, os, random, sys, datetime

def load_words(path):
    words = []
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            w = line.strip().lower()
            if w and w.isalpha() and 3 <= len(w) <= 9:
                words.append(w)
    return list(dict.fromkeys(words))

WORDS = None

def pick(rng):
    return WORDS[rng.randrange(len(WORDS))]

def num(word, low, high):
    """Deterministic-ish random int in [low, high] from hashing the word."""
    h = int.from_bytes(hashlib.sha256(word.encode()).digest()[:4], "big")
    return low + (h % (high - low + 1))

STYLES = [
    "the_word",        # The Rampole
    "word_noun",       # Rampole Shed
    "word_noun_pl",    # Thistle Sheds
    "hyphen_blend",    # Slate-Vetch Stable (keep a few)
    "and_blend",       # Strike & Thistle
    "of_the",          # Salt of the Meadow
    "bare",            # Glimmer (flavor does the work)
    "double_word",     # Burrburr Gate (rare, punchy)
]


def blend(rng, noun):
    """Name with structure variety so the pack doesn't read as one template."""
    style = rng.choice(STYLES)
    a, b, c = pick(rng), pick(rng), pick(rng)
    if style == "the_word":
        return f"The {a.title()}"
    if style == "word_noun":
        return f"{a.title()} {noun}"
    if style == "word_noun_pl":
        pl = noun + ("s" if not noun.endswith("s") else "es")
        return f"{a.title()} {pl}"
    if style == "hyphen_blend":
        return f"{a.title()}-{b.title()} {noun}"
    if style == "and_blend":
        return f"{a.title()} & {b.title()}"
    if style == "of_the":
        return f"{a.title()} of the {b.title()}"
    if style == "bare":
        return f"{a.title()}"
    return f"{a.title()}{b.title()} {noun}"  # double_word


def cap(word):  # lazy title-case tolerating hyphens
    return word.capitalize()

def main(seed=None, count=8, out_prefix="economy"):
    global WORDS
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        import glob
        cands = glob.glob("/home/calvin/.fullautoci/repos/*_megarepo/archive/experiments/letterwords/dictionary.csv")
        cands += glob.glob("/home/calvin/.fullautoci/working_tree_snapshots/*/archive/experiments/letterwords/dictionary.csv")
        path = cands[0]
    WORDS = load_words(path)
    rng = random.Random(seed)

    noun_pool = ["Shed","Barn","Silo","Stall","Trough","Coop","Paddock","Gate","Cart","Kiln","Still",
                 "Rack","Loft","Tack","Rig","Lift","Hutch","Run","Lean-To","Feedbin"]
    effect_words = ["Muster","Curry","Shear","Brand","Groom","Feed","Mash","Gruel","Tincture","Salt-Lick"]

    lines = []
    lines.append(f"# Ranch economy inspiration — generated from dictionary.csv\n")
    lines.append(f"_Draw: {seed if seed is not None else 'unseeded (os.urandom)'} · {len(WORDS)} dictionary words · "
                 f"{datetime.datetime.utcnow().isoformat(timespec='seconds')}Z_")
    lines.append("")
    lines.append("## Upgrades (wallet sinks — 9 tiers, escalating costs)")
    lines.append("")
    lines.append("| Name | Flavor | Cost (cr) | Effect | Tier |")
    lines.append("|---|---|---:|---|---|")
    for i in range(count + 1):
        tier = i + 1
        noun = pick(rng)
        name = blend(rng, noun_pool[rng.randrange(len(noun_pool))])
        flavor_n = pick(rng)
        flavor = (f"\"{cap(flavor_n)} stamped on the ledger.\"" if tier == 1 else
                  f"Ranchers who bought in swear by the {pick(rng)} weaning.")
        cost = num(pick(rng), 25, 90) * tier * tier
        eff_type = ["population_cap", "retain_bonus", "mutation_control",
                    "race_duration", "hof_slots", "income_boost", "draft_bonus",
                    "wild_encounter_reroll", "faction_discount"][i % 9]
        eff = num(pick(rng), 5, 40)
        lines.append(f"| {name} | {flavor} | {cost} | +{eff} {eff_type} | {tier} |")
    lines.append("")

    lines.append("## Supplies & fodder (consumables)")
    lines.append("")
    lines.append("| Name | Flavor | Cost (cr) | Effect |")
    lines.append("|---|---|---:|---|")
    for i in range(6):
        word = pick(rng)
        name = blend(rng, ["Mash","Gruel","Curry","Tincture","Salve","Bale","Wad","Chip","Loaf","Nip"][i % 10])
        flavor = f"\"{cap(word)}\" — the old hands chew on it; the young stock love it."
        cost = num(pick(rng), 3, 24)
        eff = ["+sugar rush (1 race)","+draft calm (−10% wobble)","+stamina (+steps)","+grip wax","+muster edge","+lineage spark"][i % 6]
        lines.append(f"| {name} | {flavor} | {cost} | {eff} |")
    lines.append("")

    lines.append("## Biome storefront goods")
    lines.append("")
    lines.append("| Biome | Good | Cost (cr) | Flavor |")
    lines.append("|---|---|---:|---|")
    biomes = [("Grassland","meadow pasture"),("Flat","highway spec-herd"),("Sand","dune water rights"),
              ("Hills","vent leases"),("Rocky","quarry salvage claims"),("Ice","perimeter freight chits")]
    for bio, g in biomes:
        w = pick(rng)
        lines.append(f"| {bio} | {blend(rng, pick(rng))} | {num(pick(rng), 40, 160)} | \"{cap(w)}\" — {g} |")
    lines.append("")

    lines.append("## Tuning observations (from today's numbers)")
    lines.append("")
    lines.append("- Wallet income: `+floor(bestScore/50)` per generation; a 1620-score herd pays ~32 cr/gen.")
    lines.append("- Only real sink today: HOF rename (1 cr). Upgrades above give the wallet a campaign-length purpose.")
    lines.append("- Proposed sinks ~10× income: the most expensive upgrade ≈ 40 generations of a good herd;")
    lines.append("  consumables ≈ 1-2 generations each. Tune the table to taste.")

    md = "".join(l + "\n" for l in lines)
    prefix = out_prefix
    open(f"{prefix}-inspiration.md", "w", encoding="utf-8").write(md)

    # CSV for direct import
    effect_types = ["population_cap", "retain_bonus", "mutation_control", "race_duration",
                    "hof_slots", "income_boost", "draft_bonus", "wild_encounter_reroll", "faction_discount"]
    rows = ["name,flavor,cost_cr,effect,effect_value,tier,biome"]
    rng2 = random.Random((seed or 0) + 1)
    for i in range(count + 1):
        tiers = i + 1
        rows.append(f'"{blend(rng2, noun_pool[rng2.randrange(len(noun_pool))])}",'
                    f'"A {pick(rng2)}-grade addition to the ranch.",{num(pick(rng2),25,90)*tiers*tiers},'
                    f'{effect_types[i % len(effect_types)]},'
                    f'{num(pick(rng2),5,40)},{tiers},ranch')
    open(f"{prefix}-upgrades.csv", "w", encoding="utf-8").write("\n".join(rows) + "\n")
    print("wrote:", f"{out_prefix}-inspiration.md", f"{out_prefix}-upgrades.csv")

if __name__ == "__main__":
    seed = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else None
    main(seed=seed)
