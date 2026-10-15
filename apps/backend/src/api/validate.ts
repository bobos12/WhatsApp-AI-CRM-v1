import type { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Request body validation middleware factory.
 *
 * Parses and replaces `req.body` with the schema's typed/coerced output, so
 * downstream handlers receive only known, well-formed fields. On failure it
 * responds 400 with a flattened list of field errors instead of letting
 * malformed input reach the database layer.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}
