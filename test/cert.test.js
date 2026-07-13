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
});
