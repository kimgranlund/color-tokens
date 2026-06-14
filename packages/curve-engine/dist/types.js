// Data contracts — SPEC §11. Every field typed; enums enumerated.
export class CurveRampError extends Error {
    code;
    field;
    constructor(code, message, field) {
        super(message);
        this.code = code;
        this.field = field;
        this.name = 'CurveRampError';
    }
}
