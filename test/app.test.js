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
  const testStaticDir = '/tmp/lroxy-test-static';
  const testFilePath = path.join(testStaticDir, 'hello.txt');

  let validKey = '';
  let validCert = '';

  let activeServers = [];
  let setSecureContextCalled = false;
  let secureContextOptions = null;
  let assignedHttpsPort = 0;

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

    // Create test static folder and file
    if (!fs.existsSync(testStaticDir)) {
      fs.mkdirSync(testStaticDir, { recursive: true });
    }
    fs.writeFileSync(testFilePath, 'Hello from HTTPS!');

    // Mock rc module to return our specific test configuration
    require.cache[require.resolve('rc')] = {
      exports: function(name, defaults) {
        return {
          email: 'test@example.com',
          commonName: 'example.com',
          httpPort: 0, // Let OS assign a free port
          httpsPort: 0, // Let OS assign a free port
          rules: [{
            from: { path: '/static' },
            to: { path: testStaticDir }
          }],
          sslCachePath: '/tmp/lroxy-test-cache'
        };
      }
    };

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

      // Track the assigned port when server starts listening
      server.on('listening', () => {
        assignedHttpsPort = server.address().port;
      });

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
    // Clean up temporary cert files and folders
    try {
      fs.unlinkSync(tempKeyPath);
      fs.unlinkSync(tempCertPath);
      fs.rmSync(testStaticDir, { recursive: true, force: true });
    } catch (err) {}

    // Restore original methods and clear rc mock
    http.createServer = originalHttpCreateServer;
    https.createServer = originalHttpsCreateServer;
    CertProvider.prototype.getSslInfo = originalGetSslInfo;
    delete require.cache[require.resolve('rc')];
  });

  beforeEach(() => {
    setSecureContextCalled = false;
    secureContextOptions = null;
    assignedHttpsPort = 0;
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

    // Stub sleep on DurationImpl to resolve immediately on first call, then hang cleanly to pause loop
    DurationImpl.prototype.sleep = async function() {
      sleepCallCount++;
      if (sleepCallCount === 1) {
        // First sleep call in loop. Let it resolve instantly to trigger check
        return;
      }
      // Second sleep call. Return a promise that never resolves to freeze the loop cleanly
      return new Promise(() => {});
    };

    // Clear module cache to force fresh initialization with our rc mock
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

  it('should start HTTPS server and serve file correctly', async () => {
    // Stub sleep to hang cleanly on the first call so the loop doesn't check during this test
    DurationImpl.prototype.sleep = async function() {
      return new Promise(() => {});
    };

    // Clear module cache and reload app
    delete require.cache[require.resolve('../lib/app')];
    const startApp = require('../lib/app');

    await startApp();

    // Give it a tiny moment to run the async loop turn
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.ok(assignedHttpsPort > 0, 'HTTPS server should be bound to a port');

    // Make HTTPS request to the server and assert response
    const data = await new Promise((resolve, reject) => {
      const agent = new https.Agent({ rejectUnauthorized: false });
      https.get(`https://127.0.0.1:${assignedHttpsPort}/static/hello.txt`, { agent }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-type'], 'text/plain');

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    assert.strictEqual(data, 'Hello from HTTPS!');
  });
});
