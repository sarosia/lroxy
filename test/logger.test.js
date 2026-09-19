const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Logger - Local File Daily Rotation', () => {
  const testLogDir = path.join(__dirname, '../test-logs');

  beforeEach(() => {
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    delete require.cache[require.resolve('rc')];
    delete require.cache[require.resolve('../lib/logger')];
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should write logs to local file system in rotating daily log file', async () => {
    require.cache[require.resolve('rc')] = {
      exports: function(name, defaults) {
        return {
          logDir: testLogDir,
          useFile: true,
        };
      },
    };

    delete require.cache[require.resolve('../lib/logger')];
    const logger = require('../lib/logger');

    logger.info('Test info message', { metaKey: 'metaValue' });
    logger.error('Test error message', new Error('Something went wrong'));

    // Wait for the winston stream buffer to flush to disk
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.strictEqual(fs.existsSync(testLogDir), true, 'Log directory should be created');

    const files = fs.readdirSync(testLogDir);
    const logFile = files.find((f) => f.startsWith('lroxy-') && f.endsWith('.log'));
    assert.ok(logFile, `A daily rotated log file should exist in ${testLogDir}`);

    const content = fs.readFileSync(path.join(testLogDir, logFile), 'utf8');
    assert.ok(content.includes('Test info message'));
    assert.ok(content.includes('metaKey'));
    assert.ok(content.includes('metaValue'));
    assert.ok(content.includes('Test error message'));
  });

  it('should write info and error logs to the daily rotating file', async () => {
    require.cache[require.resolve('rc')] = {
      exports: function(name, defaults) {
        return {
          logDir: testLogDir,
          useFile: true,
        };
      },
    };

    delete require.cache[require.resolve('../lib/logger')];
    const logger = require('../lib/logger');

    logger.info('Regular info event');
    logger.error('Critical failure event');

    await new Promise((resolve) => setTimeout(resolve, 500));

    const files = fs.readdirSync(testLogDir);
    const logFile = files.find((f) => f.startsWith('lroxy-') && f.endsWith('.log'));
    assert.ok(logFile, 'Rotated log file should exist');

    const content = fs.readFileSync(path.join(testLogDir, logFile), 'utf8');
    assert.ok(content.includes('Regular info event'), 'Log should contain info messages');
    assert.ok(content.includes('Critical failure event'), 'Log should contain error message');
  });

  it('determines console vs file logging based on isTTY and options', () => {
    const {Logger} = require('../lib/logger');

    // TTY defaults to console logging
    const ttyLogger = new Logger('ttylogger', {isTTY: true});
    assert.strictEqual(ttyLogger.isTTY, true);
    assert.strictEqual(ttyLogger.useConsole, true);
    assert.strictEqual(ttyLogger.useFile, false);
    assert.ok(ttyLogger.transports.some((t) => t.name === 'console' || t.constructor.name === 'Console'));
    assert.strictEqual(
        ttyLogger.transports.some((t) => t.name === 'dailyRotateFile' || t.constructor.name === 'DailyRotateFile'),
        false,
    );
    ttyLogger.close();

    // Non-TTY defaults to file logging
    const nonTtyLogger = new Logger('nonttylogger', {isTTY: false});
    assert.strictEqual(nonTtyLogger.isTTY, false);
    assert.strictEqual(nonTtyLogger.useConsole, false);
    assert.strictEqual(nonTtyLogger.useFile, true);
    assert.ok(
        nonTtyLogger.transports.some((t) => t.name === 'dailyRotateFile' || t.constructor.name === 'DailyRotateFile'),
    );
    assert.strictEqual(
        nonTtyLogger.transports.some((t) => t.name === 'console' || t.constructor.name === 'Console'),
        false,
    );
    nonTtyLogger.close();

    // Explicit overrides
    const bothLogger = new Logger('bothlogger', {transport: 'both'});
    assert.strictEqual(bothLogger.useConsole, true);
    assert.strictEqual(bothLogger.useFile, true);
    bothLogger.close();

    const consoleOverride = new Logger('consoleoverride', {
      isTTY: false,
      useConsole: true,
      useFile: false,
    });
    assert.strictEqual(consoleOverride.useConsole, true);
    assert.strictEqual(consoleOverride.useFile, false);
    consoleOverride.close();
  });

  it('resolves home directory and paths correctly in resolveLogDir', () => {
    const {Logger} = require('../lib/logger');
    const os = require('os');
    const path = require('path');

    assert.strictEqual(Logger.resolveLogDir(null), null);
    assert.strictEqual(Logger.resolveLogDir(''), null);
    assert.strictEqual(Logger.resolveLogDir('~'), os.homedir());
    assert.strictEqual(
        Logger.resolveLogDir('~/test-logs'),
        path.join(os.homedir(), 'test-logs'),
    );
    assert.strictEqual(
        Logger.resolveLogDir('test-dir'),
        path.resolve('test-dir'),
    );
  });
});
