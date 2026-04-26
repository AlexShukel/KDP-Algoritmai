//! Lower bounds on the optimal objective value for the specific VRPPD
//! variant.
//!
//! The bounds are derived from the simplified MILP described in
//! `documents/MILP_adaptation_notes.md` (which adapts
//! `documents/Kursinis_darbas.pdf` §2 to the problem the implementation
//! actually solves: no time windows, no max-distance ceiling, real-valued
//! unit capacity).
//!
//! Two bounds are exposed:
//!
//! - **Direct-sum bound** (`O(N)` from the problem data) — trivially
//!   computable, intentionally loose; works at any scale.
//! - **LP-relaxation bound** — solves the MILP with continuous relaxations
//!   of all binaries. Tighter, but constrained by LP-solver scaling
//!   (practical ceiling around `N ≤ 20` with the bundled `microlp`
//!   backend).

pub mod direct;
pub mod lp;

pub use direct::{lower_bound_direct, lower_bound_for, LowerBounds};
pub use lp::{lower_bound_lp, BoundsError};
