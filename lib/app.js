const express = require('express');
const Rule = require('./rule.js');
const logger = require('./logger.js');
const Acme = require('./acme');
const http = require('http');
const https = require('https');
const config = require('rc')('lroxy', {
  email: '',
  httpPort: 8080,
  httpsPort: 8443,
  rules: [],
});

const app = express();
const rules = [];
for (const rule of config.rules) {
  rules.push(new Rule(rule));
}
const names = {};
for (const rule of rules) {
  names[rule.getFromHost()] = true;
}
delete names[config.commonName];

const acme = new Acme(config.email, config.commonName, Object.keys(names));

app.use((req, res, next) => {
  next();
  logger.info('Handled request.', {
    remoteAddress: req.connection.remoteAddress,
    method: req.method,
    referer: req.headers.referer,
    userAgent: req.headers['user-agent'],
    host: req.headers.host,
    url: req.url,
    statusCode: res.statusCode,
    proxyTo: res.proxyToAddress,
  });
});

app.get('/.well-known/acme-challenge/:token', (req, res) => {
  const challenge = acme.getChallenge(req.params.token);
  res.write(challenge);
  res.end();
});

app.use((req, res) => {
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

module.exports = async function() {
  http.createServer(app).listen(config.httpPort);
  logger.info(`lroxy (http) started on ${config.httpPort}.`);
  const sslInfo = await acme.run();
  https.createServer({
    key: sslInfo.key,
    cert: sslInfo.cert,
  }, app).listen(config.httpsPort);
  logger.info(`lroxy (https) started on ${config.httpsPort}.`);
};
