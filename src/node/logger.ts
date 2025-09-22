// Production logger with different log levels

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export class Logger {
  private logLevel: LogLevel = LogLevel.INFO
  private prefix: string

  constructor(prefix: string = 'DIG') {
    this.prefix = prefix
    
    // Set log level from environment
    const envLevel = process.env.DIG_LOG_LEVEL?.toUpperCase()
    switch (envLevel) {
      case 'ERROR':
        this.logLevel = LogLevel.ERROR
        break
      case 'WARN':
        this.logLevel = LogLevel.WARN
        break
      case 'INFO':
        this.logLevel = LogLevel.INFO
        break
      case 'DEBUG':
        this.logLevel = LogLevel.DEBUG
        break
    }
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString()
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') : ''
    
    return `[${timestamp}] ${level} [${this.prefix}] ${message}${formattedArgs}`
  }

  error(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message, ...args))
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message, ...args))
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message, ...args))
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', message, ...args))
    }
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level
  }

  getLevel(): LogLevel {
    return this.logLevel
  }
}
