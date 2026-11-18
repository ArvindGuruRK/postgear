/**
 * The Clips library (Module 12): the shared sticker catalogue, favourites,
 * the public credits, and a workspace's own stickers. Its own module so
 * `ClipsModule` imports it BEFORE `ClipItemModule`: its `/clips/library` and
 * `/clips/stickers` routes must be registered before `GET /clips/:clipId`
 * (see `clips-routes.spec.ts`). `StickerProvider` and `SoundProvider` are
 * bound to the catalogue. Module 14 adds the sound routes beside the sticker
 * ones (`/clips/library/sounds` and `/clips/sounds`).
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipLibraryController } from './clip-library.controller';
import { ClipLibraryRepository } from './clip-library.repository';
import { ClipLibraryService } from './clip-library.service';
import { ClipSoundUploadsRepository } from './clip-sound-uploads.repository';
import { ClipSoundUploadsService } from './clip-sound-uploads.service';
import { ClipSoundsController } from './clip-sounds.controller';
import { ClipStickerUploadsRepository } from './clip-sticker-uploads.repository';
import { ClipStickerUploadsService } from './clip-sticker-uploads.service';
import { ClipStickersController } from './clip-stickers.controller';
import { CatalogueSoundProvider, SOUND_PROVIDER } from './sound-provider';
import { CatalogueStickerProvider, STICKER_PROVIDER } from './sticker-provider';

@Module({
  imports: [ClipsCoreModule],
  controllers: [ClipLibraryController, ClipStickersController, ClipSoundsController],
  providers: [
    ClipLibraryRepository,
    ClipLibraryService,
    ClipStickerUploadsRepository,
    ClipStickerUploadsService,
    ClipSoundUploadsRepository,
    ClipSoundUploadsService,
    { provide: STICKER_PROVIDER, useClass: CatalogueStickerProvider },
    { provide: SOUND_PROVIDER, useClass: CatalogueSoundProvider },
  ],
})
export class ClipLibraryModule {}
