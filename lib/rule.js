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
        res.writeHead(outboundRes.statusCode, outboundRes.statusMessage, outboundRes.headers);

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
};
