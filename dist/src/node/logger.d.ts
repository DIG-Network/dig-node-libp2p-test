export declare enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}
export declare class Logger {
    private logLevel;
    private prefix;
    constructor(prefix?: string);
    private formatMessage;
    error(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
    setLevel(level: LogLevel): void;
    getLevel(): LogLevel;
}
