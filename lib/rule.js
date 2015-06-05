var http = require("http");
var https = require("https");

var Rule = module.exports = function (config) {
    this._from = config["from"];
    this._to = config["to"];
}

Rule.prototype.match = function (req) {
    return this._from["host"] === req.headers["host"];
};

Rule.prototype.handle = function (req, res) {
    var outboundReq = (this._to["ssl"] ? https : http).request({
        host: this._to["host"],
        port: this._to["port"],
        method: req.method,
        path: req.url,
        headers: req.headers,
    }, function (outboundRes) {
        // Use setHeader instead of writeHead since writeHead does not work
        // very well with nodejs 0.10.x.
        res.statusCode = outboundRes.statusCode;
        res.statusMessage = outboundRes.statusMessage;
        for (var headerName in outboundRes.headers) {
            res.setHeader(headerName, outboundRes.headers[headerName]);
        }

        outboundRes.on("data", function (data) {
            res.write(data);
        });
    
        outboundRes.on("end", function () {
            res.end();
        });
    });

    // Whenever there is error happening for the outbound request, respond 502
    // for the inbound request.
    outboundReq.on("error", function (error) {
        console.log("Error", error);
        res.writeHead(502, "Bad Gateway");
        res.write("Bad Gateway");
        res.end();
    });

    req.on("data", function (data) {
        outboundReq.write(data);
    });

    req.on("end", function () {
        outboundReq.end();
    });

    req.on("close", function () {
        outboundReq.abort();
    });
};
