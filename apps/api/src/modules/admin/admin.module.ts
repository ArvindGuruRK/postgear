/**
 * The operator screens' API (Sprint 12, Module 19 section 7): everything a
 * platform operator does, under `/operator/*`, each controller guarded by
 * `@PlatformAdmin()`. Part A brings the rights request removal; Part B adds
 * plans, overrides, usage, the Change Log and the library. Sprint 13 Module
 * 15 adds the Clips costs read (`GET /operator/clips/costs`).
 *
 * Imports the shared Clips core (retention, the resolver and the usage ledger
 * through the entitlements module it re-exports, and both storage spaces
 * through the media module) and notifications; `MailService` and
 * `RedisService` are global.
 */
import { Module } from '@nestjs/common';
import { ClipsCoreModule } from '../clips/clips-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperatorClipsController } from './clips/operator-clips.controller';
import { OperatorClipsService } from './clips/operator-clips.service';
import { OperatorCostsController } from './costs/operator-costs.controller';
import { OperatorCostsRepository } from './costs/operator-costs.repository';
import { OperatorCostsService } from './costs/operator-costs.service';
import {
  OperatorChangesController,
  OperatorPlansController,
  OperatorWorkspacesController,
} from './entitlements/operator-entitlements.controller';
import { OperatorEntitlementsRepository } from './entitlements/operator-entitlements.repository';
import { OperatorEntitlementsService } from './entitlements/operator-entitlements.service';
import { OperatorLibraryController } from './library/operator-library.controller';
import { OperatorLibraryRepository } from './library/operator-library.repository';
import { OperatorLibraryService } from './library/operator-library.service';
import { OperatorAuditService } from './operator-audit.service';

@Module({
  imports: [ClipsCoreModule, NotificationsModule],
  controllers: [
    OperatorClipsController,
    OperatorPlansController,
    OperatorWorkspacesController,
    OperatorChangesController,
    OperatorLibraryController,
    OperatorCostsController,
  ],
  providers: [
    OperatorAuditService,
    OperatorClipsService,
    OperatorEntitlementsRepository,
    OperatorEntitlementsService,
    OperatorLibraryRepository,
    OperatorLibraryService,
    OperatorCostsRepository,
    OperatorCostsService,
  ],
  exports: [OperatorClipsService],
})
export class AdminModule {}
