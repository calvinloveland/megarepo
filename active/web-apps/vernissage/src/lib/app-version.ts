import packageJson from '../../package.json';

export function getAppVersion() {
  return process.env.APP_VERSION?.trim() || packageJson.version;
}
