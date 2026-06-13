import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/core/RingBuffer';

describe('RingBuffer', () => {
  it('starts empty', () => {
    const rb = new RingBuffer(10);
    expect(rb.count).toBe(0);
    expect(rb.writeHead).toBe(0);
  });

  it('reserves a contiguous segment without wrapping', () => {
    const rb = new RingBuffer(10);
    expect(rb.reserve(3)).toEqual([{ start: 0, length: 3 }]);
    expect(rb.count).toBe(3);
    expect(rb.writeHead).toBe(3);
  });

  it('splits into two segments when wrapping and caps count', () => {
    const rb = new RingBuffer(10);
    rb.reserve(3); // head = 3
    expect(rb.reserve(8)).toEqual([
      { start: 3, length: 7 },
      { start: 0, length: 1 },
    ]);
    expect(rb.writeHead).toBe(1);
    expect(rb.count).toBe(10);
  });

  it('fills the whole buffer when reserving >= capacity', () => {
    const rb = new RingBuffer(10);
    rb.reserve(4); // head = 4
    expect(rb.reserve(15)).toEqual([{ start: 0, length: 10 }]);
    expect(rb.writeHead).toBe(0);
    expect(rb.count).toBe(10);
  });

  it('reserve(0) is a no-op', () => {
    const rb = new RingBuffer(10);
    expect(rb.reserve(0)).toEqual([]);
    expect(rb.count).toBe(0);
  });

  it('clear resets head and count', () => {
    const rb = new RingBuffer(10);
    rb.reserve(5);
    rb.clear();
    expect(rb.count).toBe(0);
    expect(rb.writeHead).toBe(0);
  });

  it('throws on non-positive capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });

  it('reserve with negative n is a no-op', () => {
    const rb = new RingBuffer(10);
    expect(rb.reserve(-5)).toEqual([]);
    expect(rb.count).toBe(0);
  });

  it('reserve exactly capacity fills the buffer from 0', () => {
    const rb = new RingBuffer(10);
    rb.reserve(4); // head = 4
    expect(rb.reserve(10)).toEqual([{ start: 0, length: 10 }]);
    expect(rb.writeHead).toBe(0);
    expect(rb.count).toBe(10);
  });
});
