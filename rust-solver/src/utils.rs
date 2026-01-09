use crate::models::Location;
use std::f64::consts::PI;

#[inline(always)]
fn to_radians(degrees: f64) -> f64 {
    degrees * (PI / 180.0)
}

#[inline(always)]
pub fn calculate_distance(from: &Location, to: &Location) -> f64 {
    let lat1 = to_radians(from.latitude);
    let lon1 = to_radians(from.longitude);
    let lat2 = to_radians(to.latitude);
    let lon2 = to_radians(to.longitude);

    let val = (lat1.sin() * lat2.sin()) + (lat1.cos() * lat2.cos() * (lon1 - lon2).cos());
    let clamped = if val > 1.0 { 1.0 } else if val < -1.0 { -1.0 } else { val };
    
    clamped.acos() * 6371.0
}
