# CEA Parallel Offspring — Speedup & Quality Report

**threads (parallel):** 10  
**wall-clock cap per run:** 30000 ms  
**reps per cell:** 5  

## Problem: `problems/10_20/0_1778169862263.json`

| Objective | Seq mean gen/s | Par mean gen/s | Throughput speedup | Seq mean value | Par mean value | Quality RPD |
|-----------|---------------|----------------|-------------------|---------------|----------------|-------------|
| DISTANCE | 14.3 | 60.4 | 4.23× | 5825.2997 | 5778.9170 | -0.80% |
| PRICE | 8.9 | 43.4 | 4.85× | 6420.3819 | 6422.2948 | +0.03% |
| EMPTY | 14.1 | 65.0 | 4.62× | 146.5394 | 169.8061 | +15.88% |

## Problem: `problems/10_20/18_1778169862263.json`

| Objective | Seq mean gen/s | Par mean gen/s | Throughput speedup | Seq mean value | Par mean value | Quality RPD |
|-----------|---------------|----------------|-------------------|---------------|----------------|-------------|
| DISTANCE | 17.9 | 94.1 | 5.25× | 6495.6147 | 6495.6164 | +0.00% |
| PRICE | 14.7 | 71.7 | 4.89× | 7641.6643 | 7637.3738 | -0.06% |
| EMPTY | 13.2 | 68.6 | 5.18× | 127.3235 | 127.3235 | +0.00% |

## Problem: `problems/10_20/8_1778169862263.json`

| Objective | Seq mean gen/s | Par mean gen/s | Throughput speedup | Seq mean value | Par mean value | Quality RPD |
|-----------|---------------|----------------|-------------------|---------------|----------------|-------------|
| DISTANCE | 16.5 | 83.6 | 5.07× | 3710.4868 | 3710.4868 | +0.00% |
| PRICE | 7.9 | 39.0 | 4.95× | 5457.4871 | 5435.9325 | -0.39% |
| EMPTY | 14.0 | 68.9 | 4.93× | 40.5284 | 40.5284 | +0.00% |

## Summary

- **Mean throughput speedup:** 4.89× (parallel generations/s ÷ sequential generations/s)
- **Mean quality RPD:** +1.63% (positive = parallel finds worse value within same wall-time cap)

> RPD = (parallel_value − sequential_value) / sequential_value × 100.  
> Both versions run until `conv_count` stagnant generations **or** the wall-time cap — whichever fires first.  
> A faster generation loop (parallel) can complete more generations within the cap, potentially finding a better optimum.
