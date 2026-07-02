// data.js — Game constants, component definitions, static data
// ====================================================================

const DATA = {

  // ---- Component Catalogue (unlock by year) ----

  components: {
    // ---- DRUM (inner tub) ----
    drum: {
      label: 'Drum',
      options: [
        // 1945: Post-war enamel-on-steel — basic but gets the job done
        { id: 'porcelain',   name: 'Porcelain Enamel',    cost: 10, durability: 0.35, noise: 0.6, rustResistance: 0.40, weight: 0.7, marketingAppeal: 0.10, yearAvailable: 1945, description: 'Standard post-war enamel tub. Heavy, chips over time, but cheap.' },
        // 1945: Galvanised steel — the budget wartime holdover
        { id: 'galvanised',  name: 'Galvanised Steel',    cost: 6,  durability: 0.20, noise: 0.8, rustResistance: 0.25, weight: 0.6, marketingAppeal: 0.05, yearAvailable: 1945, description: 'Wartime surplus steel. Rusts quickly, noisy — barely adequate.' },
        // 1955: Stainless becomes the aspirational standard
        { id: 'stainless',   name: 'Stainless Steel',     cost: 30, durability: 0.65, noise: 0.4, rustResistance: 0.85, weight: 0.6, marketingAppeal: 0.45, yearAvailable: 1955, techDependency: 'Automatic Revolution', description: 'The post-war industry standard — good balance of cost and quality.' },
        // 1972: Plastic inner tubs (lighter, cheaper, no rust)
        { id: 'polypropylene',name: 'Polypropylene',      cost: 18, durability: 0.40, noise: 0.5, rustResistance: 0.95, weight: 0.2, marketingAppeal: 0.20, yearAvailable: 1972, techDependency: 'Compact Living', description: 'Lightweight polymer tub. No rust, quieter, less durable than steel.' },
        // 1985: Reinforced stainless for premium machines
        { id: 'reinforced',  name: 'Reinforced Stainless',cost: 55, durability: 0.92, noise: 0.25, rustResistance: 0.95, weight: 0.8, marketingAppeal: 0.65, yearAvailable: 1985, techDependency: 'Electronic Controls', description: 'Premium drum — near-indestructible, silent, heavy.' },
        // 2010: Advanced composites for high-end machines
        { id: 'composite',   name: 'Carbon Composite',   cost: 70, durability: 0.85, noise: 0.20, rustResistance: 0.98, weight: 0.35, marketingAppeal: 0.85, yearAvailable: 2010, techDependency: 'AI & IoT', description: 'Space-age composite drum. Light, silent, corrosion-proof.' },
      ],
    },

    // ---- MOTOR ----
    motor: {
      label: 'Motor',
      options: [
        // 1945: Universal brushed motor — the workhorse of early appliances
        { id: 'universal',   name: 'Universal Brushed',  cost: 16, durability: 0.30, noise: 0.7, energyEfficiency: 0.22, repairCost: 0.3, marketingAppeal: 0.05, yearAvailable: 1945, description: 'The original appliance motor. Brushes wear out, runs hot, noisy.' },
        // 1955: Induction motor — more reliable, less noise
        { id: 'induction',   name: 'Split-Phase Induction', cost: 28, durability: 0.50, noise: 0.5, energyEfficiency: 0.38, repairCost: 0.4, marketingAppeal: 0.15, yearAvailable: 1955, techDependency: 'Automatic Revolution', description: 'Reliable induction motor. Fewer moving parts, runs cooler.' },
        // 1970: Permanent split capacitor — more efficient
        { id: 'psc',         name: 'PSC Motor',          cost: 38, durability: 0.65, noise: 0.4, energyEfficiency: 0.55, repairCost: 0.5, marketingAppeal: 0.25, yearAvailable: 1970, techDependency: 'Compact Living', description: 'Permanent split capacitor motor. Good efficiency, smooth operation.' },
        // 1988: Brushless DC — the quiet revolution
        { id: 'brushless',   name: 'Brushless DC',       cost: 55, durability: 0.78, noise: 0.20, energyEfficiency: 0.72, repairCost: 0.6, marketingAppeal: 0.50, yearAvailable: 1988, techDependency: 'Fuzzy Logic', description: 'Efficient and quiet — became viable in the late 80s.' },
        // 2005: Direct drive — fewer parts, near-silent
        { id: 'directdrive', name: 'Direct Drive Inverter', cost: 85, durability: 0.92, noise: 0.10, energyEfficiency: 0.88, repairCost: 0.8, marketingAppeal: 0.75, yearAvailable: 2005, techDependency: 'Smart Connectivity', description: 'Premium — near-silent, extremely reliable, expensive.' },
      ],
    },

    // ---- PUMP ----
    pump: {
      label: 'Pump',
      options: [
        // 1945: Gravity drain — no pump, just a hose to the sink
        { id: 'gravity',     name: 'Gravity Drain',      cost: 3,  durability: 0.55, noise: 0.0, flowRate: 0.20, repairCost: 0.1, marketingAppeal: 0.0, yearAvailable: 1945, description: 'No pump needed — water drains by gravity into a sink. Limited placement.' },
        // 1955: Belt-driven centrifugal pump
        { id: 'beltPump',    name: 'Belt-Driven Pump',   cost: 10, durability: 0.50, noise: 0.6, flowRate: 0.45, repairCost: 0.3, marketingAppeal: 0.05, yearAvailable: 1955, techDependency: 'Automatic Revolution', description: 'Belt-driven centrifugal. Clogs sometimes, belt wears out.' },
        // 1970: Direct-drive centrifugal pump
        { id: 'standard',    name: 'Standard Pump',      cost: 18, durability: 0.68, noise: 0.4, flowRate: 0.60, repairCost: 0.5, marketingAppeal: 0.20, yearAvailable: 1970, techDependency: 'Compact Living', description: 'Reliable enough for most households.' },
        // 1985: High-flow industrial pump
        { id: 'industrial',  name: 'Industrial Pump',    cost: 40, durability: 0.92, noise: 0.3, flowRate: 0.90, repairCost: 0.8, marketingAppeal: 0.30, yearAvailable: 1985, techDependency: 'Electronic Controls', description: 'Built for laundromats and high-use homes.' },
      ],
    },

    // ---- BEARINGS ----
    bearings: {
      label: 'Bearings',
      options: [
        // 1945: Simple bronze bushings — primitive
        { id: 'bronze',      name: 'Bronze Bushings',    cost: 3,  durability: 0.15, noise: 0.9, catastrophicFailRate: 0.35, marketingAppeal: 0.0, yearAvailable: 1945, description: 'Basic bronze bushings — need constant lubrication, fail catastrophically.' },
        // 1945: Standard sealed bearings (post-war surplus)
        { id: 'standard',    name: 'Standard Sealed',    cost: 10, durability: 0.45, noise: 0.5, catastrophicFailRate: 0.15, marketingAppeal: 0.05, yearAvailable: 1945, description: 'Post-war sealed bearings. Acceptable lifespan for average use.' },
        // 1965: Premium bearings for better machines
        { id: 'premium',     name: 'Premium Sealed',     cost: 25, durability: 0.75, noise: 0.30, catastrophicFailRate: 0.06, marketingAppeal: 0.25, yearAvailable: 1965, techDependency: 'Multiple Cycles', description: 'Better tolerances, smoother operation — a worthy upgrade.' },
        // 1985: High-density ceramic hybrid
        { id: 'hybrid',      name: 'Ceramic Hybrid',     cost: 45, durability: 0.92, noise: 0.15, catastrophicFailRate: 0.02, marketingAppeal: 0.50, yearAvailable: 1985, techDependency: 'Electronic Controls', description: 'Ceramic balls, steel races — the best investment you can make.' },
        // 2015: Magnetic levitation
        { id: 'magnetic',    name: 'Magnetic Levitation',cost: 80, durability: 0.98, noise: 0.05, catastrophicFailRate: 0.005, marketingAppeal: 0.75, yearAvailable: 2015, techDependency: 'AI & IoT', description: 'No contact, no wear, no noise — futuristic.' },
      ],
    },

    // ---- SUSPENSION ----
    suspension: {
      label: 'Suspension',
      options: [
        // 1945: Simple leaf springs — the machine walks
        { id: 'leaf',        name: 'Leaf Springs',       cost: 4,  durability: 0.20, vibrationDampening: 0.15, marketingAppeal: 0.0, yearAvailable: 1945, description: 'Simple steel leaves. Machines "walk" across the floor during spin.' },
        // 1955: Coil springs — some improvement
        { id: 'coil',        name: 'Coil Springs',       cost: 10, durability: 0.40, vibrationDampening: 0.35, marketingAppeal: 0.10, yearAvailable: 1955, techDependency: 'High-Spin Era', description: 'Coil springs reduce walking but vibration is still noticeable.' },
        // 1970: Torsion bar suspension
        { id: 'torsion',     name: 'Torsion Bar',        cost: 18, durability: 0.60, vibrationDampening: 0.55, marketingAppeal: 0.20, yearAvailable: 1970, techDependency: 'Compact Living', description: 'Torsion bars keep things steady in most homes.' },
        // 1995: Hydraulic dampers
        { id: 'hydraulic',   name: 'Hydraulic Dampers',  cost: 38, durability: 0.72, vibrationDampening: 0.82, marketingAppeal: 0.45, yearAvailable: 1995, techDependency: 'Fuzzy Logic', description: 'Oil-filled dampers absorb most vibration.' },
        // 2018: Active electronic suspension
        { id: 'active',      name: 'Active Suspension',  cost: 65, durability: 0.85, vibrationDampening: 0.98, marketingAppeal: 0.70, yearAvailable: 2018, techDependency: 'AI & IoT', description: 'Electronic sensors cancel vibration in real-time — rock solid.' },
      ],
    },

    // ---- CONTROL BOARD ----
    controlBoard: {
      label: 'Control Board',
      options: [
        // 1945: Electro-mechanical timer — the classic rotating dial
        { id: 'timer',       name: 'Mechanical Timer',   cost: 8,  durability: 0.90, failureRate: 0.10, smartFeatures: 0.0, marketingAppeal: 0.05, yearAvailable: 1945, description: 'Rotating dial with a synchronous motor. Simple, repairable, bulletproof.' },
        // 1957: Electro-mechanical with more cycles
        { id: 'multicam',    name: 'Multi-Cam Timer',    cost: 15, durability: 0.80, failureRate: 0.15, smartFeatures: 0.05, marketingAppeal: 0.15, yearAvailable: 1957, techDependency: 'High-Spin Era', description: 'Multiple cams for wash/spin/rinse cycles — still mechanical.' },
        // 1975: Push-button electronic
        { id: 'pushButton',  name: 'Push-Button Panel',  cost: 25, durability: 0.70, failureRate: 0.20, smartFeatures: 0.15, marketingAppeal: 0.35, yearAvailable: 1975, techDependency: 'Compact Living', description: 'Solid-state timers with push-button cycle selection.' },
        // 1988: Digital display
        { id: 'digital',     name: 'Digital Display',    cost: 38, durability: 0.55, failureRate: 0.28, smartFeatures: 0.35, marketingAppeal: 0.55, yearAvailable: 1988, techDependency: 'Fuzzy Logic', description: 'LCD screen + sensors. More features, more to break.' },
        // 2005: Smart WiFi-enabled
        { id: 'smart',       name: 'Smart WiFi',         cost: 60, durability: 0.45, failureRate: 0.38, smartFeatures: 0.72, marketingAppeal: 0.75, yearAvailable: 2005, techDependency: 'Smart Connectivity', description: 'App control, diagnostics, OTA updates — and OTA failures.' },
        // 2018: AI load sensing
        { id: 'ai',          name: 'AI Load Sensing',    cost: 85, durability: 0.40, failureRate: 0.45, smartFeatures: 0.95, marketingAppeal: 0.90, yearAvailable: 2018, techDependency: 'AI & IoT', description: 'Adjusts every cycle automatically — cutting-edge.' },
      ],
    },

    // ---- EXTERIOR ----
    exterior: {
      label: 'Exterior / Interface',
      options: [
        // 1945: Basic utilitarian white
        { id: 'white',       name: 'Basic White',        cost: 6,  marketingAppeal: 0.08, yearAvailable: 1945, description: 'Functional white box. It washes clothes.' },
        // 1950: Chrome trim for post-war optimism
        { id: 'chrome',      name: 'Chrome Trim',        cost: 14, marketingAppeal: 0.25, yearAvailable: 1950, techDependency: 'Automatic Revolution', description: 'Shiny chrome accents — looks modern in any kitchen.' },
        // 1965: Color — harvest gold, avocado green
        { id: 'color',       name: 'Designer Colors',    cost: 20, marketingAppeal: 0.38, yearAvailable: 1965, techDependency: 'Multiple Cycles', description: 'Harvest gold, avocado green — match your kitchen decor!' },
        // 1988: Glass door
        { id: 'glassDoor',   name: 'Glass Door + Display',cost: 35, marketingAppeal: 0.60, yearAvailable: 1988, techDependency: 'Fuzzy Logic', description: 'See the wash in action — sells well.' },
        // 2005: Premium finish
        { id: 'premium',     name: 'Premium Finish + LED',cost: 55, marketingAppeal: 0.82, yearAvailable: 2005, techDependency: 'Smart Connectivity', description: 'Designer looks, customizable colors, lighting.' },
      ],
    },
  },

  // ---- Customer Archetypes ----

  customerTypes: [
    // === POST-WWII ERA (1945-1960) ===
    {
      id: 'returningVet',
      name: 'Returning GI',
      description: 'Ex-serviceman starting a family. Wants reliability, knows nothing about appliances.',
      minYear: 1945,
      maxYear: 1960,
      loadsPerWeek: 4,
      wearFactor: 1.0,
      priceSensitivity: 0.6,
      qualitySensitivity: 0.5,
      noiseSensitivity: 0.3,
      smartFeaturePreference: 0.0,
      brandLoyalty: 0.7,
      patienceForRepairs: 0.7,
      probabilityWeight: 15,
    },
    {
      id: 'suburbanHomemaker',
      name: 'Suburban Homemaker',
      description: '1950s housewife in a new subdivision. Wants the latest automatic washer to keep up with the neighbors.',
      minYear: 1948,
      maxYear: 1975,
      loadsPerWeek: 8,
      wearFactor: 1.2,
      priceSensitivity: 0.4,
      qualitySensitivity: 0.7,
      noiseSensitivity: 0.3,
      smartFeaturePreference: 0.1,
      brandLoyalty: 0.6,
      patienceForRepairs: 0.6,
      probabilityWeight: 20,
    },
    // === 1960s-1980s (family boom) ===
    {
      id: 'family',
      name: 'Family of Five',
      description: 'Heavy daily use, kids, pets. The classic suburban family — 3+ loads a day.',
      minYear: 1945,
      loadsPerWeek: 15,
      wearFactor: 1.5,
      priceSensitivity: 0.5,
      qualitySensitivity: 0.7,
      noiseSensitivity: 0.5,
      smartFeaturePreference: 0.25,
      brandLoyalty: 0.5,
      patienceForRepairs: 0.5,
      probabilityWeight: 28,
    },
    {
      id: 'bachelor',
      name: 'Bachelor',
      description: 'Single professional. Light use, minimal maintenance, buys on price.',
      minYear: 1945,
      loadsPerWeek: 2,
      wearFactor: 0.8,
      priceSensitivity: 0.7,
      qualitySensitivity: 0.3,
      noiseSensitivity: 0.4,
      smartFeaturePreference: 0.15,
      brandLoyalty: 0.3,
      patienceForRepairs: 0.7,
      probabilityWeight: 18,
    },
    // === 1970s-1990s (apartments, dual-income) ===
    {
      id: 'singleParent',
      name: 'Single Working Parent',
      description: 'Balancing job and kids. Needs a reliable machine that can handle heavy weekend loads.',
      minYear: 1965,
      loadsPerWeek: 10,
      wearFactor: 1.4,
      priceSensitivity: 0.7,
      qualitySensitivity: 0.6,
      noiseSensitivity: 0.4,
      smartFeaturePreference: 0.3,
      brandLoyalty: 0.4,
      patienceForRepairs: 0.4,
      probabilityWeight: 18,
    },
    {
      id: 'apartmentDweller',
      name: 'Apartment Dweller',
      description: 'Small space, shared laundry or compact stacked unit. Quiet operation is critical.',
      minYear: 1965,
      loadsPerWeek: 3,
      wearFactor: 0.7,
      priceSensitivity: 0.5,
      qualitySensitivity: 0.5,
      noiseSensitivity: 0.85,
      smartFeaturePreference: 0.3,
      brandLoyalty: 0.25,
      patienceForRepairs: 0.4,
      probabilityWeight: 20,
    },
    // === 1990s-2010s (eco, premium, niche) ===
    {
      id: 'emptyNester',
      name: 'Empty Nesters',
      description: 'Grown kids moved out. Moderate use, value quality and quiet — willing to pay for premium.',
      minYear: 1970,
      loadsPerWeek: 5,
      wearFactor: 0.9,
      priceSensitivity: 0.35,
      qualitySensitivity: 0.85,
      noiseSensitivity: 0.8,
      smartFeaturePreference: 0.25,
      brandLoyalty: 0.6,
      patienceForRepairs: 0.6,
      probabilityWeight: 15,
    },
    {
      id: 'ecoWarrior',
      name: 'Eco-Conscious',
      description: 'Low water/energy usage is critical. Buys HE machines, cold-wash advocate.',
      minYear: 1978,
      loadsPerWeek: 6,
      wearFactor: 0.9,
      priceSensitivity: 0.4,
      qualitySensitivity: 0.65,
      noiseSensitivity: 0.3,
      smartFeaturePreference: 0.6,
      brandLoyalty: 0.4,
      patienceForRepairs: 0.5,
      probabilityWeight: 12,
    },
    {
      id: 'vintageCollector',
      name: 'Vintage Restorer',
      description: 'Finds and restores old machines. Buys simple mechanical washers — hates electronics.',
      minYear: 1985,
      loadsPerWeek: 2,
      wearFactor: 0.6,
      priceSensitivity: 0.3,
      qualitySensitivity: 0.9,
      noiseSensitivity: 0.2,
      smartFeaturePreference: 0.0,
      brandLoyalty: 0.8,
      patienceForRepairs: 0.9,
      probabilityWeight: 3,
    },
    {
      id: 'commercialLaundry',
      name: 'Commercial Laundry',
      description: 'Industrial laundry service. Extreme daily use, durability above all else.',
      minYear: 1945,
      loadsPerWeek: 150,
      wearFactor: 6.0,
      priceSensitivity: 0.6,
      qualitySensitivity: 0.5,
      noiseSensitivity: 0.1,
      smartFeaturePreference: 0.5,
      brandLoyalty: 0.15,
      patienceForRepairs: 0.1,
      probabilityWeight: 3,
    },
    // === 2000s-PRESENT ===
    {
      id: 'airbnb',
      name: 'Airbnb Host',
      description: 'Near-constant use, guests abuse machines. Demand quick repairs — bad reviews kill bookings.',
      minYear: 2008,
      loadsPerWeek: 28,
      wearFactor: 2.8,
      priceSensitivity: 0.3,
      qualitySensitivity: 0.6,
      noiseSensitivity: 0.6,
      smartFeaturePreference: 0.6,
      brandLoyalty: 0.15,
      patienceForRepairs: 0.15,
      probabilityWeight: 12,
    },
    {
      id: 'urbanRenter',
      name: 'Urban Renter',
      description: 'Gen Z / Millennial in a city apartment. Smart features and app integration are must-haves.',
      minYear: 2010,
      loadsPerWeek: 3,
      wearFactor: 0.6,
      priceSensitivity: 0.55,
      qualitySensitivity: 0.5,
      noiseSensitivity: 0.7,
      smartFeaturePreference: 0.9,
      brandLoyalty: 0.2,
      patienceForRepairs: 0.3,
      probabilityWeight: 14,
    },
    {
      id: 'retiree',
      name: 'Retired Couple',
      description: 'Fixed income, light consistent use. Price matters but they appreciate quality that lasts.',
      minYear: 1965,
      loadsPerWeek: 4,
      wearFactor: 0.7,
      priceSensitivity: 0.65,
      qualitySensitivity: 0.75,
      noiseSensitivity: 0.6,
      smartFeaturePreference: 0.1,
      brandLoyalty: 0.7,
      patienceForRepairs: 0.7,
      probabilityWeight: 15,
    },
  ],

  // ---- Failure Types ----

  failureTypes: [
    // === BEARINGS ===
    {
      id: 'bearingFailure',
      name: 'Bearing Failure',
      description: 'Grinding noise, drum wobble, eventual seizure. Classic failure of cheap or aged bearings.',
      repairCost: 120,
      severity: 'major',
      brandRepImpact: 0.15,
      componentSource: 'bearings',
      baseRate: 0.001,
    },
    {
      id: 'spiderBracket',
      name: 'Spider Bracket Crack',
      description: 'The three-armed bracket holding the inner drum cracks from metal fatigue. Catastrophic drum failure.',
      repairCost: 180,
      severity: 'critical',
      brandRepImpact: 0.18,
      componentSource: 'bearings',
      baseRate: 0.0004,
    },

    // === PUMP ===
    {
      id: 'pumpClogged',
      name: 'Pump Clogged',
      description: 'Drain failure, water left in drum. Coins, lint, or debris block the impeller.',
      repairCost: 60,
      severity: 'minor',
      brandRepImpact: 0.05,
      componentSource: 'pump',
      baseRate: 0.0008,
    },
    {
      id: 'hoseLeak',
      name: 'Drain Hose Leak',
      description: 'Water leaking from hose connection. Cracks develop over years of thermal cycling.',
      repairCost: 30,
      severity: 'minor',
      brandRepImpact: 0.06,
      componentSource: 'pump',
      baseRate: 0.0006,
    },
    {
      id: 'waterValveStuck',
      name: 'Water Valve Stuck',
      description: 'Continuous fill or no fill. Solenoid fails or debris blocks the valve seat.',
      repairCost: 70,
      severity: 'major',
      brandRepImpact: 0.08,
      componentSource: 'pump',
      baseRate: 0.0004,
    },

    // === DRUM / DOOR / EXTERIOR ===
    {
      id: 'doorLatch',
      name: 'Door Latch Broken',
      description: 'Door will not close or seal. The interlock switch or plastic latch mechanism fails.',
      repairCost: 40,
      severity: 'minor',
      brandRepImpact: 0.04,
      componentSource: 'exterior',
      baseRate: 0.0005,
    },
    {
      id: 'doorBootLeak',
      name: 'Door Boot Seal Leak',
      description: 'Rubber bellows around the door develops a tear. Water pools on the floor. Common in front-loaders.',
      repairCost: 80,
      severity: 'major',
      brandRepImpact: 0.10,
      componentSource: 'exterior',
      baseRate: 0.0005,
    },
    {
      id: 'corrosionRust',
      name: 'Drum Corrosion',
      description: 'Rust develops on the outer drum or casing. Over time it flakes into the wash. Porcelain tubs chip — stainless lasts.',
      repairCost: 150,
      severity: 'major',
      brandRepImpact: 0.10,
      componentSource: 'drum',
      baseRate: 0.0003,
    },
    {
      id: 'soapDispenser',
      name: 'Soap Dispenser Jam',
      description: 'Detergent not released, residue buildup. Humid climates make powder clump in the drawer.',
      repairCost: 25,
      severity: 'minor',
      brandRepImpact: 0.02,
      componentSource: 'exterior',
      baseRate: 0.0003,
    },

    // === MOTOR ===
    {
      id: 'motorBurnout',
      name: 'Motor Burnout',
      description: 'Smoke, burning smell, machine dead. Brushed motors wear out; induction motors burn windings under overload.',
      repairCost: 200,
      severity: 'critical',
      brandRepImpact: 0.20,
      componentSource: 'motor',
      baseRate: 0.0007,
    },
    {
      id: 'brushWear',
      name: 'Motor Brush Wear',
      description: 'Carbon brushes in the universal motor have worn down. Machine runs intermittently, then stops.',
      repairCost: 35,
      severity: 'minor',
      brandRepImpact: 0.04,
      componentSource: 'motor',
      baseRate: 0.0009,
    },
    {
      id: 'beltSnap',
      name: 'Drive Belt Snapped',
      description: 'The rubber or poly-V belt connecting motor to drum has snapped. Drum won\'t spin.',
      repairCost: 45,
      severity: 'minor',
      brandRepImpact: 0.04,
      componentSource: 'motor',
      baseRate: 0.0005,
    },
    {
      id: 'heatingElement',
      name: 'Heating Element Failure',
      description: 'No hot water, cold washes only. Scale buildup or element burnout.',
      repairCost: 85,
      severity: 'major',
      brandRepImpact: 0.07,
      componentSource: 'motor',
      baseRate: 0.0005,
    },

    // === CONTROL BOARD ===
    {
      id: 'controlBoardFailure',
      name: 'Control Board Failure',
      description: 'Machine unresponsive, error codes, cycle fails mid-wash. Moisture or power surge damages electronics.',
      repairCost: 150,
      severity: 'major',
      brandRepImpact: 0.15,
      componentSource: 'controlBoard',
      baseRate: 0.002,
    },
    {
      id: 'timerDrift',
      name: 'Timer Calibration Drift',
      description: 'Mechanical timer runs too fast or too slow. Cycles end prematurely or run too long.',
      repairCost: 50,
      severity: 'minor',
      brandRepImpact: 0.03,
      componentSource: 'controlBoard',
      baseRate: 0.0006,
    },
    {
      id: 'firmwareCorrupt',
      name: 'Firmware Corruption',
      description: 'Smart machine\'s firmware crashes during an OTA update. Display frozen, buttons unresponsive.',
      repairCost: 90,
      severity: 'major',
      brandRepImpact: 0.08,
      componentSource: 'controlBoard',
      baseRate: 0.0008,
    },

    // === SUSPENSION ===
    {
      id: 'suspensionCollapse',
      name: 'Suspension Collapse',
      description: 'Machine violently shakes, walks across floor. Springs fatigue or dampers leak oil.',
      repairCost: 90,
      severity: 'major',
      brandRepImpact: 0.10,
      componentSource: 'suspension',
      baseRate: 0.0006,
    },
    {
      id: 'counterweightCrack',
      name: 'Counterweight Cracked',
      description: 'Concrete counterweight on the drum cracks from repeated vibration. Severe imbalance during spin.',
      repairCost: 110,
      severity: 'major',
      brandRepImpact: 0.08,
      componentSource: 'suspension',
      baseRate: 0.0003,
    },
  ],

  // ---- Supplier Quality Tiers (my addition: component sourcing) ----

  suppliers: [
    {
      id: 'localWorkshop',
      name: 'Local Workshop',
      description: 'Small-batch, inconsistent quality',
      qualityMultiplier: 0.7,
      costMultiplier: 0.6,
      leadTimeDays: 14,
      reliability: 0.6,
      minYear: 1970,
      maxYear: null,
    },
    {
      id: 'nationalSupplier',
      name: 'National Parts Co.',
      description: 'Reliable domestic supply chain',
      qualityMultiplier: 1.0,
      costMultiplier: 1.0,
      leadTimeDays: 7,
      reliability: 0.85,
      minYear: 1970,
      maxYear: null,
    },
    {
      id: 'germanPrecision',
      name: 'German Precision GmbH',
      description: 'Premium European engineering',
      qualityMultiplier: 1.3,
      costMultiplier: 1.6,
      leadTimeDays: 10,
      reliability: 0.95,
      minYear: 1970,
      maxYear: null,
    },
    {
      id: 'chineseImport',
      name: 'Shenzhen Mass Manufacturing',
      description: 'Cheap, fast, variable quality',
      qualityMultiplier: 0.55,
      costMultiplier: 0.35,
      leadTimeDays: 20,
      reliability: 0.5,
      minYear: 1990,
      maxYear: null,
    },
    {
      id: 'japanesePrecision',
      name: 'Osaka Precision Industries',
      description: 'High-quality Asian manufacturing',
      qualityMultiplier: 1.2,
      costMultiplier: 1.3,
      leadTimeDays: 15,
      reliability: 0.95,
      minYear: 1980,
      maxYear: null,
    },
    {
      id: 'easternEuropean',
      name: 'Eastern European Components',
      description: 'Post-Cold War engineering talent at bargain prices — variable quality',
      qualityMultiplier: 0.85,
      costMultiplier: 0.55,
      leadTimeDays: 18,
      reliability: 0.65,
      minYear: 1995,
      maxYear: null,
    },
    {
      id: 'koreanTech',
      name: 'Seoul Electronics Co.',
      description: 'Korean manufacturing giant — precision electronics and motors',
      qualityMultiplier: 1.15,
      costMultiplier: 0.9,
      leadTimeDays: 12,
      reliability: 0.92,
      minYear: 1990,
      maxYear: null,
    },
  ],

  // ---- Regulation Events ----

  regulations: [
    // 1950s — safety concerns as appliances proliferate
    { year: 1953, name: 'UL Safety Standard',               description: 'Underwriters Laboratories safety certification required for home appliances.',       effect: 'ulListed:true' },
    // 1970s — the environmental movement
    { year: 1972, name: 'Clean Water Act',                  description: 'Limits on phosphate detergent discharge.',                                            effect: 'phosphateBan:true' },
    { year: 1978, name: 'Energy Star Phase 1',              description: 'Minimum energy efficiency standard introduced.',                                    effect: 'energyReq:0.25' },
    // 1980s — noise and water
    { year: 1985, name: 'Noise Ordinance EU',                description: 'EU mandates max 75dB for household appliances.',                                  effect: 'noiseMax:75' },
    { year: 1990, name: 'Water Conservation Act',           description: 'Max 40L per cycle for new machines.',                                             effect: 'waterMax:40' },
    // 1990s — tightening standards
    { year: 1997, name: 'Energy Star Phase 2',              description: 'Stricter energy efficiency standards.',                                          effect: 'energyReq:0.50' },
    // 2000s — environmental regulation
    { year: 2004, name: 'RoHS Compliance',                   description: 'Restriction of hazardous substances in electronics.',                             effect: 'rohs:true' },
    { year: 2007, name: 'Energy Star Phase 3',              description: 'Further energy reductions required.',                                           effect: 'energyReq:0.65' },
    // 2010s — smart grid, connected home
    { year: 2013, name: 'Energy Star Phase 4',              description: 'Most efficient tier for washers.',                                             effect: 'energyReq:0.75' },
    { year: 2015, name: 'Smart Grid Ready',                 description: 'All new washers must support demand response.',                                 effect: 'smartGrid:true' },
    // 2020s — repairability
    { year: 2022, name: 'Right to Repair Act',              description: 'Manufacturers must supply parts for 10 years.',                                 effect: 'partsMandate:10' },
  ],

  // ---- Technology Unlock Timeline ----

  techUnlocks: [
    {
      year: 1945, name: 'Basic Electric Laundry',
      description: 'Post-war America is booming. Returning GIs are buying homes and starting families. The Thor electric washer (1908) proved electric laundry works — now it is time to make it affordable. You can build a simple electric washer with a universal motor and mechanical timer.',
      requiredLevel: 0
    },
    {
      year: 1950, name: 'Automatic Revolution',
      description: 'Bendix introduced the first fully automatic washer in 1937, but war delayed mass adoption. Now the 1950s suburban boom demands convenience. Automatic fill, wash, rinse, and drain cycles free housewives from hours of laundry labor. Stainless steel drums offer rust-free durability.',
      requiredLevel: 2
    },
    {
      year: 1957, name: 'High-Spin Era',
      description: 'The dangerous wringer/mangle that injured thousands of housewives is finally replaced by the built-in spin dryer. Multi-cam electro-mechanical timers allow separate wash and spin speeds. Machines can now safely spin at 600+ RPM.',
      requiredLevel: 4
    },
    {
      year: 1965, name: 'Multiple Cycles',
      description: 'Synthetic fabrics like polyester and nylon need gentler care. The first delicate, permanent press, and pre-soak settings appear. Premium sealed bearings reduce noise. Consumers now expect a machine that matches their wardrobe, not just their workload.',
      requiredLevel: 6
    },
    {
      year: 1972, name: 'Compact Living',
      description: 'Apartment living grows. Smaller, stackable machines emerge. Polypropylene plastic tubs cut weight and cost. The PSC (permanent split capacitor) motor improves efficiency. Push-button panels replace the classic rotating dial — a sign of the electronic age to come.',
      requiredLevel: 9
    },
    {
      year: 1978, name: 'Energy Star Phase 1',
      description: 'The 1973 oil crisis changed everything. Congress mandates energy consumption labeling on all appliances. Consumers start asking: "How much electricity does it use?" Efficiency begins to matter in the marketplace.',
      requiredLevel: 12
    },
    {
      year: 1985, name: 'Electronic Controls',
      description: 'The microprocessor revolution reaches the laundry room. Electronic sensors detect water temperature and fill level. Digital displays replace mechanical timers on premium models. Reinforced stainless steel drums can spin faster without warping.',
      requiredLevel: 15
    },
    {
      year: 1990, name: 'Fuzzy Logic',
      description: 'Japanese manufacturers introduce "fuzzy logic" — microcontrollers that automatically adjust wash parameters based on load size, fabric type, and soil level. Brushless DC motors become practical with new power electronics. Hydraulic dampers make 1000+ RPM spins tolerable.',
      requiredLevel: 18
    },
    {
      year: 1997, name: 'Energy Star Phase 2',
      description: 'The US Department of Energy tightens efficiency standards. Horizontal-axis (front-loading) machines gain market share because they use half the water and energy. HE (high-efficiency) detergent becomes required for new machines.',
      requiredLevel: 22
    },
    {
      year: 2005, name: 'Smart Connectivity',
      description: 'WiFi arrives in the laundry room. Smart machines send notifications, download new cycles, and enable remote diagnostics. Direct drive inverter motors eliminate belts and pulleys for near-silent operation. Premium finishes make the washer a design statement.',
      requiredLevel: 26
    },
    {
      year: 2015, name: 'AI & IoT',
      description: 'Machine learning optimizes every cycle. AI load sensing detects fabric type and weight, then selects the perfect water level, temperature, and agitation pattern. Auto-dispense systems release detergent and softener at exactly the right moment. Predictive maintenance alerts you before parts fail.',
      requiredLevel: 32
    },
    {
      year: 2022, name: 'Right to Repair',
      description: 'A global movement for repairability forces manufacturers to provide parts, schematics, and diagnostics for a decade. Consumers tired of planned obsolescence demand machines that last 20+ years. Carbon composite drums and magnetic bearings make 20-year lifespans possible.',
      requiredLevel: 38
    },
  ],

  // ---- Competitor AI Strategies ----

  competitorArchetypes: [
    // 1950s: Bendix-inspired first automatic washer pioneer
    {
      id: 'bendixLegacy',
      name: 'Bendix Home Laundry',
      description: 'Invented the automatic washer — now a budget brand struggling with legacy designs',
      focusComponents: { drum: 'porcelain', motor: 'universal', pump: 'beltPump', bearings: 'standard', suspension: 'coil', controlBoard: 'multicam', exterior: 'white' },
      priceStrategy: 'budget',
      qualityLevel: 0.3,
      aggressiveness: 0.4,
      startingYear: 1945,
    },
    // 1950s: Premium reliability brand
    {
      id: 'maytagStyle',
      name: 'Mayflower Appliances',
      description: 'Built like a tank — known for durability and dependability',
      focusComponents: { drum: 'porcelain', motor: 'induction', pump: 'beltPump', bearings: 'premium', suspension: 'torsion', controlBoard: 'multicam', exterior: 'chrome' },
      priceStrategy: 'mid',
      qualityLevel: 0.75,
      aggressiveness: 0.2,
      startingYear: 1947,
    },
    // 1960s: German premium engineering
    {
      id: 'germanEngineering',
      name: 'Rhine Industries',
      description: 'Premium German engineering, high reliability, front-loading pioneer',
      focusComponents: { drum: 'stainless', motor: 'psc', pump: 'standard', bearings: 'premium', suspension: 'hydraulic', controlBoard: 'pushButton', exterior: 'color' },
      priceStrategy: 'premium',
      qualityLevel: 0.88,
      aggressiveness: 0.3,
      startingYear: 1960,
    },
    // 1980s: Asian mass-market challenger
    {
      id: 'cheapImports',
      name: 'ValueMart Appliances',
      description: 'Ultra-cheap machines, poor quality, high volume — then improved over time',
      focusComponents: { drum: 'galvanised', motor: 'universal', pump: 'gravity', bearings: 'bronze', suspension: 'leaf', controlBoard: 'timer', exterior: 'white' },
      priceStrategy: 'budget',
      qualityLevel: 0.15,
      aggressiveness: 0.7,
      startingYear: 1978,
    },
    // 2000s: Smart home disruptor
    {
      id: 'smartHome',
      name: 'Nexus Smart Living',
      description: 'Smart-home integration, cutting-edge features, app-connected',
      focusComponents: { drum: 'polypropylene', motor: 'brushless', pump: 'standard', bearings: 'hybrid', suspension: 'hydraulic', controlBoard: 'smart', exterior: 'premium' },
      priceStrategy: 'premium',
      qualityLevel: 0.55,
      aggressiveness: 0.6,
      startingYear: 2005,
    },
    // 1990s: Eco-conscious (enters before smart home)
    {
      id: 'ecoFriendly',
      name: 'GreenWave Appliances',
      description: 'Eco-friendly, energy/water efficient — early adopter of HE technology',
      focusComponents: { drum: 'stainless', motor: 'brushless', pump: 'standard', bearings: 'hybrid', suspension: 'torsion', controlBoard: 'digital', exterior: 'glassDoor' },
      priceStrategy: 'mid',
      qualityLevel: 0.65,
      aggressiveness: 0.35,
      startingYear: 1992,
    },
    // 1970s: Department-store mass-market giant (e.g., Kenmore/Whirlpool)
    {
      id: 'nationalBrand',
      name: 'National Appliance Co.',
      description: 'The mass-market giant. Sells through every department store — not the best, but everyone has one.',
      focusComponents: { drum: 'porcelain', motor: 'psc', pump: 'standard', bearings: 'standard', suspension: 'torsion', controlBoard: 'pushButton', exterior: 'color' },
      priceStrategy: 'mid',
      qualityLevel: 0.45,
      aggressiveness: 0.5,
      startingYear: 1965,
    },
    // 2010s: DTC internet-native premium brand
    {
      id: 'directConsumer',
      name: 'Spire Home',
      description: 'Online-only brand that sells direct to consumers. Minimalist design, premium features, no middleman.',
      focusComponents: { drum: 'composite', motor: 'directdrive', pump: 'industrial', bearings: 'magnetic', suspension: 'active', controlBoard: 'ai', exterior: 'premium' },
      priceStrategy: 'premium',
      qualityLevel: 0.70,
      aggressiveness: 0.55,
      startingYear: 2012,
    },
  ],

  // ---- Repair Resolution Options ----

  resolutionOptions: [
    { id: 'repair',            name: 'Send Technician',         cost: 'repairCost * 1.2', satisfaction: 0.6, timeDays: 3, description: 'Dispatch a trained technician. Most expensive but best for reputation.' },
    { id: 'repairExpress',    name: 'Expedited Repair',        cost: 'repairCost * 1.8', satisfaction: 0.85, timeDays: 1, description: 'Priority service — 24-hour turnaround. Customers love the speed.' },
    { id: 'discount',          name: 'Offer Partial Refund',     cost: 'repairCost * 0.5 + 50', satisfaction: 0.4, timeDays: 1, description: 'Refund part of the purchase price. Quick and cheap, but doesn\'t fix the machine.' },
    { id: 'replaceMachine',    name: 'Replace Machine',          cost: 'productionCost * 1.5', satisfaction: 0.95, timeDays: 5, description: 'Ship a brand-new replacement unit. Costly but reputation-neutralizing.' },
    { id: 'storeCredit',      name: 'Store Credit + Repair',   cost: 'repairCost * 0.8 + 30', satisfaction: 0.55, timeDays: 4, description: 'Offer store credit toward a future purchase while still repairing their machine.' },
    { id: 'decline',           name: 'Decline Claim',            cost: 0, satisfaction: -0.5, timeDays: 0, description: 'Refuse responsibility. Damages reputation significantly.' },
  ],

  // ---- Service Regions (dispatch logistics) ----
  // Expanded to 8 regions covering continental US demographically

  serviceRegions: [
    { id: 'northeast',     name: 'Northeast',     baseTechs: 4, population: 0.20, populationDensity: 'urban', avgResponseDays: 2, description: 'Dense urban corridor from Boston to DC. High labor costs but many techs.' },
    { id: 'midAtlantic',   name: 'Mid-Atlantic',  baseTechs: 3, population: 0.14, populationDensity: 'suburban', avgResponseDays: 2.5, description: 'Philadelphia, Baltimore, DC suburbs. Mixed urban and suburban coverage.' },
    { id: 'southeast',     name: 'Southeast',     baseTechs: 2, population: 0.16, populationDensity: 'suburban', avgResponseDays: 3, description: 'Atlanta, Charlotte, Florida. Growing fast, technician shortage.' },
    { id: 'midwest',       name: 'Midwest',       baseTechs: 3, population: 0.18, populationDensity: 'suburban', avgResponseDays: 2.5, description: 'Chicago, Detroit, Ohio valley. Strong industrial base, skilled techs.' },
    { id: 'southwest',     name: 'Southwest',     baseTechs: 1, population: 0.08, populationDensity: 'rural', avgResponseDays: 4, description: 'Texas, Oklahoma, Arizona. Vast distances, few technicians.' },
    { id: 'plains',        name: 'Great Plains',  baseTechs: 1, population: 0.05, populationDensity: 'rural', avgResponseDays: 5, description: 'Kansas, Nebraska, the Dakotas. Sparsely populated, long travel times.' },
    { id: 'west',          name: 'West Coast',    baseTechs: 4, population: 0.16, populationDensity: 'urban', avgResponseDays: 2, description: 'California, Oregon, Washington. Tech hub — plenty of skilled labor.' },
    { id: 'mountain',      name: 'Mountain West', baseTechs: 1, population: 0.03, populationDensity: 'rural', avgResponseDays: 5, description: 'Colorado, Utah, Montana. Beautiful terrain, terrible logistics.' },
  ],

  // ---- Brand Reputation Levels ----

  reputationTiers: [
    { min: 0,   label: 'Unknown',      color: '#666' },
    { min: 15,  label: 'Obscure',      color: '#888' },
    { min: 30,  label: 'Emerging',     color: '#aa8844' },
    { min: 45,  label: 'Respected',    color: '#66aa44' },
    { min: 60,  label: 'Trusted',      color: '#44aa66' },
    { min: 75,  label: 'Renowned',     color: '#4488cc' },
    { min: 90,  label: 'Legendary',    color: '#aa66cc' },
  ],

  // ---- Random Events ----

  events: {
    // Positive events with weights; cooldownYears prevents repeats
    list: [
      // ===== POSITIVE EVENTS =====
      {
        id: 'viralMarketing', name: 'Viral Marketing Wave',
        desc: 'A popular TikTok creator filmed their laundry room transformation featuring your washer. The video has millions of views — your brand is suddenly everywhere!',
        type: 'positive', weight: 6, cooldownYears: 5, minYear: 2005,
        effects: { reputation: 8, cash: 80000 },
        narrative: 'Your social media team is ecstatic. Orders are flooding in.',
      },
      {
        id: 'industryAward', name: 'Industry Excellence Award',
        desc: 'Consumer Relativity Magazine has named your latest model the "Most Reliable Washing Machine" for the third year running!',
        type: 'positive', weight: 5, cooldownYears: 4, minYear: 1975,
        effects: { reputation: 6, cash: 30000 },
        narrative: 'The award seal is already being added to your packaging.',
        requiresModels: true,
      },
      {
        id: 'governmentSubsidy', name: 'Manufacturing Tax Credit',
        desc: 'The government has introduced a tax credit for domestic appliance manufacturers who meet energy efficiency targets.',
        type: 'positive', weight: 4, cooldownYears: 6, minYear: 1980,
        effects: { cash: 150000 },
        narrative: 'Your finance department is already calculating the savings.',
      },
      {
        id: 'partsWindfall', name: 'Supplier Overstock',
        desc: 'Your bearing supplier has a massive overstock and is offering components at 40% off for a limited time!',
        type: 'positive', weight: 4, cooldownYears: 5, minYear: 1970,
        effects: { cash: 50000, reputation: 2 },
        narrative: 'You lock in the discounted rate for the next quarter.',
      },
      {
        id: 'skilledLabor', name: 'Tech School Partnership',
        desc: 'A local technical college wants to partner with you to train appliance repair technicians. They will cover the salaries for the first year!',
        type: 'positive', weight: 3, cooldownYears: 5, minYear: 1970,
        effects: { technicians: 2, reputation: 3 },
        narrative: 'The first batch of graduates starts next month.',
      },
      {
        id: 'favorableReview', name: 'Glowing Review',
        desc: 'An influential home appliance reviewer on YouTube gave your machine a 9.5/10, calling it "the best washer money can buy."',
        type: 'positive', weight: 5, cooldownYears: 3, minYear: 2005,
        effects: { reputation: 5, cash: 40000 },
        narrative: 'The review link is being shared across forums.',
        requiresModels: true,
      },
      {
        id: 'exportDeal', name: 'International Distributor',
        desc: 'A major European retail chain wants to carry your washing machines. This could open up a whole new market!',
        type: 'positive', weight: 3, cooldownYears: 6, minYear: 1985,
        effects: { cash: 200000, reputation: 4 },
        narrative: 'Initial order is for 5,000 units.',
      },
      {
        id: 'innovationGrant', name: 'Energy Innovation Grant',
        desc: 'The Department of Energy has awarded you a research grant to develop ultra-efficient washing technology.',
        type: 'positive', weight: 3, cooldownYears: 7, minYear: 1990,
        effects: { cash: 120000, reputation: 3 },
        narrative: 'The R&D team is already drafting proposals.',
      },
      {
        id: 'longevityMilestone', name: 'Legendary Machine',
        desc: 'A customer wrote in to say their 20-year-old washing machine — one of your earliest models — is still running perfectly after 8,000 loads!',
        type: 'positive', weight: 3, cooldownYears: 8, minYear: 1990,
        effects: { reputation: 7, customerSatisfaction: 0.05 },
        narrative: 'Newspapers pick up the feel-good story about your washer.',
        requiresModels: true,
      },
      {
        id: 'bulkOrder', name: 'Apartment Complex Deal',
        desc: 'A large property developer wants to equip 2,000 new apartments with your washing machines.',
        type: 'positive', weight: 4, cooldownYears: 4, minYear: 1970,
        effects: { cash: 250000, reputation: 2 },
        narrative: 'The contract is signed. Your factory ramps up.',
      },
      {
        id: 'postwarKitchen', name: 'Post-War Kitchen Boom',
        desc: 'Life magazine runs a feature on "The Modern Kitchen." Your washer is prominently displayed in the photo spread. Suburban homemakers take notice!',
        type: 'positive', weight: 5, cooldownYears: 8, minYear: 1945, maxYear: 1960,
        effects: { reputation: 5, cash: 30000 },
        narrative: 'The phone is ringing off the hook with dealer inquiries.',
      },
      {
        id: 'laundryRoom', name: 'New Home Boom',
        desc: 'Levittown-style suburban developments are popping up everywhere. Builders want to include your washer in every new home as the standard appliance.',
        type: 'positive', weight: 4, cooldownYears: 5, minYear: 1948, maxYear: 1965,
        effects: { cash: 180000, reputation: 4 },
        narrative: 'Your sales team is visiting housing developers across the country.',
      },
      {
        id: 'tradeShow', name: 'World\'s Fair Debut',
        desc: 'Your latest model is chosen for display at the World\'s Fair! Millions of visitors see your washer as the future of home appliances.',
        type: 'positive', weight: 3, cooldownYears: 10, minYear: 1964, maxYear: 1974,
        effects: { reputation: 8, cash: 50000 },
        narrative: 'International distributors approach you after the fair.',
      },
      {
        id: 'consumerReports', name: 'Consumer Reports Endorsement',
        desc: 'Consumer Reports magazine names your model a "Best Buy" — praising its reliability and value. Sales spike at retailers nationwide.',
        type: 'positive', weight: 5, cooldownYears: 4, minYear: 1972,
        effects: { reputation: 6, cash: 60000 },
        narrative: 'Retailers report customers walking in specifically asking for your brand.',
      },
      {
        id: 'energyRebate', name: 'Utility Rebate Program',
        desc: 'Local utilities launch a rebate program for Energy Star certified washers. Your compliant models are suddenly $100 cheaper for consumers.',
        type: 'positive', weight: 4, cooldownYears: 5, minYear: 1998,
        effects: { reputation: 3, cash: 90000 },
        narrative: 'Applications for your rebate-qualified models surge.',
      },

      // ===== NEGATIVE EVENTS =====
      {
        id: 'supplyDisruption', name: 'Supply Chain Disruption',
        desc: 'A major fire at your motor supplier\'s factory has halted production of critical components. Prices for motors have tripled!',
        type: 'negative', weight: 5, cooldownYears: 5, minYear: 1970,
        effects: { cash: -80000, reputation: -3 },
        narrative: 'Your procurement team is scrambling to find alternatives.',
      },
      {
        id: 'classAction', name: 'Class Action Lawsuit',
        desc: 'A law firm has filed a class action lawsuit alleging a design flaw in your machines causes premature drum failure.',
        type: 'negative', weight: 3, cooldownYears: 8, minYear: 1980,
        effects: { cash: -250000, reputation: -10 },
        narrative: 'Legal fees are mounting. Your stock takes a hit.',
        requiresModels: true,
      },
      {
        id: 'counterfeitParts', name: 'Counterfeit Bearing Scandal',
        desc: 'An investigation reveals that counterfeit bearings entered your supply chain. Affected machines are failing at triple the normal rate.',
        type: 'negative', weight: 3, cooldownYears: 6, minYear: 1990,
        effects: { cash: -120000, reputation: -8 },
        narrative: 'Your service department is overwhelmed with warranty claims.',
      },
      {
        id: 'technicianStrike', name: 'Technician Strike',
        desc: 'Your service technicians have voted to strike over working conditions. Repair times will be severely impacted.',
        type: 'negative', weight: 4, cooldownYears: 5, minYear: 1970,
        effects: { reputation: -5, technicians: -1 },
        narrative: 'Pickets are forming outside your service centres.',
      },
      {
        id: 'productRecall', name: 'Mandatory Product Recall',
        desc: 'The safety regulator has identified a fire risk in one of your models. A full recall is required.',
        type: 'negative', weight: 2, cooldownYears: 8, minYear: 1970,
        effects: { cash: -500000, reputation: -15 },
        narrative: 'This will be a costly and embarrassing chapter.',
        requiresModels: true,
      },
      {
        id: 'factoryFlood', name: 'Factory Flood',
        desc: 'Heavy rains have flooded your main manufacturing facility. Production is halted while cleanup crews work.',
        type: 'negative', weight: 3, cooldownYears: 6, minYear: 1970,
        effects: { cash: -100000, reputation: -3 },
        narrative: 'Damage is extensive but insured. Downtime is the real cost.',
      },
      {
        id: 'patentLawsuit', name: 'Patent Infringement Claim',
        desc: 'A competitor claims your smart load-sensing technology infringes on their patent. Court proceedings have begun.',
        type: 'negative', weight: 3, cooldownYears: 6, minYear: 2005,
        effects: { cash: -150000, reputation: -4 },
        narrative: 'Your legal team is confident but the process is expensive.',
      },
      {
        id: 'cyberAttack', name: 'Ransomware Attack',
        desc: 'Hackers have locked your factory control systems and demand payment. Production has ground to a halt.',
        type: 'negative', weight: 2, cooldownYears: 5, minYear: 2000,
        effects: { cash: -200000, reputation: -5 },
        narrative: 'IT security is working on restoring from backups.',
      },
      {
        id: 'componentShortage', name: 'Global Chip Shortage',
        desc: 'A worldwide shortage of semiconductors is affecting your smart control board supply. Production capacity is slashed.',
        type: 'negative', weight: 3, cooldownYears: 7, minYear: 2000,
        effects: { cash: -50000, reputation: -3 },
        narrative: 'Lead times for electronic components have stretched to 6 months.',
      },
      {
        id: 'badPress', name: 'Negative Exposé',
        desc: 'A news investigation has published a critical exposé claiming your company uses planned obsolescence in its designs.',
        type: 'negative', weight: 4, cooldownYears: 4, minYear: 1975,
        effects: { reputation: -7, cash: -40000 },
        narrative: 'Social media is buzzing with outrage.',
        requiresModels: true,
      },
      {
        id: 'steelShortage', name: 'Post-War Steel Shortage',
        desc: 'The Korean War has caused the government to ration steel. Your factory can only operate at 60% capacity. Prices for raw materials have doubled.',
        type: 'negative', weight: 3, cooldownYears: 8, minYear: 1950, maxYear: 1954,
        effects: { cash: -120000, reputation: -2 },
        narrative: 'Your purchasing agents are scouring surplus yards for materials.',
      },
      {
        id: 'oilCrisis', name: '1970s Oil Crisis',
        desc: 'The OPEC oil embargo sends energy prices through the roof. Consumers are suddenly obsessed with efficiency. Gas-guzzling washers sit on dealer lots.',
        type: 'negative', weight: 4, cooldownYears: 6, minYear: 1973, maxYear: 1979,
        effects: { cash: -100000, reputation: -4 },
        narrative: 'Your marketing team hastily rebrands machines as "energy-saving."',
        requiresModels: true,
      },
      {
        id: 'japaneseCompetition', name: 'Japanese Import Surge',
        desc: 'Japanese electronics manufacturers are flooding the US market with feature-packed, reliable washers at competitive prices. Your market share is under assault.',
        type: 'negative', weight: 4, cooldownYears: 6, minYear: 1980, maxYear: 1995,
        effects: { reputation: -5, cash: -80000 },
        narrative: 'Your executives demand a response — cut prices or innovate.',
        requiresModels: true,
      },
      {
        id: 'recession90s', name: 'Early 1990s Recession',
        desc: 'The economy has entered a recession. Consumer spending on big-ticket items has cratered. Your sales pipeline is drying up.',
        type: 'negative', weight: 4, cooldownYears: 6, minYear: 1990, maxYear: 1994,
        effects: { cash: -150000, reputation: -2 },
        narrative: 'Your CFO is cutting costs across the board.',
      },
      {
        id: 'supplierBankrupt', name: 'Key Supplier Bankruptcy',
        desc: 'One of your long-time component suppliers has filed for bankruptcy. You need to qualify new suppliers urgently, risking quality issues.',
        type: 'negative', weight: 3, cooldownYears: 5, minYear: 1980,
        effects: { cash: -60000, reputation: -4 },
        narrative: 'Engineering is scrambling to re-certify alternative parts.',
      },

      // ===== CHOICE EVENTS =====
      {
        id: 'qcWhistleblower', name: 'Quality Control Dilemma',
        desc: 'A quality control engineer has discovered a batch of motors with slightly substandard windings. They work fine now but may fail 2-3 years early.',
        type: 'choice', weight: 4, cooldownYears: 4, minYear: 1970,
        narrative: 'What do you do?',
        choices: [
          { text: 'Replace all affected motors ($$)', effects: { cash: -80000, reputation: 4 }, result: 'Customers appreciate your integrity. The story gets positive press.' },
          { text: 'Ship them anyway — the failure rate is low', effects: { cash: 0, reputation: -4 }, result: 'Most customers never notice, but those who do are furious.' },
          { text: 'Install them with extended warranty coverage', effects: { cash: -20000, reputation: 0 }, result: 'A pragmatic middle ground. Some customers will eventually file claims.' },
        ],
      },
      {
        id: 'expansionOffer', name: 'Acquisition Opportunity',
        desc: 'A struggling regional washer manufacturer is available for purchase. They have a loyal customer base but outdated technology.',
        type: 'choice', weight: 3, cooldownYears: 7, minYear: 1985,
        narrative: 'Do you acquire them?',
        choices: [
          { text: 'Acquire the company ($)', effects: { cash: -300000, reputation: 4, marketShare: 2 }, result: 'You absorb their customer base and retire their outdated product line.' },
          { text: 'Decline — focus on organic growth', effects: { cash: 0 }, result: 'You stay the course. A rival later acquires them.' },
          { text: 'Buy their customer list and R&D patents ($)', effects: { cash: -150000, reputation: 2 }, result: 'You cherry-pick the valuable assets without the baggage.' },
        ],
      },
      {
        id: 'environmentalAudit', name: 'Environmental Compliance Audit',
        desc: 'Regulators are conducting an unannounced environmental audit of your factory. Your wastewater treatment system is outdated.',
        type: 'choice', weight: 3, cooldownYears: 5, minYear: 1985,
        narrative: 'How do you handle it?',
        choices: [
          { text: 'Upgrade the system proactively ($$)', effects: { cash: -100000, reputation: 5 }, result: 'The audit passes with flying colours. You get public recognition for environmental leadership.' },
          { text: 'Do the bare minimum to pass', effects: { cash: -20000, reputation: -1 }, result: 'You pass, but barely. Environmental groups take notice.' },
          { text: 'Lobby to delay the audit', effects: { cash: -30000, reputation: -5 }, result: 'You buy time, but the scandal leaks. Your reputation suffers.' },
        ],
      },
      {
        id: 'supplierDilemma', name: 'The Cheap Supplier Offer',
        desc: 'A new supplier from overseas offers you bearings at 60% less than your current cost. Their samples test adequately, but their factory conditions are unknown.',
        type: 'choice', weight: 4, cooldownYears: 4, minYear: 1990,
        narrative: 'Your procurement team wants a decision.',
        choices: [
          { text: 'Sign the deal — lower costs!', effects: { cash: 120000, reputation: -3 }, result: 'Costs drop, but six months later a documentary exposes child labour at the factory. Your brand is tarnished.' },
          { text: 'Stick with your current supplier', effects: { cash: 0 }, result: 'Reliability matters more than a quick saving. Your current supplier appreciates the loyalty.' },
          { text: 'Negotiate a trial batch only', effects: { cash: 30000, reputation: -1 }, result: 'You test a small batch. Most pass, but the reputational risk is contained.' },
        ],
      },
      {
        id: 'interviewRequest', name: 'Magazine Interview',
        desc: 'Industry Weekly magazine wants to profile your company for their "Visionaries of Manufacturing" issue. This is great PR, but the reporter is known for tough questions.',
        type: 'choice', weight: 4, cooldownYears: 3, minYear: 1975,
        narrative: 'Do you grant the interview?',
        choices: [
          { text: 'Accept — great exposure!', effects: { reputation: 6, cash: 20000 }, result: 'The article is glowing. Your brand is featured alongside industry legends.' },
          { text: 'Politely decline', effects: { cash: 0 }, result: 'You stay under the radar. Safe, but a missed opportunity.' },
        ],
      },
      // ===== NEW HISTORICAL CHOICE EVENTS =====
      {
        id: 'launchHe', name: 'High-Efficiency Pivot',
        desc: 'The Department of Energy is proposing new efficiency standards that would make your current top-loading design obsolete. You need to decide how to respond.',
        type: 'choice', weight: 4, cooldownYears: 6, minYear: 1993, maxYear: 1998,
        narrative: 'Your engineering team presents three options.',
        choices: [
          { text: 'Invest in HE front-loader R&D ($$)', effects: { cash: -250000, reputation: 6, marketShare: 2 }, result: 'You pioneer high-efficiency front-loading technology. The industry follows your lead.' },
          { text: 'Retrofit existing designs to barely pass', effects: { cash: -80000, reputation: -2 }, result: 'Your machines pass — just barely. Environmental groups call you a laggard.' },
          { text: 'Fight the regulation through lobbying', effects: { cash: -120000, reputation: -4 }, result: 'You delay the standards by two years, but the negative press hurts your brand.' },
        ],
      },
      {
        id: 'offshoring', name: 'Factory Relocation Decision',
        desc: 'Labor costs are rising. A consulting firm recommends moving production overseas. Your workforce and community are watching.',
        type: 'choice', weight: 3, cooldownYears: 7, minYear: 1995,
        narrative: 'The boardroom is divided.',
        choices: [
          { text: 'Move production offshore ($$ savings)', effects: { cash: 300000, reputation: -6 }, result: 'Costs plummet, but the PR disaster of layoffs and "exporting jobs" haunts your brand for years.' },
          { text: 'Automate the domestic factory', effects: { cash: -200000, reputation: 2, technicians: 1 }, result: 'You invest in robotics. Your factory becomes a showpiece of modern manufacturing.' },
          { text: 'Keep things as they are', effects: { cash: 0, reputation: 1 }, result: 'You maintain the status quo. Your workers are relieved, but margins shrink.' },
        ],
      },
      {
        id: 'tradeWar', name: 'Import Tariff Conflict',
        desc: 'The government has imposed tariffs on imported steel and electronics. Your component costs are skyrocketing. Competitors are raising prices.',
        type: 'choice', weight: 4, cooldownYears: 5, minYear: 2002,
        narrative: 'Your supply chain team is in crisis mode.',
        choices: [
          { text: 'Source domestic suppliers ($$)', effects: { cash: -150000, reputation: 3 }, result: 'You pivot to American-made components. Patriotic marketing boosts your image.' },
          { text: 'Absorb the tariff costs', effects: { cash: -200000 }, result: 'You eat the cost to maintain market share. Profits take a hit.' },
          { text: 'Pass the cost to customers', effects: { cash: 100000, reputation: -5 }, result: 'You raise prices. Some customers defect to cheaper rivals.' },
        ],
      },
      {
        id: 'smartAppliance', name: 'The IoT Gamble',
        desc: 'The smart home is taking off. You can integrate WiFi and app control into your next model — but it will require a complete control board redesign and ongoing cloud service costs.',
        type: 'choice', weight: 4, cooldownYears: 5, minYear: 2013,
        narrative: 'The tech team is excited. The finance team is nervous.',
        choices: [
          { text: 'Go all-in on smart features ($$$)', effects: { cash: -300000, reputation: 5, marketShare: 2 }, result: 'Your app-connected washer is a hit with tech-savvy buyers. Media calls it "the washer for the iPhone generation."' },
          { text: 'Add basic smart features only ($)', effects: { cash: -100000, reputation: 1 }, result: 'You offer a modest connected experience. It satisfies some customers but wows nobody.' },
          { text: 'Skip smart features — focus on reliability', effects: { cash: 0, reputation: 2 }, result: 'You double down on what made your brand great. Traditionalists appreciate it.' },
        ],
      },
      {
        id: 'plannedObsolescence', name: 'The Right to Repair Dilemma',
        desc: 'A Right to Repair bill is advancing in Congress. Your current designs use proprietary fasteners and sealed assemblies that prevent home repair.',
        type: 'choice', weight: 4, cooldownYears: 5, minYear: 2020,
        narrative: 'Your legal and engineering teams have competing priorities.',
        choices: [
          { text: 'Redesign for repairability ($$)', effects: { cash: -200000, reputation: 7 }, result: 'You embrace the movement. Your machines now use standard fasteners and published schematics. Customers love you.' },
          { text: 'Lobby against the bill', effects: { cash: -100000, reputation: -4 }, result: 'You fight the legislation. The bill passes anyway and you scramble to comply.' },
          { text: 'Offer a certified repair program', effects: { cash: -50000, reputation: 2 }, result: 'You compromise — training third-party repair shops and selling parts. It satisfies regulators.' },
        ],
      },
    ],
  },

  // ---- Default Game Parameters ----

  defaults: {
    startingCapital: 500000,
    startingReputation: 10,
    maxProductionLines: 5,
    baseTechnicianCost: 45000, // annual salary per tech
    dailyTechnicianCost: 45000 / 365,
    machineBasePrice: 399,
    // Market starts small in the post-war years, growing through the
    // baby boom and suburban expansion. ~65M households in 1945 US →
    // 100K is a fraction representing washer-buying households.
    baseYear: 1945,
    marketSize: 30000,  // total addressable market at base year
    marketGrowthRate: 0.02, // per year (faster growth in post-war boom)
  },

  // ---- Difficulty Settings ----

  difficulty: {
    easy: {
      label: 'Easy',
      description: 'AI competitors are slow to innovate and bad at pricing. You have a head start.',
      playerBonusRep: 10,
      playerBonusCash: 100000,
      // AI modifiers (lower = weaker AI)
      aiDesignFrequency: 1.5,      // multiplier on years between redesigns
      aiQualityBias: -0.2,          // penalty to component quality picks
      aiProductionScale: 0.4,       // how aggressively they produce
      aiPricingAggressiveness: 0.3, // how aggressively they undercut
      aiAdaptSpeed: 0.3,            // how fast they react to market
      aiStartingRep: 15,
      aiRepDecay: 1.2,
    },
    medium: {
      label: 'Medium',
      description: 'Balanced competition. AI keeps pace and responds to your moves.',
      playerBonusRep: 0,
      playerBonusCash: 0,
      aiDesignFrequency: 1.0,
      aiQualityBias: 0.0,
      aiProductionScale: 0.7,
      aiPricingAggressiveness: 0.5,
      aiAdaptSpeed: 0.6,
      aiStartingRep: 25,
      aiRepDecay: 1.0,
    },
    hard: {
      label: 'Hard',
      description: 'AI competitors are sharp — they design great machines, price smartly, and adapt fast.',
      playerBonusRep: -5,
      playerBonusCash: 0,
      aiDesignFrequency: 0.7,
      aiQualityBias: 0.15,
      aiProductionScale: 1.0,
      aiPricingAggressiveness: 0.7,
      aiAdaptSpeed: 0.85,
      aiStartingRep: 35,
      aiRepDecay: 0.8,
    },
    nightmare: {
      label: 'Nightmare',
      description: 'AI has cost advantages, innovates constantly, and aggressively undercuts you. Survive.',
      playerBonusRep: -10,
      playerBonusCash: -100000,
      aiDesignFrequency: 0.4,
      aiQualityBias: 0.3,
      aiProductionScale: 1.5,
      aiPricingAggressiveness: 0.9,
      aiAdaptSpeed: 1.0,
      aiStartingRep: 50,
      aiRepDecay: 0.5,
    },
  },
};
