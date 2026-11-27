/**
 * Google Drive for the API (Sprint 13 Module 12, D13-09): whether the
 * **Google Drive** button is offered, what the browser needs to open
 * Google's picker, and the binding that reads a picked file's facts.
 *
 * Offered when Clips simulation is on (a fake picker hands out made-up files
 * that copy a local sample, no Google address is reached) or when all three
 * keys are set: `GOOGLE_DRIVE_PICKER_KEY` (a browser API key for the Picker),
 * `GOOGLE_DRIVE_APP_ID` (the Google Cloud project number, which the
 * `drive.file` scope needs so the picked file is readable) and the login's
 * `GOOGLE_CLIENT_ID`. Without them the button is absent, never broken.
 *
 * The picker key and project number are public by design (Google's picker
 * runs in the browser with them); the access token is never stored here.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDriveFiles,
  createSimulatedDriveFiles,
  type DriveFiles,
  defaultSamplesDir,
  SIMULATED_DRIVE_FILE_ID,
} from '@postgear/media-tools/drive';
import type { Env } from '../../../config/env';

/** What `GET /clips/status` says about Drive. */
export type ClipDriveStatus =
  | { available: false }
  | { available: true; simulated: true; fileId: string }
  | { available: true; simulated: false; apiKey: string; appId: string; clientId: string };

@Injectable()
export class ClipDrive {
  readonly files: DriveFiles | null;
  private readonly view: ClipDriveStatus;

  constructor(config: ConfigService<Env, true>) {
    const simulated = config.get('CLIPS_SIMULATION', { infer: true }) === 'true';
    const apiKey = config.get('GOOGLE_DRIVE_PICKER_KEY', { infer: true });
    const appId = config.get('GOOGLE_DRIVE_APP_ID', { infer: true });
    const clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
    if (simulated) {
      this.files = createSimulatedDriveFiles({ samplesDir: defaultSamplesDir() });
      this.view = { available: true, simulated: true, fileId: SIMULATED_DRIVE_FILE_ID };
    } else if (apiKey && appId && clientId) {
      this.files = createDriveFiles();
      this.view = { available: true, simulated: false, apiKey, appId, clientId };
    } else {
      this.files = null;
      this.view = { available: false };
    }
  }

  status(): ClipDriveStatus {
    return this.view;
  }
}
