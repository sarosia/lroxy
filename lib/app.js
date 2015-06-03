var connect = require("connect");
var morgan = require("morgan");
var fs = require("fs");
var http = require("http");
var https = require("https");
var userHome = require("user-home");
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

// Only run the application if it is not required by other nodejs file.
if (require.main === module) {
    var config = JSON.parse(fs.readFileSync(userHome + "/.lroxy.json"));

    createHttpServer(config).listen(config["http_port"], function () {
        console.log("Running HTTP proxy on " + config["http_port"]);
    });

    if (config["ssl"]) {
        var key = fs.readFileSync(config["sslKeyPath"]).toString();
        var cert = fs.readFileSync(config["sslCertPath"]).toString();
        createHttpsServer({ key: key, cert: cert }, config).listen(config["https_port"], function () {
            console.log("Running HTTPS proxy on " + config["https_port"]);
        });
    }

    // If the program is running with sudo, downgrade the permission to the
    // group/user that run this command.
    if (process.env["SUDO_GID"]) {
        process.setgid(process.env["SUDO_GID"]);
    }
    if (process.env["SUDO_UID"]) {
        process.setuid(process.env["SUDO_UID"]);
    }
}
