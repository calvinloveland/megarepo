import type { DecodedDnaV2 } from "../shared/dna-v2.js";

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
    };
  }
}

const dnaInput = document.querySelector<HTMLInputElement>("[data-dna-input]");
const randomizeButton = document.querySelector<HTMLButtonElement>(
  "[data-randomize-dna]",
);
const output = document.querySelector<HTMLElement>("[data-dna-output]");

if (!dnaInput || !randomizeButton || !output) {
  throw new Error("Renderer UI did not initialize correctly.");
}

const dnaInputElement = dnaInput;
const randomizeButtonElement = randomizeButton;
const outputElement = output;

function renderDecodedDna(dna: string): void {
  const cleanedDna = window.vroomon.cleanDna(dna);
  const decoded = window.vroomon.decodeDnaV2(cleanedDna);
  const wheelCount = decoded.modules.filter((module) => module === "W").length;
  const rectangleCount = decoded.modules.length - wheelCount;

  outputElement.textContent = JSON.stringify(
    {
      dna: decoded.dna,
      moduleCount: decoded.modules.length,
      modules: decoded.modules,
      powertrainModules: decoded.powertrainModules,
      rectangleCount,
      wheelCount,
      positions: decoded.positions.map((position) => Number(position.toFixed(2))),
      globals: {
        ...decoded.globals,
        comShift: Number(decoded.globals.comShift.toFixed(3)),
        dampingLinear: Number(decoded.globals.dampingLinear.toFixed(3)),
        dampingAngular: Number(decoded.globals.dampingAngular.toFixed(3)),
        temperature: Number(decoded.globals.temperature.toFixed(3)),
      },
    },
    null,
    2,
  );
}

randomizeButtonElement.addEventListener("click", () => {
  const nextDna = window.vroomon.createRandomDna(12);
  dnaInputElement.value = nextDna;
  renderDecodedDna(nextDna);
});

dnaInputElement.addEventListener("input", () => {
  renderDecodedDna(dnaInputElement.value);
});

renderDecodedDna(dnaInputElement.value);
