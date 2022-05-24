const http = require('http');
const https = require('https');

class Rule {
  constructor(config) {
    this._from = config['from'];
    this._to = config['to'];
  }

  getToAddress() {
    return this._to['host'] + ':' + this._to['port'];
  }

  getFromHost() {
    return this._from['host'];
  }

  match(req) {
    const host = req.headers['host'].split(':')[0];
    return host === this._from['host'];
  }

  handle(req, res) {
    res.proxyToAddress = this.getToAddress();

    const outboundReq = (this._to['ssl'] ? https : http).request({
      host: this._to['host'],
      port: this._to['port'],
      method: req.method,
      path: req.url,
      headers: req.headers,
    }, function(outboundRes) {
      // Use setHeader instead of writeHead since writeHead does not work
      // very well with nodejs 0.10.x.
      res.statusCode = outboundRes.statusCode;
      res.statusMessage = outboundRes.statusMessage;
      for (const [headerName, headerValue]
        of Object.entries(outboundRes.headers)) {
        res.setHeader(headerName, headerValue);
      }

      outboundRes.on('data', function(data) {
        res.write(data);
      });

      outboundRes.on('end', function() {
        res.end();
      });
    });

    // Whenever there is error happening for the outbound request, respond 502
    // for the inbound request.
    outboundReq.on('error', function(error) {
      console.log('Error', error);
      res.writeHead(502, 'Bad Gateway');
      res.write('Bad Gateway');
      res.end();
    });

    req.on('data', function(data) {
      outboundReq.write(data);
    });

    req.on('end', function() {
      outboundReq.end();
    });

    req.on('close', function() {
      outboundReq.abort();
    });
  }
}

module.exports = Rule;
