const {createLogger, format, transports} = require('winston');
const {LoggingWinston} = require('@google-cloud/logging-winston');

const logger = createLogger({
  'level': 'info',
  'format': format.combine(
      format.timestamp({
        'format': 'YYYY-MM-DD HH:mm:ss',
      }),
      format.errors({'stack': true}),
      format.splat(),
      format.json(),
  ),
  'transports': [
    new LoggingWinston(),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    'format': format.simple(),
  }));
}

module.exports = logger;
