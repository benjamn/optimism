import { AnyEntry } from "./entry";
import { Slot } from "@wry/context";

export const parentEntrySlot = new Slot<AnyEntry>();

export {
  bind as bindContext,
  noContext,
  setTimeout,
  asyncFromGen,
} from "@wry/context";
