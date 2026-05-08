//! Population container shared by Pop I (diversification) and Pop II
//! (intensification). Each individual is a complete `WorkingSolution`.
//!
//! No CEA-specific bookkeeping yet — this commit only introduces the
//! container and its construction. The Recombination / Crossover operators
//! that mutate it land in follow-up commits.

use vrppd_core::{Objective, WorkingSolution};

#[derive(Clone, Debug)]
pub struct Individual {
  pub solution: WorkingSolution,
}

impl Individual {
  pub fn new(solution: WorkingSolution) -> Self {
    Self { solution }
  }
}

#[derive(Clone, Debug)]
pub struct Population {
  pub individuals: Vec<Individual>,
}

impl Population {
  pub fn new(individuals: Vec<Individual>) -> Self {
    Self { individuals }
  }

  pub fn len(&self) -> usize {
    self.individuals.len()
  }

  pub fn is_empty(&self) -> bool {
    self.individuals.is_empty()
  }

  /// Return the index of the individual with the minimum energy under the
  /// active objective. Ties broken by insertion order (lower index wins),
  /// which keeps the elitism step deterministic for fixed seeds.
  pub fn best_index(&self, target: Objective) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (i, ind) in self.individuals.iter().enumerate() {
      let e = energy(&ind.solution, target);
      best = match best {
        None => Some((i, e)),
        Some((_, be)) if e < be => Some((i, e)),
        Some(prev) => Some(prev),
      };
    }
    best.map(|(i, _)| i)
  }

  pub fn best(&self, target: Objective) -> Option<&Individual> {
    self.best_index(target).map(|i| &self.individuals[i])
  }
}

#[inline]
fn energy(sol: &WorkingSolution, target: Objective) -> f64 {
  match target {
    Objective::Empty => sol.empty_distance,
    Objective::Distance => sol.total_distance,
    Objective::Price => sol.total_price,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use vrppd_core::WorkingSolution;

  fn ind(d: f64) -> Individual {
    let mut sol = WorkingSolution::empty(0);
    sol.total_distance = d;
    sol.empty_distance = d;
    sol.total_price = d;
    Individual { solution: sol }
  }

  #[test]
  fn best_picks_minimum_energy() {
    let pop = Population::new(vec![ind(20.0), ind(10.0), ind(15.0)]);
    assert_eq!(pop.best_index(Objective::Distance), Some(1));
  }

  #[test]
  fn best_breaks_ties_by_insertion_order() {
    let pop = Population::new(vec![ind(10.0), ind(10.0), ind(10.0)]);
    assert_eq!(pop.best_index(Objective::Distance), Some(0));
  }

  #[test]
  fn best_on_empty_returns_none() {
    let pop = Population::new(vec![]);
    assert_eq!(pop.best_index(Objective::Distance), None);
  }
}
