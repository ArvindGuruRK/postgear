/**
 * Channel listing in media-tools (Module 03, section 5): the yt-dlp flat
 * lister and the simulated lister. The Twitch Helix and YouTube Data API
 * listers live in the API.
 */
export {
  channelKey,
  channelPageUrl,
  type FlatListArgsInput,
  flatListArgs,
  LISTING_EXTRACTOR_ALLOWLIST,
  LISTING_EXTRACTORS,
} from './flat-list.args';
export { type FlatListContext, type FlatPlaylistFacts, parseFlatList } from './flat-list.parse';
export { createYtDlpFlatLister, type FlatListerOptions, flatListError } from './flat.lister';
export { createSimulatedChannelLister, type SimulatedListerOptions } from './simulated.lister';
export {
  findSimulatedItem,
  isSimulatedHandle,
  type SimulatedChannel,
  type SimulatedItem,
  simulatedChannel,
  simulatedItems,
} from './simulation-fixture';
export * from './types';
