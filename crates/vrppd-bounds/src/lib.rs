//! Lower bounds on the optimal objective value for the specific VRPPD
//! variant.
//!
//! The bounds are derived from the simplified MILP described in
//! `documents/MILP_adaptation_notes.md` (which adapts
//! `documents/Kursinis_darbas.pdf` §2 to the problem the implementation
//! actually solves: no time windows, no max-distance ceiling, real-valued
//! unit capacity).
//!
//! This commit ships the **direct-sum bound** only. The LP-relaxation bound
//! from the same MILP lands in a follow-up commit (per PLAN.md §3.2 it
//! depends on an LP solver dependency that's worth a separate decision).

pub mod direct;

pub use direct::{lower_bound_direct, lower_bound_for, LowerBounds};
