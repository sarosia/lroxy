const path = require('path');
const os = require('os');
const fs = require('fs');
const {createLogger, format, transports} = require('winston');
require('winston-daily-rotate-file');
const rc = require('rc');

class Logger {
  #logger;
  #logDir;
  #isTTY;
  #useConsole;
  #useFile;

  constructor(name = 'lroxy', options = {}) {
    if (typeof options === 'string') {
      options = {logDir: options};
    }
    const rawLogDir = options.logDir || options.dirname || options.logdir ||
      process.env.LOG_DIR;
    const isJson = Boolean(options.json || options.logJson);

    const isTTY = options.isTTY !== undefined ?
      Boolean(options.isTTY) :
      Boolean(process.stdout && process.stdout.isTTY);
    this.#isTTY = isTTY;

    const transport = options.transport || options.logTransport;
    const useConsole = options.useConsole !== undefined ?
      Boolean(options.useConsole) :
      (transport === 'console' || transport === 'both' ||
       (!transport && isTTY));
    const useFile = options.useFile !== undefined ?
      Boolean(options.useFile) :
      (transport === 'file' || transport === 'both' ||
       (!transport && !isTTY));

    this.#useConsole = useConsole;
    this.#useFile = useFile;

    const humanReadableFormat = format.printf(
        ({timestamp, level, message, service, stack, ...meta}) => {
          const extra = Object.keys(meta).length ?
            ' ' + JSON.stringify(meta) :
            '';
          let msg = message;
          if (stack) {
            msg = stack.includes(message) ? stack : `${message}\n${stack}`;
          }
          return `[${timestamp}] ${level}: ${msg}${extra}`;
        },
    );

    const activeTransports = [];

    if (useFile) {
      const rotateOpts = {
        filename: options.logFilename || `${name}-%DATE%.log`,
        datePattern: options.datePattern || options.logDatePattern || 'YYYY-MM-DD',
        zippedArchive: false,
        maxFiles: options.maxFiles || options.logMaxFiles || '7d',
        format: isJson ? format.json() : humanReadableFormat,
      };

      if (rawLogDir) {
        const resolvedDir = Logger.resolveLogDir(rawLogDir);
        if (!fs.existsSync(resolvedDir)) {
          fs.mkdirSync(resolvedDir, {recursive: true});
        }
        rotateOpts.dirname = resolvedDir;
        this.#logDir = resolvedDir;
      } else {
        this.#logDir = process.cwd();
      }

      activeTransports.push(new transports.DailyRotateFile(rotateOpts));

      if (options.logErrorFilename) {
        activeTransports.push(new transports.DailyRotateFile({
          ...rotateOpts,
          filename: options.logErrorFilename,
          level: 'error',
        }));
      }
    } else {
      if (rawLogDir) {
        this.#logDir = Logger.resolveLogDir(rawLogDir);
      } else {
        this.#logDir = process.cwd();
      }
    }

    if (useConsole) {
      activeTransports.push(new transports.Console({
        format: format.combine(
            format.colorize(),
            humanReadableFormat,
        ),
      }));
    }

    this.#logger = createLogger({
      level: options.level || options.logLevel || 'info',
      format: format.combine(
          format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
          }),
          format.errors({stack: true}),
          format.splat(),
      ),
      defaultMeta: {service: name},
      transports: activeTransports,
    });
  }

  static resolveLogDir(rawLogDir) {
    if (!rawLogDir) {
      return null;
    }
    let resolvedDir = rawLogDir;
    if (resolvedDir === '~') {
      resolvedDir = os.homedir();
    } else if (resolvedDir.startsWith('~/') ||
               resolvedDir.startsWith('~\\')) {
      resolvedDir = path.join(os.homedir(), resolvedDir.slice(2));
    }
    return path.resolve(resolvedDir);
  }

  get logDir() {
    return this.#logDir;
  }

  get isTTY() {
    return this.#isTTY;
  }

  get useConsole() {
    return this.#useConsole;
  }

  get useFile() {
    return this.#useFile;
  }

  get transports() {
    return this.#logger.transports;
  }

  close() {
    return this.#logger.close();
  }

  end(...args) {
    return this.#logger.end(...args);
  }

  on(...args) {
    return this.#logger.on(...args);
  }

  debug(...args) {
    return this.#logger.debug(...args);
  }
  info(...args) {
    return this.#logger.info(...args);
  }
  warn(...args) {
    return this.#logger.warn(...args);
  }
  error(...args) {
    return this.#logger.error(...args);
  }
}

const config = rc('lroxy', {
  logDir: 'logs',
  logFilename: 'lroxy-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '7d',
});

const defaultLogger = new Logger('lroxy', config);

module.exports = defaultLogger;
module.exports.Logger = Logger;



