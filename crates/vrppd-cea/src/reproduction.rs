//! Reproduction operator (WC13 §4.2.1) — elitism.
//!
//! "In both populations, the reproduction operator copies the best parents
//! to form the first offspring. The best individual is the one with minimal
//! objective value. … Reproducing to keep the best individual is also known
//! as the Elitism strategy, which guarantees that CEA never retreats from a
//! high quality solution."
//!
//! Lifted verbatim. The only adaptation is what "minimal objective" means
//! in our setting: the active single objective for the run (EMPTY,
//! DISTANCE, or PRICE).

use vrppd_core::Objective;

use crate::population::{Individual, Population};

/// Return a clone of the best individual under the active objective, or
/// `None` if the population is empty. Caller is expected to push this clone
/// into the offspring vector ahead of any operator-generated children to
/// realise elitism.
pub fn reproduce_elite(pop: &Population, target: Objective) -> Option<Individual> {
  pop.best(target).cloned()
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
  fn reproduce_elite_returns_minimum_energy_individual() {
    let pop = Population::new(vec![ind(20.0), ind(10.0), ind(15.0)]);
    let elite = reproduce_elite(&pop, Objective::Distance).unwrap();
    assert_eq!(elite.solution.total_distance, 10.0);
  }

  #[test]
  fn reproduce_elite_on_empty_returns_none() {
    let pop = Population::new(vec![]);
    assert!(reproduce_elite(&pop, Objective::Distance).is_none());
  }
}
