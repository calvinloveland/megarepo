// Explicit simulator -> future firmware implementation roadmap.
// This is not runtime logic; it is a machine-readable map so docs and tests can
// pin what each current simulator module is expected to become in ESP-IDF.

export const FIRMWARE_PORT_MAP = Object.freeze([
  {
    simModule: 'src/calibration-config.mjs',
    firmwareComponent: 'shared calibration constants',
    responsibility: 'Canonical chirp/gap/emit timing copied verbatim into firmware headers/config.',
  },
  {
    simModule: 'src/firmware-protocol.mjs',
    firmwareComponent: 'mesh packet schema',
    responsibility: 'JSON/CBOR packet shapes for calibration plans and listener-row broadcasts.',
  },
  {
    simModule: 'src/firmware-backend.mjs',
    firmwareComponent: 'ESP-IDF task boundary',
    responsibility: 'Clock sync, chirp scheduler, mic capture, and mesh transport hooks implemented by real tasks.',
  },
  {
    simModule: 'src/world.mjs',
    firmwareComponent: 'node config + coarse clock-sync state',
    responsibility: 'Replace simulator truth/random layout with persisted device config and real sync status.',
  },
  {
    simModule: 'src/capture.mjs',
    firmwareComponent: 'audio capture pipeline',
    responsibility: 'Replace synthetic arrivals with I2S/PDM sample capture and per-emission listener-row measurement.',
  },
  {
    simModule: 'src/dsp.mjs',
    firmwareComponent: 'on-device TOA estimator',
    responsibility: 'Chirp generation / matched filter / earliest-peak detector ported to MCU-friendly math.',
  },
  {
    simModule: 'src/mesh.mjs',
    firmwareComponent: 'Wi-Fi / ESP-MESH row gossip',
    responsibility: 'Broadcast one listener-row packet per node and reassemble the matrix at a coordinator or peers.',
  },
  {
    simModule: 'src/localize.mjs',
    firmwareComponent: 'solver service',
    responsibility: 'Run localization either on a designated coordinator node or off-device service using the same math.',
  },
  {
    simModule: 'src/surround.mjs',
    firmwareComponent: 'runtime panner / speaker compensation',
    responsibility: 'Map 5.1 channels onto discovered speakers and apply per-speaker delay/gain compensation.',
  },
  {
    simModule: 'src/render.mjs',
    firmwareComponent: 'offline validation only',
    responsibility: 'Keep in the simulator/test harness as a validation oracle rather than porting to firmware.',
  },
  {
    simModule: 'src/scenario.mjs',
    firmwareComponent: 'integration harness / coordinator state machine',
    responsibility: 'Sequence sync -> sweep -> gossip -> solve -> surround setup in the same order on hardware.',
  },
  {
    simModule: 'app.js',
    firmwareComponent: 'operator UI / debug dashboard',
    responsibility: 'Stay in the browser or desktop tooling as a control/debug surface, not on-device firmware.',
  },
]);
