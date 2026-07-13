const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const { Duration } = require('@sarosia/datetime');
const CertProvider = require('../lib/cert');

describe('App - Certificate Renewal Loop & Hot-Swapping', () => {
  const tempKeyPath = '/tmp/app_key_valid.pem';
  const tempCertPath = '/tmp/app_cert_valid.pem';
  let validKey = '';
  let validCert = '';

  let activeServers = [];
  let setSecureContextCalled = false;
  let secureContextOptions = null;
  let originalHttpCreateServer;
  let originalHttpsCreateServer;
  let originalGetSslInfo;
  let originalSleep;

  // Retrieve the hidden DurationImpl class via an instance of Duration
  const dummyDuration = Duration.days(1);
  const DurationImpl = dummyDuration.constructor;

  before(() => {
    // Generate valid self-signed certificate and key for HTTPS server initialization
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${tempKeyPath} ` +
      `-out ${tempCertPath} -days 365 -nodes -subj "/CN=example.com"`,
      { stdio: 'ignore' }
    );
    validKey = fs.readFileSync(tempKeyPath, 'utf8');
    validCert = fs.readFileSync(tempCertPath, 'utf8');

    // Set environment variables for config loading
    process.env.lroxy_httpPort = '0';
    process.env.lroxy_httpsPort = '0';
    process.env.lroxy_commonName = 'test.example.com';
    process.env.lroxy_email = 'test@example.com';

    // Intercept server creation
    originalHttpCreateServer = http.createServer;
    originalHttpsCreateServer = https.createServer;

    http.createServer = function(...args) {
      const server = originalHttpCreateServer(...args);
      activeServers.push(server);
      return server;
    };

    https.createServer = function(options, app) {
      const server = originalHttpsCreateServer(options, app);
      activeServers.push(server);

      // Spy on setSecureContext
      const originalSetSecureContext = server.setSecureContext;
      server.setSecureContext = function(opts) {
        setSecureContextCalled = true;
        secureContextOptions = opts;
        return originalSetSecureContext.call(server, opts);
      };

      return server;
    };

    // Stub CertProvider to return valid temporary certs
    originalGetSslInfo = CertProvider.prototype.getSslInfo;
    CertProvider.prototype.getSslInfo = async function(forceCheck) {
      return {
        key: validKey,
        cert: validCert,
      };
    };
  });

  after(() => {
    // Clean up temporary cert files
    try {
      fs.unlinkSync(tempKeyPath);
      fs.unlinkSync(tempCertPath);
    } catch (err) {}

    // Restore original methods
    http.createServer = originalHttpCreateServer;
    https.createServer = originalHttpsCreateServer;
    CertProvider.prototype.getSslInfo = originalGetSslInfo;

    // Clean up environment variables
    delete process.env.lroxy_httpPort;
    delete process.env.lroxy_httpsPort;
    delete process.env.lroxy_commonName;
    delete process.env.lroxy_email;
  });

  beforeEach(() => {
    setSecureContextCalled = false;
    secureContextOptions = null;
    activeServers = [];
    originalSleep = DurationImpl.prototype.sleep;
  });

  afterEach(() => {
    for (const server of activeServers) {
      server.close();
    }
    DurationImpl.prototype.sleep = originalSleep;
  });

  it('should run renewal loop, check certificates, and hot-swap context', async () => {
    let sleepCallCount = 0;

    // Stub sleep on DurationImpl to resolve immediately on first call, then throw to break loop
    DurationImpl.prototype.sleep = async function() {
      sleepCallCount++;
      if (sleepCallCount === 1) {
        // First sleep call in loop. Let it resolve instantly to trigger check
        return;
      }
      // Second sleep call. Throw an error to exit the infinite while(true) loop
      throw new Error('STOP_LOOP');
    };

    // Clear module cache to force fresh initialization with our test environment config
    delete require.cache[require.resolve('../lib/app')];
    const startApp = require('../lib/app');

    // Run the app (starts servers and triggers renewal loop in background)
    await startApp();

    // Give it a tiny moment to run the async loop turn
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assertions
    assert.strictEqual(sleepCallCount >= 1, true, 'Should have slept at least once');
    assert.strictEqual(setSecureContextCalled, true, 'Should have called setSecureContext');
    assert.deepStrictEqual(secureContextOptions, {
      key: validKey,
      cert: validCert,
    }, 'Should have updated context with the new cert info');
  });
});
