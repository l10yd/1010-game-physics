// Rebuilt for each overstack sweep; never kept across physics steps or board mutations.
// Buckets and entries are recycled to avoid allocating point objects on every sweep.
type Point<T> = { x: number; y: number; value: T };
export class PointIndex<T> {
  private buckets = new Map<string, Point<T>[]>();
  private bucketPool: Point<T>[][] = [];
  private points: Point<T>[] = [];
  private used = 0;
  private size: number;

  constructor(size: number) { this.size = size; }

  clear() {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
      this.bucketPool.push(bucket);
    }
    this.buckets.clear();
    this.used = 0;
  }

  add(x: number, y: number, value: T) {
    const key = `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = this.bucketPool.pop() ?? [];
      this.buckets.set(key, bucket);
    }
    let point = this.points[this.used];
    if (!point) this.points[this.used] = point = { x, y, value };
    else { point.x = x; point.y = y; point.value = value; }
    this.used++;
    bucket.push(point);
  }

  count(x: number, y: number, radius: number, exclude: T, limit = Infinity) {
    let count = 0;
    const minX = Math.floor((x - radius) / this.size), maxX = Math.floor((x + radius) / this.size);
    const minY = Math.floor((y - radius) / this.size), maxY = Math.floor((y + radius) / this.size);
    for (let row = minY; row <= maxY; row++) for (let col = minX; col <= maxX; col++) {
      const bucket = this.buckets.get(`${col},${row}`);
      if (!bucket) continue;
      for (const point of bucket) {
        if (point.value !== exclude && Math.abs(point.x - x) < radius && Math.abs(point.y - y) < radius) {
          if (++count >= limit) return count;
        }
      }
    }
    return count;
  }
}
