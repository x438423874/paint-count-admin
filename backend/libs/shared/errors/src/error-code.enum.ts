export enum ErrorCode {
  INTERNAL_SERVER_ERROR = 500,
  UNPROCESSABLE_ENTITY = 422,
}

export const ErrorMessages = {
  [ErrorCode.INTERNAL_SERVER_ERROR]: '系统异常，请稍后重试',
  [ErrorCode.UNPROCESSABLE_ENTITY]: '参数校验失败',
};

export class BizException extends Error {
  code: ErrorCode;
  message: string;

  constructor(code: ErrorCode, message?: string) {
    super(message);
    this.code = code;
    this.message = message ?? ErrorMessages[code];
  }
}
