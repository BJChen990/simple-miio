export interface Logger {
  debug(message: string, ...optionals: any[]): void;
  log(message: string, ...optionals: any[]): void;
  warn(message: string, ...optionals: any[]): void;
  error(message: string, ...optionals: any[]): void;
}

export const enum LogLevel {
  DEBUG = 0,
  LOG = 1,
  WARN = 2,
  ERROR = 3,
}

export class ConsoleLogger implements Logger {
  constructor(
    private readonly logLevel = LogLevel.LOG,
    private readonly client = console
  ) {}

  debug(message: string, ...optionals: any[]): void {
    if (this.logLevel > LogLevel.DEBUG) {
      return;
    }
    this.client.debug(message, ...optionals);
  }

  log(message: string, ...optionals: any[]): void {
    if (this.logLevel > LogLevel.LOG) {
      return;
    }
    this.client.log(message, ...optionals);
  }

  warn(message: string, ...optionals: any[]): void {
    if (this.logLevel > LogLevel.WARN) {
      return;
    }
    this.client.warn(message, ...optionals);
  }

  error(message: string, ...optionals: any[]): void {
    if (this.logLevel > LogLevel.ERROR) {
      return;
    }
    this.client.error(message, ...optionals);
  }
}
