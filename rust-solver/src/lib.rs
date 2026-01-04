#![deny(clippy::all)]

use napi_derive::napi;
use std::f64::consts::PI;

// --- NAPI Structures ---
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

// --- Internal Data Structures (STACK ALLOCATED) ---

#[derive(Clone, Copy, Debug)]
struct PathBuffer {
    nodes: [u8; 16],
    len: u8,
}

impl Default for PathBuffer {
    fn default() -> Self {
        Self { nodes: [0; 16], len: 0 }
    }
}

#[derive(Clone, Copy, Debug)]
struct InternalTspResult {
    path: PathBuffer,
    total_dist: f64,
    total_empty: f64,
    total_price: f64,
}

#[derive(Clone, Copy, Debug)]
struct InternalBestResults {
    min_dist: InternalTspResult,
    min_price: InternalTspResult,
    min_empty: InternalTspResult,
    valid: bool,
}

struct SolverContext<'a> {
    orders: &'a Vec<Order>,
    vehicles: &'a Vec<Vehicle>,
    
    dist_mat: Vec<f64>, 
    num_nodes: usize,
    veh_start_mat: Vec<f64>,

    memo: Vec<Option<InternalBestResults>>,
    n_orders: usize,

    // --- CHANGED: Store lightweight assignments instead of heavy Objects ---
    best_dist: f64,
    best_dist_assignments: Vec<u32>, // Store the winning mask configuration
    
    best_price: f64,
    best_price_assignments: Vec<u32>,
    
    best_empty: f64,
    best_empty_assignments: Vec<u32>,

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
        
        let cache_size = vehicles.len() * (1 << n_orders);

        SolverContext {
            orders,
            vehicles,
            dist_mat,
            num_nodes,
            veh_start_mat,
            memo: vec![None; cache_size],
            n_orders,
            
            // Initialize best scores to Infinity
            best_dist: f64::INFINITY,
            best_dist_assignments: vec![0; vehicles.len()],
            
            best_price: f64::INFINITY,
            best_price_assignments: vec![0; vehicles.len()],
            
            best_empty: f64::INFINITY,
            best_empty_assignments: vec![0; vehicles.len()],
            
            full_mask: (1 << n_orders) - 1,
        }
    }
}

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

// --- Solver Logic ---

fn solve_tsp(
    ctx: &mut SolverContext, 
    vehicle_idx: usize,
    target_mask: u32,
) -> InternalBestResults {
    
    let cache_idx = vehicle_idx * (1 << ctx.n_orders) + target_mask as usize;
    
    let cached_opt = unsafe { ctx.memo.get_unchecked(cache_idx) };
    if let Some(cached) = cached_opt {
        return *cached;
    }

    let vehicle_price = ctx.vehicles[vehicle_idx].price_km;
    
    let mut best_dist_val = f64::INFINITY;
    let mut best_dist_path = PathBuffer::default();
    let mut best_dist_metrics = (0.0, 0.0);

    let mut best_empty_val = f64::INFINITY;
    let mut best_empty_path = PathBuffer::default();
    let mut best_empty_metrics = (0.0, 0.0);

    let mut best_price_val = f64::INFINITY;
    let mut best_price_path = PathBuffer::default();
    let mut best_price_metrics = (0.0, 0.0);

    let mut path_stack = PathBuffer::default();

    // Captures for recursion
    let n_orders = ctx.n_orders;
    let num_nodes = ctx.num_nodes;
    let veh_start = &ctx.veh_start_mat;
    let dist_mat = &ctx.dist_mat;
    let orders = &ctx.orders;

    fn dfs(
        n_orders: usize, num_nodes: usize,
        veh_start: &Vec<f64>, dist_mat: &Vec<f64>, orders: &Vec<Order>,
        vehicle_idx: usize, vehicle_price: f64, target_mask: u32,
        
        last_node: Option<usize>,
        cur_dist: f64, cur_empty: f64, cur_price: f64, cur_load: f64,
        path: &mut PathBuffer,
        pickup_mask: u32, deliver_mask: u32,

        b_dist: &mut f64, b_dist_p: &mut PathBuffer, b_dist_m: &mut (f64, f64),
        b_empty: &mut f64, b_empty_p: &mut PathBuffer, b_empty_m: &mut (f64, f64),
        b_price: &mut f64, b_price_p: &mut PathBuffer, b_price_m: &mut (f64, f64),
    ) {
        // --- CRITICAL PRUNING FIX ---
        // If the current path is already worse than the best known completed path 
        // for ALL 3 criteria, stop immediately.
        if cur_dist >= *b_dist && cur_empty >= *b_empty && cur_price >= *b_price {
            return;
        }
        // ----------------------------

        if deliver_mask == target_mask {
            if cur_dist < *b_dist {
                *b_dist = cur_dist;
                *b_dist_p = *path; 
                *b_dist_m = (cur_empty, cur_price);
            }
            if cur_empty < *b_empty {
                *b_empty = cur_empty;
                *b_empty_p = *path;
                *b_empty_m = (cur_dist, cur_price);
            }
            if cur_price < *b_price {
                *b_price = cur_price;
                *b_price_p = *path;
                *b_price_m = (cur_dist, cur_empty);
            }
            return;
        }

        for o_idx in 0..n_orders {
            let order_bit = 1 << o_idx;
            if (target_mask & order_bit) == 0 { continue; }

            let order = &orders[o_idx];
            let load_val = 1.0 / order.load_factor;

            // PICKUP
            if (pickup_mask & order_bit) == 0 {
                if cur_load + load_val > 1.000001 { continue; }

                let leg_dist = match last_node {
                    None => veh_start[vehicle_idx * n_orders + o_idx],
                    Some(prev) => dist_mat[prev * num_nodes + (2 * o_idx)]
                };

                let new_dist = cur_dist + leg_dist;
                // Pre-check dist prune locally to avoid function call overhead? 
                // No, top-level prune is enough.
                
                let is_empty = pickup_mask == deliver_mask;
                let new_empty = cur_empty + if is_empty { leg_dist } else { 0.0 };
                let new_price = cur_price + (leg_dist * vehicle_price);

                path.nodes[path.len as usize] = (2 * o_idx) as u8;
                path.len += 1;
                
                dfs(n_orders, num_nodes, veh_start, dist_mat, orders,
                   vehicle_idx, vehicle_price, target_mask,
                   Some(2 * o_idx), new_dist, new_empty, new_price, cur_load + load_val,
                   path, pickup_mask | order_bit, deliver_mask,
                   b_dist, b_dist_p, b_dist_m,
                   b_empty, b_empty_p, b_empty_m,
                   b_price, b_price_p, b_price_m
                );
                
                path.len -= 1;
            }
            // DELIVERY
            else if (pickup_mask & order_bit) != 0 && (deliver_mask & order_bit) == 0 {
                let prev = last_node.unwrap_or(0); 
                let leg_dist = dist_mat[prev * num_nodes + (2 * o_idx + 1)];

                let new_dist = cur_dist + leg_dist;
                let new_price = cur_price + (leg_dist * vehicle_price);

                path.nodes[path.len as usize] = (2 * o_idx + 1) as u8;
                path.len += 1;

                dfs(n_orders, num_nodes, veh_start, dist_mat, orders,
                    vehicle_idx, vehicle_price, target_mask,
                    Some(2 * o_idx + 1), new_dist, cur_empty, new_price, cur_load - load_val,
                    path, pickup_mask, deliver_mask | order_bit,
                    b_dist, b_dist_p, b_dist_m,
                    b_empty, b_empty_p, b_empty_m,
                    b_price, b_price_p, b_price_m
                );

                path.len -= 1;
            }
        }
    }

    dfs(n_orders, num_nodes, veh_start, dist_mat, orders,
        vehicle_idx, vehicle_price, target_mask, 
        None, 0.0, 0.0, 0.0, 0.0, &mut path_stack, 0, 0,
        &mut best_dist_val, &mut best_dist_path, &mut best_dist_metrics,
        &mut best_empty_val, &mut best_empty_path, &mut best_empty_metrics,
        &mut best_price_val, &mut best_price_path, &mut best_price_metrics
    );

    let result = if best_dist_val < f64::INFINITY {
         InternalBestResults {
             min_dist: InternalTspResult { path: best_dist_path, total_dist: best_dist_val, total_empty: best_dist_metrics.0, total_price: best_dist_metrics.1 },
             min_empty: InternalTspResult { path: best_empty_path, total_dist: best_empty_metrics.0, total_empty: best_empty_val, total_price: best_empty_metrics.1 },
             min_price: InternalTspResult { path: best_price_path, total_dist: best_price_metrics.0, total_empty: best_price_metrics.1, total_price: best_price_val },
             valid: true
         }
    } else {
        let dummy = InternalTspResult { path: PathBuffer::default(), total_dist: 0.0, total_empty: 0.0, total_price: 0.0 };
        InternalBestResults { min_dist: dummy, min_empty: dummy, min_price: dummy, valid: false }
    };

    unsafe { *ctx.memo.get_unchecked_mut(cache_idx) = Some(result); }

    result
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
    // Top level pruning (identical to JS)
    if current_dist >= ctx.best_dist && current_price >= ctx.best_price && current_empty >= ctx.best_empty {
        return;
    }

    // Base Case: All orders assigned
    if assignment_mask == ctx.full_mask {
        // --- CHANGED: Only copy the assignment vector (fast memcpy), don't build HashMaps ---
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
    
    // (Existing iteration logic is correct and matches JS)
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

    // Skip vehicle case
    solve_recursive(ctx, vehicle_idx + 1, assignment_mask, current_dist, current_price, current_empty, assignments);
}

fn reconstruct_solution(ctx: &mut SolverContext, assignments: &Vec<u32>, type_: &str) -> ProblemSolution {
    let mut solution = ProblemSolution {
        routes: std::collections::HashMap::new(),
        total_distance: 0.0,
        empty_distance: 0.0,
        total_price: 0.0,
    };

    for (v_idx, &mask) in assignments.iter().enumerate() {
        if mask > 0 {
            let res = solve_tsp(ctx, v_idx, mask);
            if res.valid {
                let internal_res = match type_ {
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

#[napi]
pub fn solve_brute_force(problem: Problem) -> AlgorithmSolution {
    let mut ctx = SolverContext::new(&problem.orders, &problem.vehicles);
    let mut assignments = vec![0; problem.vehicles.len()];

    solve_recursive(&mut ctx, 0, 0, 0.0, 0.0, 0.0, &mut assignments);

    // --- CHANGED: Reconstruct solutions ONLY ONCE at the end ---
    
    // We need to clone the assignment vectors to pass them to reconstruct 
    // (or modify reconstruct to take a slice)
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