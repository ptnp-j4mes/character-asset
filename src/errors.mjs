export class CharacterAssetError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CharacterAssetError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details })
    };
  }
}
