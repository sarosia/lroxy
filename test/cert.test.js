const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CertProvider = require('../lib/cert');

describe('CertProvider - Certificate Renewal Logic', () => {
  const cachePath = path.join(__dirname, '../test-ssl-cache');
  const certValidPath = path.join(cachePath, 'cert_valid.pem');
  const certExpiredPath = path.join(cachePath, 'cert_expired.pem');
  let provider;

  before(() => {
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${path.join(cachePath, 'key_valid.pem')} ` +
      `-out ${certValidPath} -days 365 -nodes -subj "/CN=example.com"`,
      { stdio: 'ignore' }
    );

    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${path.join(cachePath, 'key_expired.pem')} ` +
      `-out ${certExpiredPath} -days 1 -nodes -subj "/CN=example.com"`,
      { stdio: 'ignore' }
    );

    provider = new CertProvider({
      sslCachePath: cachePath,
      email: 'test@example.com',
      commonName: 'example.com'
    }, []);
  });

  after(() => {
    fs.rmSync(cachePath, { recursive: true, force: true });
  });

  it('should flag a certificate expiring in less than 30 days as near expiry', () => {
    const certPem = fs.readFileSync(certExpiredPath, 'utf8');
    assert.strictEqual(provider.isCertNearExpiry(certPem), true);
  });

  it('should not flag a certificate expiring in 365 days as near expiry', () => {
    const certPem = fs.readFileSync(certValidPath, 'utf8');
    assert.strictEqual(provider.isCertNearExpiry(certPem), false);
  });

  it('should flag empty or invalid certificates as near expiry', () => {
    assert.strictEqual(provider.isCertNearExpiry(''), true);
    assert.strictEqual(provider.isCertNearExpiry('INVALID_PEM_CONTENT'), true);
  });

  it('should verify certificate has all required hostnames', () => {
    const certPem = fs.readFileSync(certValidPath, 'utf8');
    assert.strictEqual(provider.hasAllHostnames(certPem), true);

    const providerWithNewHost = new CertProvider({
      sslCachePath: cachePath,
      email: 'test@example.com',
      commonName: 'example.com',
    }, [{
      getFromHost: () => 'sub.example.com',
    }]);

    assert.strictEqual(providerWithNewHost.hasAllHostnames(certPem), false);
    assert.strictEqual(providerWithNewHost.isCertValid(certPem), false);
  });

  it('should trigger ACME run when cached cert lacks new hostnames', async () => {
    let acmeRunCalled = false;
    const providerWithNewHost = new CertProvider({
      sslCachePath: cachePath,
      email: 'test@example.com',
      commonName: 'example.com',
    }, [{
      getFromHost: () => 'new.example.com',
    }]);

    await providerWithNewHost.writeCache({
      key: Buffer.from('dummyKey'),
      cert: fs.readFileSync(certValidPath, 'utf8'),
    });

    const Acme = require('../lib/acme');
    const originalRun = Acme.prototype.run;
    Acme.prototype.run = async function() {
      acmeRunCalled = true;
      return {
        key: Buffer.from('newKey'),
        cert: 'DUMMY_NEW_CERT',
      };
    };

    try {
      const sslInfo = await providerWithNewHost.getSslInfo();
      assert.strictEqual(acmeRunCalled, true);
      assert.strictEqual(sslInfo.cert, 'DUMMY_NEW_CERT');
    } finally {
      Acme.prototype.run = originalRun;
    }
  });

  it('should store and retrieve certificate cache using Apper NotableStore', async () => {
    const storeProvider = new CertProvider({
      sslCachePath: cachePath,
      email: 'test@example.com',
      commonName: 'example.com',
    }, []);

    const store = storeProvider.getStore();
    assert.ok(store, 'CertProvider should expose a NotableStore instance');

    const testCert = {
      key: Buffer.from('notableKeySecret'),
      cert: fs.readFileSync(certValidPath, 'utf8'),
      csr: 'DUMMY_CSR',
    };

    await storeProvider.writeCache(testCert);

    // Verify it was stored in NotableStore
    const itemInStore = await store.get('cert');
    assert.ok(itemInStore, 'Item should exist in NotableStore');
    assert.strictEqual(itemInStore.cert, testCert.cert);

    // Verify readCache retrieves and reconstructs key buffer
    const cached = await storeProvider.readCache();
    assert.ok(cached, 'Cached certificate should be retrieved');
    assert.ok(Buffer.isBuffer(cached.key), 'Cached key should be a Buffer');
    assert.strictEqual(cached.key.toString('utf8'), 'notableKeySecret');
    assert.strictEqual(cached.cert, testCert.cert);
  });
});


