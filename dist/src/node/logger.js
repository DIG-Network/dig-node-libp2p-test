// Production logger with different log levels
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["ERROR"] = 0] = "ERROR";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
})(LogLevel || (LogLevel = {}));
export class Logger {
    constructor(prefix = 'DIG') {
        this.logLevel = LogLevel.INFO;
        this.prefix = prefix;
        // Set log level from environment
        const envLevel = process.env.DIG_LOG_LEVEL?.toUpperCase();
        switch (envLevel) {
            case 'ERROR':
                this.logLevel = LogLevel.ERROR;
                break;
            case 'WARN':
                this.logLevel = LogLevel.WARN;
                break;
            case 'INFO':
                this.logLevel = LogLevel.INFO;
                break;
            case 'DEBUG':
                this.logLevel = LogLevel.DEBUG;
                break;
        }
    }
    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.length > 0 ? ' ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ') : '';
        return `[${timestamp}] ${level} [${this.prefix}] ${message}${formattedArgs}`;
    }
    error(message, ...args) {
        if (this.logLevel >= LogLevel.ERROR) {
            console.error(this.formatMessage('ERROR', message, ...args));
        }
    }
    warn(message, ...args) {
        if (this.logLevel >= LogLevel.WARN) {
            console.warn(this.formatMessage('WARN', message, ...args));
        }
    }
    info(message, ...args) {
        if (this.logLevel >= LogLevel.INFO) {
            console.log(this.formatMessage('INFO', message, ...args));
        }
    }
    debug(message, ...args) {
        if (this.logLevel >= LogLevel.DEBUG) {
            console.log(this.formatMessage('DEBUG', message, ...args));
        }
    }
    setLevel(level) {
        this.logLevel = level;
    }
    getLevel() {
        return this.logLevel;
    }
}
//# sourceMappingURL=logger.js.map