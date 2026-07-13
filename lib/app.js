const express = require('express');
const ws = require('ws');
const Rule = require('./rule.js');
const logger = require('./logger.js');
const CertProvider = require('./cert');
const { Duration } = require('@sarosia/datetime');
const http = require('http');
const https = require('https');
const config = require('rc')('lroxy', {
  email: null,
  commonName: null,
  httpPort: 8080,
  httpsPort: null,
  rules: [],
});

const app = express();
const rules = [];
for (const rule of config.rules) {
  rules.push(new Rule(rule));
}
const certProvider = new CertProvider(config, rules);

app.use((req, res, next) => {
  next();
  logger.info('Handled request.', {
    remoteAddress: req.socket.remoteAddress,
    method: req.method,
    referer: req.headers.referer,
    userAgent: req.headers['user-agent'],
    url: `${req.secure ? 'https' : 'http'}://${req.hostname}${req.url}`,
    statusCode: res.statusCode,
    proxyTo: res.proxyToAddress,
  });
});

app.get('/.well-known/acme-challenge/:token', (req, res) => {
  const challenge = certProvider.getChallenge(req.params.token);
  res.write(challenge);
  res.end();
});

app.use((req, res) => {
  if (config.httpsPort != null && !req.secure) {
    return res.redirect('https://' + req.headers.host + req.url);
  }

  for (const rule of rules) {
    if (rule.match(req)) {
      rule.handle(req, res);
      return;
    }
  }

  // By default, reply service unavaliable if there is no matching reverse
  // proxy rule.
  res.writeHead(503, 'Service Unavaliable');
  res.end('Service Unavaliable');
});

async function checkAndRenewCert(server) {
  try {
    logger.info('Performing certificate status check...');
    const sslInfo = await certProvider.getSslInfo(true);
    if (server) {
      server.setSecureContext({
        key: sslInfo.key,
        cert: sslInfo.cert,
      });
      logger.info('Certificate context successfully verified/hot-swapped.');
    }
  } catch (err) {
    logger.error('Failed to automatically check/renew certificate:', err);
  }
}

async function startRenewalLoop(server) {
  while (server && server.listening) {
    try {
      await Duration.days(1).sleep();
      if (!server.listening) break;
      await checkAndRenewCert(server);
    } catch (err) {
      if (server && !server.listening) break;
      logger.error('Error in certificate renewal loop:', err);
      // Wait 1 hour before retrying in case of sleep/timer issues
      try {
        await Duration.hours(1).sleep();
      } catch (sleepErr) {
        if (server && !server.listening) break;
        // Fallback setTimeout if Duration sleep fails
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 3600000);
          if (timer.unref) timer.unref();
        });
      }
    }
  }
}

module.exports = async function() {
  try {
    let server = http.createServer(app);
    let secure = false;
    server.listen(config.httpPort);
    logger.info(`lroxy (http) started on ${config.httpPort}.`);

    if (config.httpsPort != null) {
      secure = true;
      const sslInfo = await certProvider.getSslInfo();
      server = https.createServer({
        key: sslInfo.key,
        cert: sslInfo.cert,
      }, app);
      server.listen(config.httpsPort);
      logger.info(`lroxy (https) started on ${config.httpsPort}.`);

      startRenewalLoop(server);
    }

    const wsServer = new ws.Server({server});
    wsServer.on('connection', (socket, req) => {
      for (const rule of rules) {
        if (rule.match(req)) {
          rule.handleWs(socket, req);
          logger.info('Handled websocket request.', {
            remoteAddress: req.socket.remoteAddress,
            method: req.method,
            userAgent: req.headers['user-agent'],
            url: `${secure ? 'https' : 'http'}://${req.headers['host']}${req.url}`,
            proxyTo: rule.getToAddress(),
          });
          return;
        }
      }
      socket.close(1011, 'Service Unavaliable');
    });
  } catch (e) {
    logger.error(e);
    logger.on('finish', () => {
      process.exit(1);
    });
    logger.end();
  }
};
