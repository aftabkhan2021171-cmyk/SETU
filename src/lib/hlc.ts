/**
 * Hybrid Logical Clock (HLC)
 * Matches backend com.setu.clock.Hlc exactly:
 * Format: "<wall:15>:<counter:5>:<node>"
 * E.g., "001761800000000:00003:chw-01"
 */

export class Hlc {
  public static readonly MAX_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    public readonly wall: number,
    public readonly counter: number,
    public readonly node: string
  ) {}

  public static parse(s: string): Hlc {
    if (!s) throw new Error('Invalid HLC: empty string');
    const parts = s.split(':');
    if (parts.length < 3) throw new Error(`Invalid HLC format: ${s}`);
    const wallStr = parts[0];
    const counterStr = parts[1];
    const node = parts.slice(2).join(':'); // node may contain colons if permitted, but usually doesn't

    const wall = parseInt(wallStr, 10);
    const counter = parseInt(counterStr, 10);
    if (isNaN(wall) || isNaN(counter)) {
      throw new Error(`Invalid HLC numeric values: ${s}`);
    }
    return new Hlc(wall, counter, node);
  }

  public encode(): string {
    const w = String(this.wall).padStart(15, '0');
    const c = String(this.counter).padStart(5, '0');
    return `${w}:${c}:${this.node}`;
  }

  public toString(): string {
    return this.encode();
  }

  public compareTo(other: Hlc): number {
    if (this.wall !== other.wall) {
      return this.wall < other.wall ? -1 : 1;
    }
    if (this.counter !== other.counter) {
      return this.counter < other.counter ? -1 : 1;
    }
    return this.node.localeCompare(other.node);
  }

  public tick(physicalNow: number): Hlc {
    const w = Math.max(this.wall, physicalNow);
    const c = w === this.wall ? this.counter + 1 : 0;
    return new Hlc(w, c, this.node);
  }

  public receive(remote: Hlc, physicalNow: number): Hlc {
    if (remote.wall - physicalNow > Hlc.MAX_DRIFT_MS) {
      throw new Error('Remote HLC too far ahead of local clock');
    }
    const w = Math.max(this.wall, Math.max(remote.wall, physicalNow));
    let c = 0;
    if (w === this.wall && w === remote.wall) {
      c = Math.max(this.counter, remote.counter) + 1;
    } else if (w === this.wall) {
      c = this.counter + 1;
    } else if (w === remote.wall) {
      c = remote.counter + 1;
    } else {
      c = 0;
    }
    return new Hlc(w, c, this.node);
  }
}
