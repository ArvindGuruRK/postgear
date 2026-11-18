/**
 * A ready video's pictures and sound, signed (Sprint 12, Modules 04 and 07):
 * the light copy to play, the filmstrip sheets and the waveform. The video
 * page (`GET /clips/videos/:videoId`) and the editor (`GET /clips/:clipId`)
 * answer the same shapes from here, so their timelines read one contract.
 *
 * `signOnce` wraps the signer so each stored file is signed at most once per
 * request: a page of twenty clips of one video signs its light copy once.
 * Keys stay inside the API; only the signed addresses leave.
 */
import type { ClipAsset } from '@postgear/db';
import type { SignedAddress } from './clip-playback.service';
import {
  filmstripMetaOf,
  latestAsset,
  orderedSheets,
  proxyMetaOf,
  waveformMetaOf,
} from './clip-video-view';

export type Signer = (key: string) => Promise<SignedAddress | null>;

export interface VideoMedia {
  /** The light copy, playable and seekable, for six hours. */
  playback: SignedAddress | null;
  proxy: { width: number; height: number; fps: number } | null;
  filmstrip: {
    meta: NonNullable<ReturnType<typeof filmstripMetaOf>>;
    /** One address per sheet, in strip order. */
    sheets: string[];
    expiresAt: string;
  } | null;
  waveform: {
    url: string;
    meta: NonNullable<ReturnType<typeof waveformMetaOf>>;
    expiresAt: string;
  } | null;
}

export const NO_VIDEO_MEDIA: VideoMedia = {
  playback: null,
  proxy: null,
  filmstrip: null,
  waveform: null,
};

/** A signer that signs each key once, however often it is asked. */
export function signOnce(sign: Signer): Signer {
  const signed = new Map<string, Promise<SignedAddress | null>>();
  return (key) => {
    let address = signed.get(key);
    if (!address) {
      address = sign(key);
      signed.set(key, address);
    }
    return address;
  };
}

/** The signed light copy, filmstrip and waveform of a ready video's assets. */
export async function signVideoMedia(
  assets: readonly ClipAsset[],
  sign: Signer,
): Promise<VideoMedia> {
  const proxyAsset = latestAsset(assets, 'PROXY');
  const waveAsset = latestAsset(assets, 'WAVEFORM');
  const sheets = orderedSheets(assets);
  const filmMeta = sheets[0] ? filmstripMetaOf(sheets[0].meta) : null;

  const [playback, sheetAddresses, wave] = await Promise.all([
    proxyAsset ? sign(proxyAsset.key) : Promise.resolve(null),
    filmMeta ? Promise.all(sheets.map((sheet) => sign(sheet.key))) : Promise.resolve([]),
    waveAsset ? sign(waveAsset.key) : Promise.resolve(null),
  ]);
  const waveMeta = waveAsset ? waveformMetaOf(waveAsset.meta) : null;
  const signedSheets = sheetAddresses.filter(
    (address): address is SignedAddress => address !== null,
  );

  return {
    playback,
    proxy: proxyAsset ? proxyMetaOf(proxyAsset.meta) : null,
    filmstrip:
      filmMeta && signedSheets.length === sheets.length && signedSheets[0]
        ? {
            meta: filmMeta,
            sheets: signedSheets.map((s) => s.url),
            expiresAt: signedSheets[0].expiresAt,
          }
        : null,
    waveform:
      wave && waveMeta ? { url: wave.url, meta: waveMeta, expiresAt: wave.expiresAt } : null,
  };
}
