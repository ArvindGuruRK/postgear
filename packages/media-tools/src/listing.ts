/**
 * `@postgear/media-tools/listing`: the one part of media-tools the API may
 * import (Module 03, section 5). It serves the simulated channel lister and
 * its fixture helpers, so `CLIPS_SIMULATION=true` lists channels in the API
 * process with no worker and no network.
 *
 * Pure on purpose: zod, a JSON fixture and the engine, nothing else. The
 * package root pulls in the process runner (`src/run/`), which only the
 * worker may load; `listing.test.ts` walks this file's import graph and fails
 * if it ever reaches `src/run/` or Node's process module.
 */
export { channelKey } from './channels/channel-key';
export {
  createSimulatedChannelLister,
  type SimulatedListerOptions,
} from './channels/simulated.lister';
export {
  findSimulatedItem,
  isSimulatedHandle,
  type SimulatedChannel,
  type SimulatedItem,
  simulatedChannel,
  simulatedItems,
} from './channels/simulation-fixture';
