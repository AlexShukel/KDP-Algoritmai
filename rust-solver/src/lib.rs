#![deny(clippy::all)]

use napi_derive::napi;

mod models;
mod solver;
mod utils;

use models::{Problem, AlgorithmSolution};

#[napi]
pub fn solve_brute_force(problem: Problem) -> AlgorithmSolution {
    solver::solve(problem)
}
