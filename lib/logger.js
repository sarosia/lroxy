const {Logger} = require('@sarosia/apper');
const rc = require('rc');

const config = rc('lroxy', {
  logDir: 'logs',
  logFilename: 'lroxy-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '7d',
});

const defaultLogger = new Logger('lroxy', config);

module.exports = defaultLogger;
module.exports.Logger = Logger;
