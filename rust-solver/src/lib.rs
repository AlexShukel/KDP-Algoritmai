#![deny(clippy::all)]

use napi_derive::napi;
use std::f64::consts::PI;

// --- NAPI Data Structures (For Input/Output only) ---

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Location {
    pub hash: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Vehicle {
    pub id: u32,
    pub start_location: Location,
    pub price_km: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u32,
    pub pickup_location: Location,
    pub delivery_location: Location,
    pub load_factor: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Problem {
    pub vehicles: Vec<Vehicle>,
    pub orders: Vec<Order>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct RouteStop {
    pub order_id: u32,
    pub type_: String,
}

#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct VehicleRoute {
    pub stops: Vec<RouteStop>,
    pub total_distance: f64,
    pub empty_distance: f64,
    pub total_price: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct ProblemSolution {
    pub routes: std::collections::HashMap<String, VehicleRoute>,
    pub total_distance: f64,
    pub empty_distance: f64,
    pub total_price: f64,
}

#[napi(object)]
pub struct AlgorithmSolution {
    pub best_distance_solution: ProblemSolution,
    pub best_price_solution: ProblemSolution,
    pub best_empty_solution: ProblemSolution,
}

// --- High Performance Internal Context ---

struct SolverContext<'a> {
    orders: &'a Vec<Order>,
    vehicles: &'a Vec<Vehicle>,
    
    // Flattened Matrix: [row * num_cols + col]
    // Nodes: 0..2*N-1. (2*k = Pickup k, 2*k+1 = Delivery k)
    dist_mat: Vec<f64>, 
    num_nodes: usize,

    // Flattened Matrix: [vehicle_idx * num_orders + order_idx]
    veh_start_mat: Vec<f64>,

    // Global Bests
    best_dist: f64,
    best_dist_sol: Option<ProblemSolution>,
    
    best_price: f64,
    best_price_sol: Option<ProblemSolution>,
    
    best_empty: f64,
    best_empty_sol: Option<ProblemSolution>,

    full_mask: u32,
}

impl<'a> SolverContext<'a> {
    fn new(orders: &'a Vec<Order>, vehicles: &'a Vec<Vehicle>) -> Self {
        let n_orders = orders.len();
        let num_nodes = n_orders * 2;

        // 1. Build Flattened Order-Order Distance Matrix
        let mut dist_mat = vec![0.0; num_nodes * num_nodes];
        
        let get_loc = |idx: usize| -> &Location {
            let order_idx = idx / 2;
            if idx % 2 == 0 { &orders[order_idx].pickup_location } 
            else { &orders[order_idx].delivery_location }
        };

        for i in 0..num_nodes {
            for j in 0..num_nodes {
                if i != j {
                    dist_mat[i * num_nodes + j] = calculate_distance(get_loc(i), get_loc(j));
                }
            }
        }

        // 2. Build Flattened Vehicle-Order Distance Matrix
        let mut veh_start_mat = vec![0.0; vehicles.len() * n_orders];
        for (v_idx, vehicle) in vehicles.iter().enumerate() {
            for (o_idx, order) in orders.iter().enumerate() {
                veh_start_mat[v_idx * n_orders + o_idx] = calculate_distance(&vehicle.start_location, &order.pickup_location);
            }
        }

        SolverContext {
            orders,
            vehicles,
            dist_mat,
            num_nodes,
            veh_start_mat,
            best_dist: f64::INFINITY,
            best_dist_sol: None,
            best_price: f64::INFINITY,
            best_price_sol: None,
            best_empty: f64::INFINITY,
            best_empty_sol: None,
            full_mask: (1 << n_orders) - 1,
        }
    }
}

// Helper math
#[inline(always)]
fn to_radians(degrees: f64) -> f64 {
    degrees * (PI / 180.0)
}

#[inline(always)]
fn calculate_distance(from: &Location, to: &Location) -> f64 {
    let lat1 = to_radians(from.latitude);
    let lon1 = to_radians(from.longitude);
    let lat2 = to_radians(to.latitude);
    let lon2 = to_radians(to.longitude);

    let val = (lat1.sin() * lat2.sin()) + (lat1.cos() * lat2.cos() * (lon1 - lon2).cos());
    let clamped = if val > 1.0 { 1.0 } else if val < -1.0 { -1.0 } else { val };
    clamped.acos() * 6371.0
}

// Lightweight result using raw node indices
struct InternalTspResult {
    path: Vec<u8>, // Using u8 assumes < 128 orders (256 nodes). Safe for brute force.
    total_dist: f64,
    total_empty: f64,
    total_price: f64,
}

struct InternalBestResults {
    min_dist: InternalTspResult,
    min_price: InternalTspResult,
    min_empty: InternalTspResult,
}

// --- Core Logic ---

fn solve_tsp(
    ctx: &SolverContext,
    vehicle_idx: usize,
    target_mask: u32,
) -> Option<InternalBestResults> {
    let vehicle = &ctx.vehicles[vehicle_idx];
    
    // Locals
    let mut best_dist_val = f64::INFINITY;
    let mut best_dist_path: Option<Vec<u8>> = None;
    let mut best_dist_metrics = (0.0, 0.0); // (empty, price)

    let mut best_empty_val = f64::INFINITY;
    let mut best_empty_path: Option<Vec<u8>> = None;
    let mut best_empty_metrics = (0.0, 0.0); // (dist, price)

    let mut best_price_val = f64::INFINITY;
    let mut best_price_path: Option<Vec<u8>> = None;
    let mut best_price_metrics = (0.0, 0.0); // (dist, empty)

    // Pre-calculate count for capacity check
    let mut stops_capacity = 0;
    let mut temp = target_mask;
    while temp > 0 {
        if temp & 1 == 1 { stops_capacity += 2; }
        temp >>= 1;
    }
    let mut path_stack = Vec::with_capacity(stops_capacity);

    fn dfs(
        ctx: &SolverContext,
        vehicle_idx: usize,
        vehicle_price: f64,
        target_mask: u32,
        
        last_node: Option<usize>,
        cur_dist: f64,
        cur_empty: f64,
        cur_price: f64,
        cur_load: f64,
        path: &mut Vec<u8>,
        pickup_mask: u32,
        deliver_mask: u32,

        b_dist: &mut f64, b_dist_p: &mut Option<Vec<u8>>, b_dist_m: &mut (f64, f64),
        b_empty: &mut f64, b_empty_p: &mut Option<Vec<u8>>, b_empty_m: &mut (f64, f64),
        b_price: &mut f64, b_price_p: &mut Option<Vec<u8>>, b_price_m: &mut (f64, f64),
    ) {
        if deliver_mask == target_mask {
            // Update Best Dist
            if cur_dist < *b_dist {
                *b_dist = cur_dist;
                *b_dist_p = Some(path.clone()); // Cheap copy of small Vec<u8>
                *b_dist_m = (cur_empty, cur_price);
            }
            // Update Best Empty
            if cur_empty < *b_empty {
                *b_empty = cur_empty;
                *b_empty_p = Some(path.clone());
                *b_empty_m = (cur_dist, cur_price);
            }
            // Update Best Price
            if cur_price < *b_price {
                *b_price = cur_price;
                *b_price_p = Some(path.clone());
                *b_price_m = (cur_dist, cur_empty);
            }
            return;
        }

        // Iterate orders (using indices 0..N)
        // Optimization: Pre-calculate active indices before recursion? 
        // For N < 10, iterating all is effectively free compared to alloc.
        let n_orders = ctx.orders.len();
        
        for o_idx in 0..n_orders {
            let order_bit = 1 << o_idx;
            // Skip if not in this assignment
            if (target_mask & order_bit) == 0 { continue; }

            let order = &ctx.orders[o_idx];
            let load_val = 1.0 / order.load_factor;

            // OPTION A: PICKUP
            if (pickup_mask & order_bit) == 0 {
                // Capacity Check
                if cur_load + load_val > 1.000001 { continue; }

                let leg_dist = match last_node {
                    None => ctx.veh_start_mat[vehicle_idx * n_orders + o_idx],
                    Some(prev) => ctx.dist_mat[prev * ctx.num_nodes + (2 * o_idx)]
                };

                let new_dist = cur_dist + leg_dist;
                let is_empty = pickup_mask == deliver_mask;
                let new_empty = cur_empty + if is_empty { leg_dist } else { 0.0 };
                let new_price = cur_price + (leg_dist * vehicle_price);

                path.push((2 * o_idx) as u8);
                
                dfs(ctx, vehicle_idx, vehicle_price, target_mask,
                   Some(2 * o_idx), new_dist, new_empty, new_price, cur_load + load_val,
                   path, pickup_mask | order_bit, deliver_mask,
                   b_dist, b_dist_p, b_dist_m,
                   b_empty, b_empty_p, b_empty_m,
                   b_price, b_price_p, b_price_m
                );
                
                path.pop();
            }
            // OPTION B: DELIVERY
            else if (pickup_mask & order_bit) != 0 && (deliver_mask & order_bit) == 0 {
                let leg_dist = ctx.dist_mat[last_node.unwrap() * ctx.num_nodes + (2 * o_idx + 1)];

                let new_dist = cur_dist + leg_dist;
                // Carries load -> not empty
                let new_price = cur_price + (leg_dist * vehicle_price);

                path.push((2 * o_idx + 1) as u8);

                dfs(ctx, vehicle_idx, vehicle_price, target_mask,
                    Some(2 * o_idx + 1), new_dist, cur_empty, new_price, cur_load - load_val,
                    path, pickup_mask, deliver_mask | order_bit,
                    b_dist, b_dist_p, b_dist_m,
                    b_empty, b_empty_p, b_empty_m,
                    b_price, b_price_p, b_price_m
                );

                path.pop();
            }
        }
    }

    dfs(ctx, vehicle_idx, vehicle.price_km, target_mask, 
        None, 0.0, 0.0, 0.0, 0.0, &mut path_stack, 0, 0,
        &mut best_dist_val, &mut best_dist_path, &mut best_dist_metrics,
        &mut best_empty_val, &mut best_empty_path, &mut best_empty_metrics,
        &mut best_price_val, &mut best_price_path, &mut best_price_metrics
    );

    if let (Some(dp), Some(ep), Some(pp)) = (best_dist_path, best_empty_path, best_price_path) {
         Some(InternalBestResults {
             min_dist: InternalTspResult { path: dp, total_dist: best_dist_val, total_empty: best_dist_metrics.0, total_price: best_dist_metrics.1 },
             min_empty: InternalTspResult { path: ep, total_dist: best_empty_metrics.0, total_empty: best_empty_val, total_price: best_empty_metrics.1 },
             min_price: InternalTspResult { path: pp, total_dist: best_price_metrics.0, total_empty: best_price_metrics.1, total_price: best_price_val }
         })
    } else {
        None
    }
}

fn solve_recursive(
    ctx: &mut SolverContext, 
    vehicle_idx: usize, 
    assignment_mask: u32,
    current_dist: f64,
    current_price: f64,
    current_empty: f64,
    assignments: &mut Vec<u32>,
) {
    // Global pruning
    if current_dist >= ctx.best_dist && current_price >= ctx.best_price && current_empty >= ctx.best_empty {
        return;
    }

    if assignment_mask == ctx.full_mask {
        if current_dist < ctx.best_dist {
            ctx.best_dist = current_dist;
            ctx.best_dist_sol = Some(reconstruct_solution(ctx, assignments, "dist"));
        }
        if current_price < ctx.best_price {
            ctx.best_price = current_price;
            ctx.best_price_sol = Some(reconstruct_solution(ctx, assignments, "price"));
        }
        if current_empty < ctx.best_empty {
            ctx.best_empty = current_empty;
            ctx.best_empty_sol = Some(reconstruct_solution(ctx, assignments, "empty"));
        }
        return;
    }

    if vehicle_idx >= ctx.vehicles.len() {
        return;
    }

    let remaining_mask = ctx.full_mask ^ assignment_mask;
    let mut submask = remaining_mask;
    
    // Iterate subsets of remaining mask
    loop {
        if submask == 0 { break; } 
        
        // Pass MASK directly, don't allocate vector of indices
        if let Some(res) = solve_tsp(ctx, vehicle_idx, submask) {
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

    // Skip vehicle
    solve_recursive(ctx, vehicle_idx + 1, assignment_mask, current_dist, current_price, current_empty, assignments);
}

// Convert optimized internal representation back to full JS objects
// This only happens ~3 times per full execution (at the end), so allocations here are fine.
fn reconstruct_solution(ctx: &SolverContext, assignments: &Vec<u32>, type_: &str) -> ProblemSolution {
    let mut solution = ProblemSolution {
        routes: std::collections::HashMap::new(),
        total_distance: 0.0,
        empty_distance: 0.0,
        total_price: 0.0,
    };

    for (v_idx, &mask) in assignments.iter().enumerate() {
        if mask > 0 {
            if let Some(res) = solve_tsp(ctx, v_idx, mask) {
                let internal_res = match type_ {
                    "dist" => res.min_dist,
                    "price" => res.min_price,
                    _ => res.min_empty,
                };

                let mut stops = Vec::new();
                for node in internal_res.path {
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

#[napi]
pub fn solve_brute_force(problem: Problem) -> AlgorithmSolution {
    let mut ctx = SolverContext::new(&problem.orders, &problem.vehicles);
    let mut assignments = vec![0; problem.vehicles.len()];

    solve_recursive(&mut ctx, 0, 0, 0.0, 0.0, 0.0, &mut assignments);

    let empty_sol = ProblemSolution::default();

    AlgorithmSolution {
        best_distance_solution: ctx.best_dist_sol.unwrap_or(empty_sol.clone()),
        best_price_solution: ctx.best_price_sol.unwrap_or(empty_sol.clone()),
        best_empty_solution: ctx.best_empty_sol.unwrap_or(empty_sol),
    }
}