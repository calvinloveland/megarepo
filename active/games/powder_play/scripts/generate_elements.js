#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const elements = [
  /* 1-79 */
  "Hydrogen","Helium","Lithium","Beryllium","Boron","Carbon","Nitrogen","Oxygen","Fluorine","Neon",
  "Sodium","Magnesium","Aluminum","Silicon","Phosphorus","Sulfur","Chlorine","Argon","Potassium","Calcium",
  "Scandium","Titanium","Vanadium","Chromium","Manganese","Iron","Cobalt","Nickel","Copper","Zinc",
  "Gallium","Germanium","Arsenic","Selenium","Bromine","Krypton","Rubidium","Strontium","Yttrium","Zirconium",
  "Niobium","Molybdenum","Technetium","Ruthenium","Rhodium","Palladium","Silver","Cadmium","Indium","Tin",
  "Antimony","Tellurium","Iodine","Xenon","Cesium","Barium","Lanthanum","Cerium","Praseodymium","Neodymium",
  "Promethium","Samarium","Europium","Gadolinium","Terbium","Dysprosium","Holmium","Erbium","Thulium","Ytterbium",
  "Lutetium","Hafnium","Tantalum","Tungsten","Rhenium","Osmium","Iridium","Platinum","Gold"
];

const outDir = path.join(__dirname, '..', 'materials');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function colorForName(name) {
  // Simple deterministic color by name hashing
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const seed = Math.abs(h);
  const r = 60 + (seed % 180);
  const g = 60 + ((seed >> 8) % 180);
  const b = 60 + ((seed >> 16) % 180);
  return [r, g, b];
}

function tagForElement(atomic) {
  // choose gas for noble gases and first elements
  const gases = new Set([2,10,18,36,54]);
  if (gases.has(atomic)) return ["element", "float"];
  if (atomic === 35) return ["element", "flow"]; // Bromine is a liquid
  if (atomic === 80) return ["element", "flow"]; // Mercury would be flow but is >79
  // metal-ish heuristics: many elements after 11 are metals
  if (atomic >= 11 && atomic !== 35 && atomic !== 14 && atomic !== 15 && atomic !== 16 && atomic !== 17)
    return ["element", "static"];
  // some nonmetals
  const nonmetals = new Set([1,5,6,7,8,9,15,16,17,34,53]);
  if (nonmetals.has(atomic)) return ["element", "static"];
  return ["element", "static"];
}

elements.forEach((name, idx) => {
  const atomic = idx + 1;
  const file = path.join(outDir, `${name.toLowerCase()}.json`);
  const obj = {
    type: "material",
    name: name,
    description: `${name} (element ${atomic})`,
    color: colorForName(name),
    density: Math.max(0.1, Math.round((atomic * 0.8 + (atomic % 5)) * 100) / 100),
    tags: tagForElement(atomic),
    atomicNumber: atomic
  };
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  console.log("wrote", file);
});

console.log('Generated', elements.length, 'element materials.');
