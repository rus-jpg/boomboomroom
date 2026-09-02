import Redis from "ioredis";
import { redisUrl } from "./env";

/**
 * BullMQ requires a real ioredis instance. `{ connection: { url } }` is ignored
 * by ioredis (RedisOptions has no `url` field) and hangs on localhost.
 * Workers need maxRetriesPerRequest: null for blocking commands.
 */
export function redisConnection(): Redis {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is required");
  return new Redis(url, { maxRetriesPerRequest: null });
}
