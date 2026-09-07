const {createLogger, format, transports} = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const rc = require('rc');

const config = rc('lroxy', {
  logDir: 'logs',
  logFilename: 'lroxy-%DATE%.log',
  logDatePattern: 'YYYY-MM-DD',
  logMaxSize: '20m',
  logMaxFiles: '14d',
  logLevel: 'info',
});

const logDir = config.logDir || 'logs';
const logFilename = config.logFilename || 'lroxy-%DATE%.log';
const logDatePattern = config.logDatePattern || 'YYYY-MM-DD';
const logMaxSize = config.logMaxSize || '20m';
const logMaxFiles = config.logMaxFiles || '14d';
const logLevel = config.logLevel || 'info';

const rotateTransport = new DailyRotateFile({
  dirname: logDir,
  filename: logFilename,
  datePattern: logDatePattern,
  maxSize: logMaxSize,
  maxFiles: logMaxFiles,
  level: logLevel,
});

const loggerTransports = [
  new transports.Console({
    'format': format.simple(),
  }),
  rotateTransport,
];

if (config.logErrorFilename) {
  loggerTransports.push(new DailyRotateFile({
    dirname: logDir,
    filename: config.logErrorFilename,
    datePattern: logDatePattern,
    maxSize: logMaxSize,
    maxFiles: logMaxFiles,
    level: 'error',
  }));
}

const logger = createLogger({
  'level': logLevel,
  'format': format.combine(
      format.timestamp({
        'format': 'YYYY-MM-DD HH:mm:ss',
      }),
      format.errors({'stack': true}),
      format.splat(),
      format.json(),
  ),
  'transports': loggerTransports,
});

module.exports = logger;


