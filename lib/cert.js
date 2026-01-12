const Acme = require('./acme');
const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger.js');

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

  async getSslInfo() {
    if (this.#sslInfo != null) {
      return this.#sslInfo;
    }
    this.#sslInfo = await this.readCache();
    if (this.#sslInfo != null) {
      return this.#sslInfo;
    }
    logger.info('Obtaining SSL certs from ACME: ', this.#sslInfo);
    this.#sslInfo = await this.#acme.run();
    logger.info('Obtained SSL: ', this.#sslInfo);
    await this.writeCache(this.#sslInfo);
    return this.#sslInfo;
  }
}

module.exports = CertProvider;
