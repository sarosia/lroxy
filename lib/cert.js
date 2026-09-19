const Acme = require('./acme');
const path = require('path');
const net = require('net');
const logger = require('./logger.js');
const { X509Certificate } = require('crypto');
const { NotableStore } = require('@sarosia/apper');

class CertProvider {
  #config;
  #rules;
  #acme;
  #cachePath;
  #sslInfo;
  #store;

  constructor(config, rules) {
    this.#config = config;
    this.#rules = rules;
    this.#cachePath = config.sslCachePath ? path.resolve(config.sslCachePath) : null;
    const storeOptions = {
      appName: 'lroxy',
      idField: 'id',
    };
    if (this.#cachePath) {
      storeOptions.storagePath = this.#cachePath.endsWith('.json')
        ? this.#cachePath
        : path.join(this.#cachePath, 'notabledb.json');
    }
    this.#store = new NotableStore('certs', storeOptions);
    this.#initAcme();
  }

  getStore() {
    return this.#store;
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
      const item = await this.#store.get('cert');
      if (item && item.key && item.cert) {
        let key = item.key;
        if (typeof key === 'object' && Array.isArray(key.data)) {
          key = Buffer.from(key.data);
        } else if (typeof key === 'string') {
          key = Buffer.from(key);
        }
        return {
          key,
          cert: item.cert,
          csr: item.csr,
        };
      }
    } catch (err) {
      logger.error('Error reading cert cache from store:', err);
    }
    return null;
  }

  async writeCache(sslInfo) {
    const info = sslInfo || this.#sslInfo;
    if (!info) return;

    try {
      const dataToSave = {
        id: 'cert',
        key: info.key,
        cert: info.cert,
        csr: info.csr,
      };
      const existing = await this.#store.get('cert');
      if (existing) {
        await this.#store.update('cert', dataToSave);
      } else {
        await this.#store.add(dataToSave);
      }
    } catch (err) {
      logger.error('Error writing cert cache to store:', err);
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
