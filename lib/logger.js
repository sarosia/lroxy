const {createLogger, format, transports} = require('winston');
require('winston-daily-rotate-file');

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
    new transports.DailyRotateFile({
      'filename': 'lroxy-%DATE%.log',
      'datePattern': 'YYYY-MM-DD',
      'zippedArchive': false,
      'maxFiles': '7d',
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    'format': format.simple(),
  }));
}

module.exports = logger;
