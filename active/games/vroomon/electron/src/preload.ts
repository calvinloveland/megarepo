import { contextBridge } from "electron";

import {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
  type DecodedDnaV2,
} from "./shared/dna-v2.js";

const api = {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
};

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
    };
  }
}

contextBridge.exposeInMainWorld("vroomon", api);
