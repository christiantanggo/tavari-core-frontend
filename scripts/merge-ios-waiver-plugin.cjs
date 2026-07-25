/**
 * Capacitor sync overwrites ios/App/App/capacitor.config.json packageClassList
 * with only classes from node_modules plugins. Re-append the local WaiverNavigationPlugin.
 */
const fs = require('fs');
const path = require('path');

const capPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'capacitor.config.json');
if (!fs.existsSync(capPath)) {
  console.warn('[merge-ios-waiver-plugin] Skip: capacitor.config.json not found (run cap add ios first)');
  process.exit(0);
}
const j = JSON.parse(fs.readFileSync(capPath, 'utf8'));
j.packageClassList = Array.isArray(j.packageClassList) ? j.packageClassList : [];
if (!j.packageClassList.includes('WaiverNavigationPlugin')) {
  j.packageClassList.push('WaiverNavigationPlugin');
}
fs.writeFileSync(capPath, JSON.stringify(j, null, '\t') + '\n');
console.log('[merge-ios-waiver-plugin] packageClassList:', j.packageClassList);
