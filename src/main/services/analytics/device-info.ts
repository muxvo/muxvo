import { app } from 'electron';
import os from 'os';

export function getDeviceInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    os_version: os.release(),
    app_version: app.getVersion(),
    hostname: os.hostname(),
  };
}
