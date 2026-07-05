#!/usr/bin/env python3
"""
Fibonacci Sequence Generator

Generates the Fibonacci sequence up to a specified number of terms.
Usage: python fibonacci.py [n]
"""

import sys


def fibonacci(n: int) -> list[int]:
    """Generate the first n terms of the Fibonacci sequence."""
    if n <= 0:
        return []
    if n == 1:
        return [0]

    seq = [0, 1]
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq


def main():
    try:
        n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
        if n < 0:
            raise ValueError("Number of terms must be non-negative.")
    except (ValueError, IndexError) as e:
        print(f"Error: {e}", file=sys.stderr)
        print(f"Usage: {sys.argv[0]} [n]", file=sys.stderr)
        sys.exit(1)

    seq = fibonacci(n)
    print(f"Fibonacci sequence (first {n} terms):")
    print(", ".join(map(str, seq)))


if __name__ == "__main__":
    main()
