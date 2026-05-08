//! Rank-based fitness function and roulette-wheel sampling (WC13 §4.2.5).
//!
//! Per the paper, after generating `2N` offspring the fitness of an
//! individual is `4N + 1 − rank_by_TD`, so the minimum-objective individual
//! gets fitness `4N` and the maximum-objective individual gets fitness
//! `2N + 1`. Selection samples `N − 1` non-elite survivors with probability
//! proportional to that fitness; the elite (best objective) is preserved
//! unconditionally by the Reproduction operator.
//!
//! Adaptation: WC13 ranks by TD (the paper's secondary objective). We rank
//! by the *active* run's objective — EMPTY, DISTANCE, or PRICE — see the
//! adaptation notes for rationale.

use rand::Rng;

use vrppd_core::Objective;

use crate::population::Individual;

/// Fitness assignments aligned with a `Vec<Individual>`. Higher is better.
pub type Fitness = Vec<f64>;

/// Compute the rank-based fitness vector for the given individuals.
///
/// Sort positions are deterministic for ties (stable insertion order),
/// matching the reproducibility property the rest of the crate relies on
/// when running with a fixed seed.
pub fn fitness_values(individuals: &[Individual], target: Objective) -> Fitness {
  let n = individuals.len();
  let total_n = n;
  let mut indexed: Vec<(usize, f64)> = individuals
    .iter()
    .enumerate()
    .map(|(i, ind)| (i, energy(ind, target)))
    .collect();

  // Stable sort by ascending energy (best first).
  indexed.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

  // The paper's fitness scale: rank 1 (best) gets `4N`, rank `2N` (worst)
  // gets `2N + 1`. Linear interpolation gives `4N + 1 − rank`. We use the
  // population size that produced the offspring count (caller supplies it
  // implicitly via `individuals.len()` — for the post-offspring vector
  // `len = 2N`, so `4N + 1 = 2 · len + 1`).
  let high = 2 * total_n + 1;

  let mut out = vec![0.0; n];
  for (rank0, (orig_idx, _)) in indexed.iter().enumerate() {
    let rank1 = rank0 + 1;
    let f = (high as i64 - rank1 as i64) as f64;
    out[*orig_idx] = f.max(1.0);
  }
  out
}

/// Pick `count` distinct indices from the fitness vector via roulette-
/// wheel sampling without replacement. Probability of picking index `i` on
/// each draw is `fitness[i] / Σ fitness_remaining`.
pub fn roulette_select<R: Rng + ?Sized>(
  fitness: &Fitness,
  count: usize,
  rng: &mut R,
) -> Vec<usize> {
  assert!(
    count <= fitness.len(),
    "cannot draw more than population size"
  );

  let mut available: Vec<(usize, f64)> = fitness.iter().enumerate().map(|(i, &f)| (i, f)).collect();

  let mut picked = Vec::with_capacity(count);
  for _ in 0..count {
    let total: f64 = available.iter().map(|(_, f)| *f).sum();
    if total <= 0.0 {
      // Degenerate: every remaining individual has zero fitness; fall back
      // to uniform.
      let idx = rng.gen_range(0..available.len());
      picked.push(available.remove(idx).0);
      continue;
    }
    let r: f64 = rng.r#gen::<f64>() * total;
    let mut acc = 0.0;
    let mut chosen_pos = available.len() - 1;
    for (pos, (_, f)) in available.iter().enumerate() {
      acc += *f;
      if r <= acc {
        chosen_pos = pos;
        break;
      }
    }
    picked.push(available.remove(chosen_pos).0);
  }
  picked
}

#[inline]
fn energy(ind: &Individual, target: Objective) -> f64 {
  match target {
    Objective::Empty => ind.solution.empty_distance,
    Objective::Distance => ind.solution.total_distance,
    Objective::Price => ind.solution.total_price,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use rand::SeedableRng;
  use rand_xoshiro::Xoshiro256StarStar;
  use vrppd_core::WorkingSolution;

  fn ind_with_distance(d: f64) -> Individual {
    let mut sol = WorkingSolution::empty(0);
    sol.total_distance = d;
    sol.empty_distance = d;
    sol.total_price = d;
    Individual { solution: sol }
  }

  #[test]
  fn fitness_ranks_min_energy_highest() {
    let inds = vec![
      ind_with_distance(10.0),
      ind_with_distance(20.0),
      ind_with_distance(15.0),
    ];
    let f = fitness_values(&inds, Objective::Distance);
    // 2N + 1 with N=3 (len=3 here, treated as 2N): high = 7.
    // Ranks: idx 0 → rank 1 (lowest dist) → fitness 7 - 1 = 6
    //        idx 2 → rank 2 → fitness 7 - 2 = 5
    //        idx 1 → rank 3 → fitness 7 - 3 = 4
    assert_eq!(f, vec![6.0, 4.0, 5.0]);
  }

  #[test]
  fn roulette_picks_each_index_at_most_once() {
    let f = vec![5.0, 4.0, 3.0, 2.0];
    let mut rng = Xoshiro256StarStar::seed_from_u64(42);
    let picked = roulette_select(&f, 4, &mut rng);
    let mut sorted = picked.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, vec![0, 1, 2, 3], "picked = {picked:?}");
  }

  #[test]
  fn roulette_favours_higher_fitness() {
    // Index 0 has overwhelmingly higher fitness; in 1000 draws of size 1,
    // it should be picked first ~95%+ of the time.
    let f = vec![100.0, 1.0, 1.0, 1.0];
    let mut rng = Xoshiro256StarStar::seed_from_u64(7);
    let mut hits = 0;
    for _ in 0..1000 {
      let p = roulette_select(&f, 1, &mut rng);
      if p[0] == 0 {
        hits += 1;
      }
    }
    assert!(
      hits > 900,
      "expected high-fitness index dominant; got {hits}/1000"
    );
  }
}
