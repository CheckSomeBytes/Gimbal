// Ad-hoc signs the macOS app before it's packed into the dmg/zip.
//
// Apple Silicon Macs refuse to run code without a valid signature, and
// electron-builder 24 leaves the app with a broken one when no signing
// certificate is configured (it edits Info.plist after Electron was signed).
// When a real certificate is available electron-builder signs afterwards with
// --force, replacing this ad-hoc signature.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
