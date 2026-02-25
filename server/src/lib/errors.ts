/**
 * Base application error. All custom errors extend this class so that
 * error-handling middleware can reliably check `instanceof AppError`.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    // Restore prototype chain (necessary when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', code = 'AUTH_ERROR') {
    super(message, 401, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Bad Request', code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}
