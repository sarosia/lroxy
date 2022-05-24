const acme = require('acme-client');
const logger = require('./logger');

class Acme {
  #email
  #commonName
  #names
  #challenges

  constructor(email, commonName, names) {
    this.#email = email;
    this.#commonName = commonName;
    this.#names = names;
    this.#challenges = {};
  }

  getChallenge(token) {
    return this.#challenges[token];
  }

  async run() {
    const client = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: await acme.forge.createPrivateKey(),
    });

    logger.info(`Creating CSR for commonName=${this.#commonName} and ` +
      `names=${this.#names.join(',')}.`);

    const [key, csr] = await acme.forge.createCsr({
      commonName: this.#commonName,
      altNames: this.#names,
    });

    const cert = await client.auto({
      csr,
      email: this.#email,
      termsOfServiceAgreed: true,
      challengeCreateFn: (authz, challenge, keyAuthorization) => {
        if (challenge.type != 'http-01') {
          throw new Error(`Unsupported challenge type: ${challenge.type}.`);
        }
        logger.info(`Creating challenge for token: ${challenge.token}.`);
        this.#challenges[challenge.token] = keyAuthorization;
      },
      challengeRemoveFn: (authz, challenge, keyAuthorization) => {
        if (challenge.type != 'http-01') {
          throw new Error(`Unsupported challenge type: ${challenge.type}.`);
        }
        logger.info(`Removing challenge for token: ${challenge.token}.`);
        delete this.#challenges[challenge.token];
      },
    });

    logger.info(`Certificate created.`);

    return {
      key: key,
      csr: csr,
      cert: cert,
    };
  }
}

module.exports = Acme;
