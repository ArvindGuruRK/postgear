import { Module } from '@nestjs/common';
import { SignaturesController } from './signatures.controller';
import { SignaturesRepository } from './signatures.repository';
import { SignaturesService } from './signatures.service';

/**
 * Signatures (2026-10-19): a workspace's saved sign-offs and its default.
 * Self-contained: nothing else reads the table, and the composer inserts a
 * signature's text into the post it is editing, so no post refers to one.
 */
@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService, SignaturesRepository],
})
export class SignaturesModule {}
