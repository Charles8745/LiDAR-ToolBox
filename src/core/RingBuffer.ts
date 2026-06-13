export interface WriteSegment {
  start: number;
  length: number;
}

/** FIFO write head over a fixed-capacity buffer. Oldest entries are overwritten when full. */
export class RingBuffer {
  readonly capacity: number;
  private head = 0;
  private _count = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be > 0');
    this.capacity = capacity;
  }

  get count(): number {
    return this._count;
  }

  get writeHead(): number {
    return this.head;
  }

  /** Reserve slots for `n` new entries. Returns 1–2 contiguous segments (wraps around). */
  reserve(n: number): WriteSegment[] {
    if (n <= 0) return [];
    if (n >= this.capacity) {
      this.head = 0;
      this._count = this.capacity;
      return [{ start: 0, length: this.capacity }];
    }
    const segments: WriteSegment[] = [];
    const first = Math.min(n, this.capacity - this.head);
    segments.push({ start: this.head, length: first });
    if (first < n) {
      segments.push({ start: 0, length: n - first });
    }
    this.head = (this.head + n) % this.capacity;
    this._count = Math.min(this.capacity, this._count + n);
    return segments;
  }

  clear(): void {
    this.head = 0;
    this._count = 0;
  }
}
