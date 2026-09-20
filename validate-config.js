#!/usr/bin/env node

/**
 * Validation script for electron-builder configuration
 * Checks if the artifactName configuration will produce correct filenames
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('  Gimbal Auto-Update Configuration Validator');
console.log('='.repeat(60));
console.log('');

// Read package.json
const packagePath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const version = packageJson.version;
const buildConfig = packageJson.build;

console.log('📦 Package Information:');
console.log(`  Name: ${buildConfig.productName}`);
console.log(`  Version: ${version}`);
console.log('');

// Check artifact naming
console.log('🔧 Artifact Naming Configuration:');

const portableArtifactName = buildConfig.artifactName;
const nsisArtifactName = buildConfig.nsis?.artifactName;

console.log(`  Portable: ${portableArtifactName || '(default)'}`);
console.log(`  NSIS: ${nsisArtifactName || '(default)'}`);
console.log('');

// Simulate filenames
function expandTemplate(template, productName, version, ext) {
  return template
    .replace('${productName}', productName)
    .replace('${version}', version)
    .replace('${ext}', ext);
}

console.log('📁 Expected Output Filenames:');

if (portableArtifactName) {
  const portableFilename = expandTemplate(portableArtifactName, buildConfig.productName, version, 'exe');
  console.log(`  ✅ Portable: ${portableFilename}`);
} else {
  console.log(`  ⚠️  Portable: Gimbal.${version}.exe (default - uses dots)`);
}

if (nsisArtifactName) {
  const nsisFilename = expandTemplate(nsisArtifactName, buildConfig.productName, version, 'exe');
  console.log(`  ✅ NSIS Installer: ${nsisFilename}`);
} else {
  console.log(`  ⚠️  NSIS Installer: Gimbal.Setup.${version}.exe (default - uses dots)`);
}

console.log('');

// Check publish configuration
console.log('🌐 Publish Configuration:');
if (buildConfig.publish) {
  console.log(`  ✅ Provider: ${buildConfig.publish.provider}`);
  console.log(`  ✅ Owner: ${buildConfig.publish.owner}`);
  console.log(`  ✅ Repo: ${buildConfig.publish.repo}`);
} else {
  console.log('  ❌ No publish configuration found!');
}
console.log('');

// Validation checks
console.log('✔️  Validation Checks:');

const checks = [];

// Check 1: artifactName is set
if (portableArtifactName) {
  checks.push({ pass: true, message: 'Portable artifactName is configured' });
} else {
  checks.push({ pass: false, message: 'Portable artifactName is NOT set (will use dots)' });
}

// Check 2: nsis artifactName is set
if (nsisArtifactName) {
  checks.push({ pass: true, message: 'NSIS artifactName is configured' });
} else {
  checks.push({ pass: false, message: 'NSIS artifactName is NOT set (will use dots)' });
}

// Check 3: Uses hyphens instead of dots
if (portableArtifactName && portableArtifactName.includes('-')) {
  checks.push({ pass: true, message: 'Portable filename uses hyphens (correct)' });
} else if (portableArtifactName) {
  checks.push({ pass: false, message: 'Portable filename should use hyphens, not dots' });
}

if (nsisArtifactName && nsisArtifactName.includes('-')) {
  checks.push({ pass: true, message: 'NSIS filename uses hyphens (correct)' });
} else if (nsisArtifactName) {
  checks.push({ pass: false, message: 'NSIS filename should use hyphens, not dots' });
}

// Check 4: Publish config exists
if (buildConfig.publish && buildConfig.publish.provider === 'github') {
  checks.push({ pass: true, message: 'GitHub publish configuration is set' });
} else {
  checks.push({ pass: false, message: 'GitHub publish configuration is missing' });
}

// Print results
checks.forEach(check => {
  const icon = check.pass ? '✅' : '❌';
  console.log(`  ${icon} ${check.message}`);
});

console.log('');

// Overall result
const allPassed = checks.every(c => c.pass);
if (allPassed) {
  console.log('🎉 All checks passed! Configuration looks good.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Build the app: npm run build');
  console.log('  2. Package the app: npm run package');
  console.log('  3. Check dist/ folder for correct filenames');
  console.log('  4. Create a release to test auto-update');
} else {
  console.log('⚠️  Some checks failed. Review the configuration.');
  console.log('');
  console.log('Recommended fixes:');
  console.log('  1. Add artifactName to package.json build config');
  console.log('  2. Add artifactName to nsis config');
  console.log('  3. Use hyphens in filenames, not dots');
}

console.log('');
console.log('='.repeat(60));
