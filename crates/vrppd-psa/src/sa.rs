//! Single-threaded simulated-annealing driver.
//!
//! Plain Metropolis acceptance with geometric cooling. The multi-thread
//! pipeline (worker N relays its `SYNC_REPORT` as worker N+1's
//! `INFLUENCE_UPDATE`) lands in a follow-up commit per PLAN.md §1.1.

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng, SeedableRng};
use rand_xoshiro::Xoshiro256StarStar;
use std::time::Instant;

use vrppd_core::{Objective, Problem, ProblemSolution};

use crate::config::SaConfig;
use crate::matrix::{OrderMatrix, VehicleStartMatrix};
use crate::operators::generate_neighbor;
use crate::rcrs::generate_rcrs;

/// One sample on the convergence trace.
#[derive(Clone, Debug)]
pub struct ConvergencePoint {
  pub time_ms: f64,
  pub iteration: u64,
  pub solution: ProblemSolution,
}

#[derive(Clone, Debug)]
pub struct Solved {
  pub solution: ProblemSolution,
  pub history: Vec<ConvergencePoint>,
}

/// Run a complete single-threaded SA: build matrices, RCRS, anneal, return.
pub fn solve(problem: &Problem, target: Objective, config: SaConfig) -> Solved {
  let mut rng = thread_rng();
  let seed: u64 = rng.r#gen();
  solve_seeded(problem, target, config, seed)
}

/// Seeded variant for reproducible runs (used by tests and the future
/// distributional-parity harness).
pub fn solve_seeded(problem: &Problem, target: Objective, config: SaConfig, seed: u64) -> Solved {
  let mut rng = Xoshiro256StarStar::seed_from_u64(seed);

  let order_mat = OrderMatrix::build(&problem.orders);
  let vstart_mat = VehicleStartMatrix::build(&problem.vehicles, &problem.orders);

  let mut current = generate_rcrs(problem, &order_mat, &vstart_mat, target, &mut rng);
  let mut current_energy = energy(&current, target);

  let mut best = current.clone();
  let mut best_energy = current_energy;

  let mut temperature = config.initial_temp;
  let started = Instant::now();
  let mut history = Vec::new();
  history.push(ConvergencePoint {
    time_ms: 0.0,
    iteration: 0,
    solution: current.clone().into_problem_solution(problem),
  });

  for iter in 1..=config.max_iterations {
    if temperature < config.min_temp {
      break;
    }

    if let Some(neighbor) = generate_neighbor(
      &current,
      problem,
      &order_mat,
      &vstart_mat,
      config.weights,
      &mut rng,
    ) {
      let neighbor_energy = energy(&neighbor, target);
      let delta = neighbor_energy - current_energy;

      let accept = delta < 0.0 || {
        let p: f64 = rng.r#gen();
        p < (-delta / temperature).exp()
      };

      if accept {
        current = neighbor;
        current_energy = neighbor_energy;

        if current_energy < best_energy {
          best_energy = current_energy;
          best = current.clone();
          history.push(ConvergencePoint {
            time_ms: started.elapsed().as_secs_f64() * 1_000.0,
            iteration: iter,
            solution: best.clone().into_problem_solution(problem),
          });
        }
      }
    }

    temperature *= config.cooling_rate;
  }

  Solved {
    solution: best.into_problem_solution(problem),
    history,
  }
}

#[inline(always)]
fn energy(sol: &crate::solution::WorkingSolution, target: Objective) -> f64 {
  match target {
    Objective::Empty => sol.empty_distance,
    Objective::Distance => sol.total_distance,
    Objective::Price => sol.total_price,
  }
}

// Helper kept around for future fixture work; not part of the public API.
#[doc(hidden)]
pub fn _shuffle_in_place<T, R: Rng + ?Sized>(slice: &mut [T], rng: &mut R) {
  slice.shuffle(rng);
}
