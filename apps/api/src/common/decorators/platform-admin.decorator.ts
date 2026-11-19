/**
 * `@PlatformAdmin()` (Sprint 12, Module 19): a route for platform operators
 * only. Put it on an operator controller's class. See `PlatformAdminGuard`
 * for who passes; the metadata lets a test (and a reader) find every
 * operator route.
 */
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';

export const PLATFORM_ADMIN_KEY = 'auth:platformAdmin';

export const PlatformAdmin = () =>
  applyDecorators(SetMetadata(PLATFORM_ADMIN_KEY, true), UseGuards(PlatformAdminGuard));
