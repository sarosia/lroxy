const Acme = require('./acme');
const fs = require('fs/promises');
const path = require('path');
const net = require('net');
const logger = require('./logger.js');
const { X509Certificate } = require('crypto');

class CertProvider {
  #config
  #rules
  #acme
  #cachePath
  #sslInfo

  constructor(config, rules) {
    this.#config = config;
    this.#rules = rules;
    this.#cachePath = path.join(config.sslCachePath);
    this.#initAcme();
  }

  #initAcme() {
    const names = {};
    for (const rule of this.#rules) {
      if (rule.getFromHost()) {
        names[rule.getFromHost()] = true;
      }
    }
    delete names[this.#config.commonName];
    this.#acme = new Acme(this.#config.email, this.#config.commonName, Object.keys(names));
  }

  getRequiredHostnames() {
    const names = new Set();
    if (this.#config.commonName) {
      names.add(this.#config.commonName);
    }
    for (const rule of this.#rules) {
      if (rule.getFromHost()) {
        names.add(rule.getFromHost());
      }
    }
    return Array.from(names);
  }

  hasAllHostnames(certPem) {
    if (!certPem) {
      return false;
    }
    const required = this.getRequiredHostnames();
    if (required.length === 0) {
      return true;
    }
    try {
      const x509 = new X509Certificate(certPem);
      for (const host of required) {
        const cleanHost = host.split(':')[0].trim();
        let matched = Boolean(x509.checkHost(cleanHost));
        if (!matched && net.isIP(cleanHost) && typeof x509.checkIP === 'function') {
          matched = Boolean(x509.checkIP(cleanHost));
        }
        if (!matched) {
          logger.info(`Certificate is missing required hostname: ${host}`);
          return false;
        }
      }
      return true;
    } catch (err) {
      logger.error('Failed to parse certificate during hostname validation:', err);
      return false;
    }
  }

  isCertValid(certPem) {
    return !this.isCertNearExpiry(certPem) && this.hasAllHostnames(certPem);
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
    if (!forceCheck && this.#sslInfo != null && this.isCertValid(this.#sslInfo.cert)) {
      return this.#sslInfo;
    }
    const cachedInfo = await this.readCache();
    if (cachedInfo != null && this.isCertValid(cachedInfo.cert)) {
      this.#sslInfo = cachedInfo;
      return this.#sslInfo;
    }
    logger.info('Obtaining SSL certs from ACME...');
    this.#initAcme();
    this.#sslInfo = await this.#acme.run();
    logger.info('Obtained SSL: ', this.#sslInfo);
    await this.writeCache(this.#sslInfo);
    return this.#sslInfo;
  }
}

module.exports = CertProvider;
