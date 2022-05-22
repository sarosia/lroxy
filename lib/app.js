const express = require('express');
const Rule = require('./rule.js');
const logger = require('./logger.js');
const config = require('rc')('lroxy', {
  port: 8080,
  rules: [],
});

const app = express();
const rules = [];
for (const rule of config.rules) {
  rules.push(new Rule(rule));
}

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

module.exports = function() {
  app.listen(config.port);
  logger.info(`lroxy started on ${config.port}.`);
};
