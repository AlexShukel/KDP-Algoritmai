//! Pre-computed pairwise-distance matrices.
//!
//! Built once per `solve` call and shared by RCRS, recalculation, and the SA
//! inner loop. Index conventions match the TypeScript implementation so any
//! future cross-language comparison stays meaningful:
//!
//! - **Order-order matrix.** `2N × 2N` where row/column `i` represents stop
//!   `i / 2` of order `orders[i / 2]` (`i` even → pickup, odd → delivery).
//! - **Vehicle-start matrix.** `V × N`, distance from each vehicle's start
//!   location to each order's pickup location.

use vrppd_core::{haversine_km, Order, Vehicle};

/// Flat row-major `2N × 2N` distance matrix between every pickup/delivery node.
#[derive(Clone, Debug)]
pub struct OrderMatrix {
  pub data: Vec<f64>,
  pub dim: usize,
}

impl OrderMatrix {
  #[inline(always)]
  pub fn get(&self, from: usize, to: usize) -> f64 {
    self.data[from * self.dim + to]
  }

  pub fn build(orders: &[Order]) -> Self {
    let dim = orders.len() * 2;
    let mut data = vec![0.0; dim * dim];

    for i in 0..dim {
      for j in 0..dim {
        if i == j {
          continue;
        }
        let from = stop_location(orders, i);
        let to = stop_location(orders, j);
        data[i * dim + j] = haversine_km(from, to);
      }
    }

    Self { data, dim }
  }
}

/// Flat row-major `V × N` distance matrix from each vehicle's start to each
/// order's pickup.
#[derive(Clone, Debug)]
pub struct VehicleStartMatrix {
  pub data: Vec<f64>,
  pub n_orders: usize,
}

impl VehicleStartMatrix {
  #[inline(always)]
  pub fn get(&self, vehicle_idx: usize, order_idx: usize) -> f64 {
    self.data[vehicle_idx * self.n_orders + order_idx]
  }

  pub fn build(vehicles: &[Vehicle], orders: &[Order]) -> Self {
    let n_orders = orders.len();
    let mut data = vec![0.0; vehicles.len() * n_orders.max(1)];

    for (v_idx, vehicle) in vehicles.iter().enumerate() {
      for (o_idx, order) in orders.iter().enumerate() {
        data[v_idx * n_orders + o_idx] =
          haversine_km(&vehicle.start_location, &order.pickup_location);
      }
    }

    Self { data, n_orders }
  }
}

#[inline(always)]
fn stop_location(orders: &[Order], stop_idx: usize) -> &vrppd_core::Location {
  let order_idx = stop_idx / 2;
  if stop_idx % 2 == 0 {
    &orders[order_idx].pickup_location
  } else {
    &orders[order_idx].delivery_location
  }
}

#[inline(always)]
pub fn stop_node(order_idx: usize, kind: vrppd_core::StopKind) -> usize {
  match kind {
    vrppd_core::StopKind::Pickup => order_idx * 2,
    vrppd_core::StopKind::Delivery => order_idx * 2 + 1,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use vrppd_core::{Location, Order};

  fn loc(lat: f64, lon: f64) -> Location {
    Location {
      hash: format!("{lat},{lon}"),
      latitude: lat,
      longitude: lon,
    }
  }

  fn order(id: u32, p: (f64, f64), d: (f64, f64)) -> Order {
    Order {
      id,
      pickup_location: loc(p.0, p.1),
      delivery_location: loc(d.0, d.1),
      load_factor: 1.0,
    }
  }

  #[test]
  fn order_matrix_zero_on_diagonal() {
    let orders = vec![order(1, (0.0, 0.0), (1.0, 0.0))];
    let m = OrderMatrix::build(&orders);
    assert_eq!(m.dim, 2);
    assert_eq!(m.get(0, 0), 0.0);
    assert_eq!(m.get(1, 1), 0.0);
  }

  #[test]
  fn order_matrix_indices_match_pickup_delivery_convention() {
    // Two orders. Pickups at lat=0; deliveries at lat=10.
    let orders = vec![
      order(1, (0.0, 0.0), (10.0, 0.0)),
      order(2, (0.0, 5.0), (10.0, 5.0)),
    ];
    let m = OrderMatrix::build(&orders);
    assert_eq!(m.dim, 4);
    // 0 -> 1 = order 0 pickup -> order 0 delivery (purely latitudinal).
    let p_to_d_same_order = m.get(0, 1);
    assert!(p_to_d_same_order > 0.0);
    // Symmetry.
    assert!((m.get(0, 1) - m.get(1, 0)).abs() < 1e-12);
    // 0 -> 2 = order 0 pickup -> order 1 pickup (purely longitudinal).
    assert!(m.get(0, 2) > 0.0);
  }

  #[test]
  fn vehicle_start_matrix_uses_pickup_locations() {
    // Tolerance: 1e-3 km = 1 metre. Haversine on co-located points returns a
    // sub-metre epsilon at most latitudes due to f64 rounding inside
    // sin² + cos² (the sum is not bit-exactly 1 unless the latitude happens
    // to be 0).
    const COLOC_KM: f64 = 1e-3;

    let v_locs = vec![
      vrppd_core::Vehicle {
        id: 7,
        start_location: loc(0.0, 0.0),
        price_km: 1.0,
      },
      vrppd_core::Vehicle {
        id: 8,
        start_location: loc(10.0, 0.0),
        price_km: 1.0,
      },
    ];
    let orders = vec![
      order(1, (0.0, 0.0), (50.0, 50.0)), // far delivery
      order(2, (10.0, 0.0), (50.0, 50.0)),
    ];
    let m = VehicleStartMatrix::build(&v_locs, &orders);
    // Vehicle 0 sits exactly at order 1's pickup.
    assert!(m.get(0, 0) < COLOC_KM);
    // Vehicle 1 sits exactly at order 2's pickup.
    assert!(m.get(1, 1) < COLOC_KM);
    // Cross distances are well above noise.
    assert!(m.get(0, 1) > 100.0);
    assert!(m.get(1, 0) > 100.0);
  }
}
