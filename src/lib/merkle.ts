/**
 * Merkle Tree and Bucketing for SETU offline-first sync.
 * Matches backend com.setu.merkle.Merkle.java exactly.
 */

import { sha256Hex } from './hash';

export interface MerkleLeaf {
  eventId: string;
  hash: string;
}

export interface MerkleSummary {
  root: string;
  buckets: Record<string, string>;
}

export async function bucketOf(eventId: string): Promise<string> {
  const hash = await sha256Hex(eventId);
  return hash.substring(0, 2);
}

export async function summarizeMerkle(leaves: MerkleLeaf[]): Promise<MerkleSummary> {
  // 1. Group leaves by bucket
  const groups: Map<string, string[]> = new Map();
  for (const leaf of leaves) {
    const b = await bucketOf(leaf.eventId);
    let list = groups.get(b);
    if (!list) {
      list = [];
      groups.set(b, list);
    }
    list.push(`${leaf.eventId}:${leaf.hash}`);
  }

  // 2. Sort bucket keys and compute bucket hashes
  const sortedBucketKeys = Array.from(groups.keys()).sort();
  const buckets: Record<string, string> = {};

  for (const b of sortedBucketKeys) {
    const lines = groups.get(b)!;
    lines.sort(); // Lexicographical sort on "eventId:hash"
    const bucketHash = await sha256Hex(lines.join('\n'));
    buckets[b] = bucketHash;
  }

  // 3. Compute root hash: sorted "bucket=hash" lines joined by "\n"
  const bucketLines: string[] = [];
  for (const b of sortedBucketKeys) {
    bucketLines.push(`${b}=${buckets[b]}`);
  }

  const root = bucketLines.length > 0 ? await sha256Hex(bucketLines.join('\n')) : await sha256Hex('');
  return { root, buckets };
}
