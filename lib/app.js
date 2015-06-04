var connect = require("connect");
var morgan = require("morgan");
var http = require("http");
var https = require("https");
var Rule = require("./rule.js");

function createApp(config) {
    var app = new connect();
    var rules = [];
    for (var i = 0; i < config.rules.length; i++) {
        rules.push(new Rule(config.rules[i]));
    }

    app.use(morgan("combined"));

    app.use(function (req, res) {
        for (var i = 0; i < rules.length; i++) {
            if (rules[i].match(req)) {
                rules[i].handle(req, res);
                return;
            }
        }

        // By default, reply service unavaliable if there is no matching reverse
        // proxy rule.
        res.writeHead(503, "Service Unavaliable");
        res.end("Service Unavaliable");
    });

    return app;
}

var createHttpServer = exports.createHttpServer = function (config) {
    return http.createServer(createApp(config));
};

var createHttpsServer = exports.createHttpsServer = function (httpsOptions, config) {
    return https.createServer(httpsOptions, createApp(config));
};
