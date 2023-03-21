import { Slot } from "@wry/context";
import { AnyEntry } from "./entry.js";

export const parentEntrySlot = new Slot<AnyEntry>();

export {
  bind as bindContext,
  noContext,
  setTimeout,
  asyncFromGen,
} from "@wry/context";
