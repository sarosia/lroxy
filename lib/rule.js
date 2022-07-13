const http = require('http');
const https = require('https');
const ws = require('ws');

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

  handleWs(socket, req) {
    const client = new ws.WebSocket('ws://' + this.getToAddress() + req.url, {
      headers: {cookie: req.headers.cookie},
    });

    client.on('open', () => {
      socket.on('message', (data, isBinary) => {
        client.send(data, {binary: isBinary});
      });
    });

    socket.on('close', () => {
      client.close();
    });

    client.on('message', (data, isBinary)=> {
      socket.send(data, {binary: isBinary});
    });

    client.on('close', () => {
      socket.close();
    });

    client.on('error', (error) => {
      socket.close(1011, 'Bad Gateway');
    });
  }

  handle(req, res) {
    res.proxyToAddress = this.getToAddress();
    const client = this._to['ssl'] ? https : http;
    const headers = req.headers;
    headers['x-forwarded-for'] = req.socket.remoteAddress;
    const outboundReq =
        client.request({
          host: this._to['host'],
          port: this._to['port'],
          method: req.method,
          path: req.url,
          headers: headers,
        },
        (outboundRes) => {
          // Use setHeader instead of writeHead since writeHead
          // does not work very well with nodejs 0.10.x.
          res.statusCode = outboundRes.statusCode;
          res.statusMessage = outboundRes.statusMessage;
          for (const [headerName, headerValue] of Object.entries(
              outboundRes.headers)) {
            res.setHeader(headerName, headerValue);
          }
          outboundRes.on('data', (data) => {
            res.write(data);
          });
          outboundRes.on('end', () => {
            res.end();
          });
        });

    // Whenever there is error happening for the outbound request, respond 502
    // for the inbound request.
    outboundReq.on('error', (error) => {
      console.log('Error', error);
      res.writeHead(502, 'Bad Gateway');
      res.write('Bad Gateway');
      res.end();
    });

    req.on('data', (data) => {
      outboundReq.write(data);
    });

    req.on('end', () => {
      outboundReq.end();
    });

    req.on('close', () => {
      outboundReq.end();
    });
  }
}

module.exports = Rule;
