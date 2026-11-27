// `defaultSamplesDir` is left out: the package root already exports it from the downloader.
export {
  createDriveFiles,
  createSimulatedDriveFiles,
  DRIVE_FILE_ID_PATTERN,
  DriveError,
  type DriveErrorCode,
  type DriveFetchInput,
  type DriveFileFacts,
  type DriveFiles,
  driveStatusCode,
  SIMULATED_DRIVE_FILE_ID,
  SIMULATED_DRIVE_FILES,
} from './drive';
