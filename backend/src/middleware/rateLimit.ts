import { NextFunction, Request, Response } from "express";

type Attempt = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, Attempt>();

/**
 * Small in-memory limiter suitable for the current single-server development
 * environment. Replace its store with Redis when the API is scaled to more
 * than one process.
 */
export function rateLimit(options: {
  namespace: string;
  maximum: number;
  windowMs: number;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const loginIdentifier = req.body?.username ?? req.body?.identifier ?? "";
    const key = `${options.namespace}:${req.ip}:${String(loginIdentifier).toLowerCase()}`;
    const current = attempts.get(key);
    const attempt =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + options.windowMs }
        : current;

    attempt.count += 1;
    attempts.set(key, attempt);

    res.setHeader("X-RateLimit-Limit", options.maximum);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, options.maximum - attempt.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(attempt.resetAt / 1000));

    if (attempt.count > options.maximum) {
      res.setHeader("Retry-After", Math.ceil((attempt.resetAt - now) / 1000));
      return res.status(429).json({
        error: "Too many attempts. Please wait before trying again.",
      });
    }

    // Prevent inactive keys accumulating during a long development session.
    if (attempts.size > 10_000) {
      for (const [storedKey, storedAttempt] of attempts) {
        if (storedAttempt.resetAt <= now) attempts.delete(storedKey);
      }
    }

    next();
  };
}
