#![deny(clippy::all)]

use napi_derive::napi;

#[napi]
pub fn hello_from_rust() -> String {
  "Hello from the oxidized world!".to_string()
}

// Let's add a simple calculator to prove performance potential
#[napi]
pub fn add_numbers(a: u32, b: u32) -> u32 {
  a + b
}