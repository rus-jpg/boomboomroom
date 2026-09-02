import { ogAlt, ogContentType, ogSize, shareCard } from "@/lib/og/share-card";

export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

export default function Image() {
  return shareCard();
}
