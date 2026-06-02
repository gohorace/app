/**
 * HOR-375 — export launch gate.
 *
 * The data-ownership/export feature must NOT be exposed to users until Marketing
 * refocuses the trust-page copy from individual "your data" to account-level
 * sovereignty (Andy, 2026-06-02 — this reverses CLAUDE.md hard rule #1 for the
 * individual agent). Until then every export + grant route is gated off.
 *
 * Keep FALSE until Marketing ships the copy. Flipping this is the launch.
 */
export const EXPORT_ENABLED = false
