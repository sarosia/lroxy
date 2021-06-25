process.bin = process.title = 'lroxy';

const app = require('./lib/app.js');
const fs = require('fs');
const config = require('rc')('lroxy', {
  httpPort: 80,
  httpsPort: 443,
  ssl: false,
  rules: [],
});

let home = process.env['HOME'];
if (process.env['SUDO_USER']) {
  home = '/home/' + process.env['SUDO_USER'];
}

app.createHttpServer(config).listen(config['httpPort'], function() {
  console.log('Running HTTP proxy on ' + config['httpPort']);
});

function readFileOrNull(path) {
  if (path == null) {
    return null;
  }
  return fs.readFileSync(path);
}

if (config['ssl']) {
  const key = readFileOrNull(config['sslKeyPath']);
  const cert = readFileOrNull(config['sslCertPath']);
  const ca = readFileOrNull(config['sslCaPath']);
  const pfx = readFileOrNull(config['sslPfxPath']);
  app.createHttpsServer({
    key: key, cert: cert, ca: ca, pfx: pfx,
  }, config).listen(config['httpsPort'], () => {
    console.log('Running HTTPS proxy on ' + config['https_port']);
  });
}

// If the program is running with sudo, downgrade the permission to the
// group/user that run this command.
if (process.env['SUDO_GID']) {
  process.setgid(~~process.env['SUDO_GID']);
}
if (process.env['SUDO_UID']) {
  process.setuid(~~process.env['SUDO_UID']);
}
