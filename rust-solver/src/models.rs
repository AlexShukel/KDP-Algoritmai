use napi_derive::napi;
use std::collections::HashMap;

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
    #[napi(js_name = "type")] // "type" is a reserved keyword in Rust
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
    pub routes: HashMap<String, VehicleRoute>,
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
