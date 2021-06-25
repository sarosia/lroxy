const Connect = require('connect');
const morgan = require('morgan');
const http = require('http');
const https = require('https');
const Rule = require('./rule.js');

function createApp(config) {
  const app = new Connect();
  const rules = [];
  for (const rule of config.rules) {
    rules.push(new Rule(rule));
  }

  app.use(morgan('combined'));

  app.use(function(req, res) {
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

  return app;
}

exports.createHttpServer = function(config) {
  return http.createServer(createApp(config));
};

exports.createHttpsServer = function(httpsOptions, config) {
  return https.createServer(httpsOptions, createApp(config));
};
