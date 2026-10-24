// Writes www/version.js from package.json so the app knows its own version (for the update check).
// docs/version.json (what the app reads from GitHub Pages) is written by the release workflow only after the APK is
// published, so phones never see a version whose APK is not there yet.
const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');
fs.writeFileSync(path.join(__dirname, '../www/version.js'), `window.APP_VERSION = '${version}';\n`);
