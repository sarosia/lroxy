const Acme = require('./acme');
const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger.js');
const { X509Certificate } = require('crypto');

class CertProvider {
  #acme
  #cachePath
  #sslInfo

  constructor(config, rules) {
    const names = {};
    for (const rule of rules) {
      if (rule.getFromHost()) {
        names[rule.getFromHost()] = true;
      }
    }
    delete names[config.commonName];
    this.#cachePath = path.join(config.sslCachePath);
    this.#acme = new Acme(config.email, config.commonName, Object.keys(names));
  }

  getChallenge(token) {
    return this.#acme.getChallenge(token);
  }

  async readCache() {
    try {
      const data = await fs.readFile(path.join(this.#cachePath, "cache.json"), 'utf8');
      const json = JSON.parse(data);
      json.key = Buffer.from(json.key.data);
      return json;
    } catch (err) {
      return null;
    }
  }

  async writeCache() {
    try {
      await fs.mkdir(this.#cachePath, { recursive: true });
      const jsonString = JSON.stringify(this.#sslInfo, null, 2);
      await fs.writeFile(path.join(this.#cachePath, "cache.json"), jsonString);
    } catch (err) {
      logger.error('Error writing file:', err);
    }
  }

  isCertNearExpiry(certPem) {
    if (!certPem) {
      return true;
    }
    try {
      const x509 = new X509Certificate(certPem);
      const validTo = new Date(x509.validTo);
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() + 30); // 30-day proactive window
      return checkDate >= validTo;
    } catch (err) {
      logger.error('Failed to parse certificate during validation:', err);
      return true; // Treat unparseable certs as expired
    }
  }

  async getSslInfo(forceCheck = false) {
    if (!forceCheck && this.#sslInfo != null && !this.isCertNearExpiry(this.#sslInfo.cert)) {
      return this.#sslInfo;
    }
    const cachedInfo = await this.readCache();
    if (cachedInfo != null && !this.isCertNearExpiry(cachedInfo.cert)) {
      this.#sslInfo = cachedInfo;
      return this.#sslInfo;
    }
    logger.info('Obtaining SSL certs from ACME...');
    this.#sslInfo = await this.#acme.run();
    logger.info('Obtained SSL: ', this.#sslInfo);
    await this.writeCache(this.#sslInfo);
    return this.#sslInfo;
  }
}

module.exports = CertProvider;
