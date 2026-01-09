pub mod context;
pub mod tsp;
pub mod types;

use std::collections::HashMap;
use crate::models::{Problem, AlgorithmSolution, ProblemSolution, VehicleRoute, RouteStop};
use context::SolverContext;
use tsp::solve_tsp;

fn solve_recursive(
    ctx: &mut SolverContext, 
    vehicle_idx: usize, 
    assignment_mask: u32,
    current_dist: f64,
    current_price: f64,
    current_empty: f64,
    assignments: &mut Vec<u32>,
) {
    // Top level pruning
    if current_dist >= ctx.best_dist && current_price >= ctx.best_price && current_empty >= ctx.best_empty {
        return;
    }

    // Base Case: All orders assigned
    if assignment_mask == ctx.full_mask {
        if current_dist < ctx.best_dist {
            ctx.best_dist = current_dist;
            ctx.best_dist_assignments.copy_from_slice(assignments);
        }
        if current_price < ctx.best_price {
            ctx.best_price = current_price;
            ctx.best_price_assignments.copy_from_slice(assignments);
        }
        if current_empty < ctx.best_empty {
            ctx.best_empty = current_empty;
            ctx.best_empty_assignments.copy_from_slice(assignments);
        }
        return;
    }

    if vehicle_idx >= ctx.vehicles.len() {
        return;
    }

    let remaining_mask = ctx.full_mask ^ assignment_mask;
    let mut submask = remaining_mask;
    
    // Iterate over all submasks of the remaining orders
    loop {
        if submask == 0 { break; } 
        
        let res = solve_tsp(ctx, vehicle_idx, submask);
        
        if res.valid {
            assignments[vehicle_idx] = submask;

            solve_recursive(
                ctx,
                vehicle_idx + 1,
                assignment_mask | submask,
                current_dist + res.min_dist.total_dist,
                current_price + res.min_price.total_price,
                current_empty + res.min_empty.total_empty,
                assignments
            );

            assignments[vehicle_idx] = 0;
        }

        submask = (submask - 1) & remaining_mask;
        if submask == 0 { break; }
    }

    // Recursive step: Try skipping this vehicle
    solve_recursive(ctx, vehicle_idx + 1, assignment_mask, current_dist, current_price, current_empty, assignments);
}

fn reconstruct_solution(ctx: &mut SolverContext, assignments: &Vec<u32>, criterion: &str) -> ProblemSolution {
    let mut solution = ProblemSolution {
        routes: HashMap::new(),
        total_distance: 0.0,
        empty_distance: 0.0,
        total_price: 0.0,
    };

    for (v_idx, &mask) in assignments.iter().enumerate() {
        if mask > 0 {
            let res = solve_tsp(ctx, v_idx, mask);
            if res.valid {
                let internal_res = match criterion {
                    "dist" => res.min_dist,
                    "price" => res.min_price,
                    _ => res.min_empty,
                };

                let mut stops = Vec::new();
                for i in 0..internal_res.path.len {
                    let node = internal_res.path.nodes[i as usize];
                    let order_id = ctx.orders[(node / 2) as usize].id;
                    let type_str = if node % 2 == 0 { "pickup" } else { "delivery" };
                    stops.push(RouteStop {
                        order_id,
                        type_: type_str.to_string(),
                    });
                }

                let route = VehicleRoute {
                    stops,
                    total_distance: internal_res.total_dist,
                    empty_distance: internal_res.total_empty,
                    total_price: internal_res.total_price,
                };

                solution.total_distance += route.total_distance;
                solution.total_price += route.total_price;
                solution.empty_distance += route.empty_distance;
                solution.routes.insert(ctx.vehicles[v_idx].id.to_string(), route);
            }
        }
    }
    solution
}

pub fn solve(problem: Problem) -> AlgorithmSolution {
    let mut ctx = SolverContext::new(&problem.orders, &problem.vehicles);
    let mut assignments = vec![0; problem.vehicles.len()];

    solve_recursive(&mut ctx, 0, 0, 0.0, 0.0, 0.0, &mut assignments);

    let best_dist_vec = ctx.best_dist_assignments.clone();
    let best_price_vec = ctx.best_price_assignments.clone();
    let best_empty_vec = ctx.best_empty_assignments.clone();
    
    let dist_sol = if ctx.best_dist < f64::INFINITY {
        reconstruct_solution(&mut ctx, &best_dist_vec, "dist")
    } else { ProblemSolution::default() };

    let price_sol = if ctx.best_price < f64::INFINITY {
        reconstruct_solution(&mut ctx, &best_price_vec, "price")
    } else { ProblemSolution::default() };
    
    let empty_sol = if ctx.best_empty < f64::INFINITY {
        reconstruct_solution(&mut ctx, &best_empty_vec, "empty")
    } else { ProblemSolution::default() };

    AlgorithmSolution {
        best_distance_solution: dist_sol,
        best_price_solution: price_sol,
        best_empty_solution: empty_sol,
    }
}
